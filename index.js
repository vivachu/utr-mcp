#!/usr/bin/env node
/**
 * UTR Sports MCP Server v2
 * Uses api.utrsports.net v4 API for decimal-precision UTR ratings.
 *
 * Configuration (environment variables):
 *   UTR_JWT        – JWT token from your UTR Sports browser session (required)
 *   UTR_PLAYER_ID  – Your son's UTR numeric player ID (optional convenience default)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const JWT = process.env.UTR_JWT;
const DEFAULT_PLAYER_ID = process.env.UTR_PLAYER_ID;
const API_BASE = "https://api.utrsports.net";
const APP_BASE = "https://app.universaltennis.com";

if (!JWT) {
  process.stderr.write("[utr-mcp] ERROR: UTR_JWT is required.\n");
  process.exit(1);
}

async function utrFetch(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${JWT}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; utr-mcp/2.0)",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`UTR ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

const v4 = (path, params) => utrFetch(API_BASE, path, params);
const v1 = (path, params) => utrFetch(APP_BASE, path, params);

function fmtUtr(p) {
  return p?.singlesUtrDisplay ?? p?.myUtrSinglesDisplay
    ?? (p?.singlesUtr != null ? Number(p.singlesUtr).toFixed(2) : null);
}

function fmtPlayer(p) {
  if (!p) return "Unknown player";
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  const utr  = fmtUtr(p);
  return utr ? `${name} · UTR ${utr}` : name;
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtScore(score) {
  if (!score) return "";
  if (typeof score === "string") return score;
  const keys = Object.keys(score).filter(k => !isNaN(Number(k))).sort((a,b) => Number(a)-Number(b));
  if (!keys.length) return "";
  return keys.map(k => {
    const s  = score[k];
    const tb = s?.tiebreak != null ? `(${s.tiebreak})` : "";
    return `${s?.winner ?? "?"}–${s?.loser ?? "?"}${tb}`;
  }).join(", ");
}

function extractSelf(results, pid) {
  for (const r of results) {
    for (const p of [r.players?.winner1, r.players?.winner2, r.players?.loser1, r.players?.loser2]) {
      if (p?.id === String(pid)) return p;
    }
  }
  return null;
}

const server = new McpServer({ name: "utr-sports", version: "2.0.0" });

server.tool("search_player", "Search for a UTR player by name.",
  { name: z.string(), top: z.number().optional().default(5) },
  async ({ name, top }) => {
    const data = await v1("/api/v2/search/players", { query: name, top });
    const hits = data?.hits ?? data?.players ?? [];
    if (!hits.length) return { content: [{ type: "text", text: `No players found matching "${name}".` }] };
    const lines = hits.slice(0, top).map(h => { const p = h.source ?? h; return `• ID ${p.id}  ${fmtPlayer(p)}`; });
    return { content: [{ type: "text", text: `Found ${hits.length} result(s):\n\n${lines.join("\n")}` }] };
  }
);

server.tool("get_player_profile",
  "Get a UTR player profile with decimal-precision UTR ratings.",
  { player_id: z.string().optional().describe(`Omit to use default player (${DEFAULT_PLAYER_ID ?? "not set"}).`) },
  async ({ player_id }) => {
    const pid = player_id ?? DEFAULT_PLAYER_ID;
    if (!pid) throw new Error("No player_id and UTR_PLAYER_ID not set.");
    const data = await v4(`/v4/player/${pid}/overview`);
    const me   = extractSelf(data?.results ?? [], pid);
    const upcoming = (data?.upcomingEvents?.tmsEvents ?? []).map(e => e.name).join(", ") || "None";
    const lines = [
      `## ${me?.firstName ?? ""} ${me?.lastName ?? ""}  (ID: ${pid})`,
      `**Singles UTR:** ${me?.singlesUtrDisplay ?? "Unrated"} (${me?.ratingStatusSingles ?? "?"})`,
      `**Doubles UTR:** ${me?.doublesUtrDisplay ?? "Unrated"} (${me?.ratingStatusDoubles ?? "?"})`,
      `**Rating Progress:** ${me?.ratingProgressSingles ?? "?"}%`,
      `**Upcoming Events:** ${upcoming}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool("get_match_history",
  "Get full match history with decimal opponent UTRs, scores, event names, and round info.",
  {
    player_id: z.string().optional(),
    limit: z.number().optional().default(20),
    skip:  z.number().optional().default(0),
  },
  async ({ player_id, limit, skip }) => {
    const pid = player_id ?? DEFAULT_PLAYER_ID;
    if (!pid) throw new Error("No player_id and UTR_PLAYER_ID not set.");

    const data = await v4(`/v4/player/${pid}/results`);
    const { wins = 0, losses = 0, events = [] } = data;

    const allLines = [];
    for (const event of events) {
      const draws = event.draws ?? (event.results ? [{ results: event.results, name: null }] : []);
      for (const draw of draws) {
        for (const r of (draw.results ?? [])) {
          const isWin = r.isWinner === true;
          const opp   = isWin
            ? (r.players?.loser1  ?? r.players?.loser2)
            : (r.players?.winner1 ?? r.players?.winner2);
          const score    = fmtScore(r.score);
          const drawName = r.draw?.name ? ` / ${r.draw.name}` : (draw.name ? ` / ${draw.name}` : "");
          const round    = r.round?.code ? ` [${r.round.code}]` : "";
          allLines.push(`${isWin ? "✅ W" : "❌ L"}  ${fmtDate(r.date)}  vs. ${fmtPlayer(opp)}  [${score}]  — ${event.name}${drawName}${round}`);
        }
      }
    }

    if (!allLines.length) return { content: [{ type: "text", text: "No results found." }] };

    const page = allLines.slice(skip, skip + limit);
    return {
      content: [{
        type: "text",
        text: `**${wins}W – ${losses}L overall** (showing ${skip + 1}–${skip + page.length} of ${allLines.length} matches)\n\n${page.join("\n")}`,
      }],
    };
  }
);

server.tool("get_upcoming_events",
  "Get tournaments the player is registered for.",
  { player_id: z.string().optional() },
  async ({ player_id }) => {
    const pid  = player_id ?? DEFAULT_PLAYER_ID;
    if (!pid) throw new Error("No player_id and UTR_PLAYER_ID not set.");
    const data     = await v4(`/v4/player/${pid}/overview`);
    const upcoming = data?.upcomingEvents?.tmsEvents ?? [];
    if (!upcoming.length) return { content: [{ type: "text", text: "No upcoming events." }] };
    const lines = upcoming.map(e => {
      const loc   = e.eventLocations?.[0];
      const locStr = loc ? `${loc.cityName}, ${loc.stateAbbr}` : "";
      return [
        `### ${e.name}`,
        e.eventSchedule?.eventDatesLong ? `**When:** ${e.eventSchedule.eventDatesLong}` : null,
        locStr ? `**Where:** ${locStr}` : null,
        e.utrType?.label  ? `**Type:** ${e.utrType.label}` : null,
        e.utrRange        ? `**UTR Range:** ${e.utrRange}` : null,
        `**ID:** ${e.id}`,
      ].filter(Boolean).join("\n");
    });
    return { content: [{ type: "text", text: `## Upcoming Events (${upcoming.length})\n\n${lines.join("\n\n")}` }] };
  }
);

server.tool("get_event_details",
  "Get full details for a specific tournament/event.",
  { event_id: z.string() },
  async ({ event_id }) => {
    const data   = await v1(`/api/v1/event/${event_id}`);
    const loc    = data.eventLocations?.[0] ?? data.location;
    const locStr = loc ? [loc.cityName, loc.stateAbbr ?? loc.stateName].filter(Boolean).join(", ") : null;
    const lines  = [
      `## ${data.name ?? "Event"}`,
      data.eventSchedule?.eventDatesLong ? `**When:** ${data.eventSchedule.eventDatesLong}` : null,
      locStr ? `**Where:** ${locStr}` : null,
      data.eventType?.label ? `**Format:** ${data.eventType.label}` : null,
      data.utrType?.label   ? `**UTR Type:** ${data.utrType.label}` : null,
      data.eventState?.registrationState?.label ? `**Registration:** ${data.eventState.registrationState.label}` : null,
      data.registeredCount  ? `**Players:** ${data.registeredCount}` : null,
      "",
    ].filter(l => l !== null);

    for (const draw of (data.draws ?? [])) {
      lines.push(`### ${draw.name ?? "Draw"}`);
      const results = draw.results ?? [];
      if (results.length) {
        results.forEach(r => {
          const w = fmtPlayer(r.players?.winner1 ?? r.players?.winner2);
          const l = fmtPlayer(r.players?.loser1  ?? r.players?.loser2);
          lines.push(`  ${fmtDate(r.date)}  ${w} def. ${l}  [${fmtScore(r.score)}]`);
        });
      } else {
        lines.push("  (No results yet)");
      }
      lines.push("");
    }

    if (!(data.draws?.length) && data.registeredMembers?.length) {
      lines.push("### Registered Players");
      data.registeredMembers.forEach(m => lines.push(`  • ${m.firstName} ${m.lastName}`));
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool("get_player_stats",
  "Aggregate win/loss stats with avg and peak opponent UTR, drawn from full match history.",
  {
    player_id: z.string().optional(),
    limit: z.number().optional().default(500),
  },
  async ({ player_id, limit }) => {
    const pid = player_id ?? DEFAULT_PLAYER_ID;
    if (!pid) throw new Error("No player_id and UTR_PLAYER_ID not set.");
    // /overview for profile header; /results for full match history (208+ matches)
    const [ov, rv] = await Promise.all([
      v4(`/v4/player/${pid}/overview`),
      v4(`/v4/player/${pid}/results`),
    ]);
    const me = extractSelf(ov?.results ?? [], pid);
    const { wins: totalWins = 0, losses: totalLosses = 0, events = [] } = rv;

    let wins = 0, losses = 0;
    const oppUtrs = [];
    let counted = 0;
    outer: for (const event of events) {
      const draws = event.draws ?? (event.results ? [{ results: event.results }] : []);
      for (const draw of draws) {
        for (const r of (draw.results ?? [])) {
          if (counted >= limit) break outer;
          const isWin = r.isWinner === true;
          const opp   = isWin ? (r.players?.loser1 ?? r.players?.loser2) : (r.players?.winner1 ?? r.players?.winner2);
          if (isWin) wins++; else losses++;
          const u = opp?.singlesUtr ?? opp?.myUtrSingles;
          if (u) oppUtrs.push(u);
          counted++;
        }
      }
    }

    const total = wins + losses;
    const lines = [
      `## Stats — ${me?.firstName ?? ""} ${me?.lastName ?? ""}`,
      `**Singles UTR:** ${me?.singlesUtrDisplay ?? "Unrated"}`,
      `**Doubles UTR:** ${me?.doublesUtrDisplay ?? "Unrated"}`,
      "",
      `**Overall record:** ${totalWins}W – ${totalLosses}L`,
      `**Analysed (last ${total}):** ${wins}W – ${losses}L`,
      `**Win %:** ${total > 0 ? ((wins/total)*100).toFixed(1)+"%" : "N/A"}`,
      `**Avg Opponent UTR:** ${oppUtrs.length ? (oppUtrs.reduce((s,v)=>s+v,0)/oppUtrs.length).toFixed(2) : "N/A"}`,
      `**Peak Opponent UTR:** ${oppUtrs.length ? Math.max(...oppUtrs).toFixed(2) : "N/A"}`,
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.tool("probe_endpoints",
  "Diagnostic: probe v4 endpoint variations to find full match history pagination.",
  { player_id: z.string().optional() },
  async ({ player_id }) => {
    const pid = player_id ?? DEFAULT_PLAYER_ID;
    const tests = [
      [`/v4/player/${pid}/results`, {}],
      [`/v4/player/${pid}/results`, { resultsCount: 20 }],
      [`/v4/player/${pid}/results`, { count: 20 }],
      [`/v4/player/${pid}/results`, { take: 20 }],
      [`/v4/player/${pid}/results`, { top: 20 }],
      [`/v4/player/${pid}/results`, { limit: 20 }],
      [`/v4/player/${pid}/results`, { pageSize: 20 }],
      [`/v4/player/${pid}/overview`, { resultsCount: 10 }],
      [`/v4/player/${pid}/overview`, { count: 10 }],
      [`/v4/player/${pid}/overview`, { take: 10 }],
    ];
    const lines = [];
    for (const [path, params] of tests) {
      try {
        const data = await v4(path, params);
        const n = (data?.results ?? []).length;
        const keys = Object.keys(data ?? {}).join(", ");
        lines.push(`✓ ${path} ${JSON.stringify(params)} → ${n} results | keys: ${keys}`);
      } catch(e) {
        lines.push(`✗ ${path} ${JSON.stringify(params)} → ${e.message.slice(0,80)}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[utr-mcp] v2 running — api.utrsports.net v4 (decimal UTRs).\n");