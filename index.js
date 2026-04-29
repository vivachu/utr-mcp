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

const JWT             = process.env.UTR_JWT;
const DEFAULT_PLAYER_ID = process.env.UTR_PLAYER_ID;
const USTA_BEARER     = process.env.USTA_BEARER;
const USTA_CHILD_UAID = process.env.USTA_CHILD_UAID ?? "2019010660";
const API_BASE        = "https://api.utrsports.net";
const APP_BASE        = "https://app.universaltennis.com";
const USTA_BASE       = "https://services.usta.com";
const CLUBSPARK_SEARCH_URL =
  "https://prd-usta-kube.clubspark.pro/unified-search-api/api/Search/tournaments/Query?indexSchema=tournament";

if (!JWT) {
  process.stderr.write("[utr-mcp] ERROR: UTR_JWT is required.\n");
  process.exit(1);
}
if (!USTA_BEARER) {
  process.stderr.write("[utr-mcp] WARN: USTA_BEARER not set — USTA tools will fail.\n");
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

async function ustaFetch(path, params = {}) {
  if (!USTA_BEARER) throw new Error("USTA_BEARER env var not set.");
  const url = new URL(`${USTA_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${USTA_BEARER}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; utr-mcp/2.0)",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`USTA ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function clubSparkSearch(body) {
  const res = await fetch(CLUBSPARK_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; utr-mcp/2.0)",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ClubSpark ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Client-side filter used by search_usta_tournaments; also copied into test-usta.js.
// levels: ["L6","L7"] → checks tournamentLevel field and tournament name.
// gender/ageGroup: matched against tournament name (case-insensitive substring).
function filterClubSparkResults(results, { levels = [], gender = "", ageGroup = "" } = {}) {
  return results.filter(t => {
    const levelField = String(t.tournamentLevel ?? "");
    const name       = String(t.name ?? "");
    const levelOk = levels.length === 0 || levels.some(l => {
      const n = l.replace(/\D/g, "");
      return new RegExp(`\\blevel\\s*${n}\\b`, "i").test(levelField) ||
             new RegExp(`\\bl${n}\\b`, "i").test(levelField) ||
             new RegExp(`\\blevel\\s*${n}\\b`, "i").test(name) ||
             new RegExp(`\\bl${n}\\b`, "i").test(name);
    });
    const genderOk = !gender || new RegExp(`\\b${gender}\\b`, "i").test(name);
    const ageOk    = !ageGroup || new RegExp(`\\b${ageGroup}\\b`, "i").test(name);
    return levelOk && genderOk && ageOk;
  });
}

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

function fmtRegStatus(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "open")         return "Registration: Open";
  if (s.includes("closed")) return "Registration: Closed";
  if (s.includes("full"))   return "Registration: Full";
  if (s.includes("not yet") || s.includes("upcoming")) return "Registration: Not Yet Open";
  return `Registration: ${status}`;
}

function parseUstaLevel(name = "") {
  const m = name.match(/Level\s*(\d+)/i);
  return m ? `L${m[1]}` : null;
}

function fmtUstaDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

server.tool("get_usta_schedule",
  "Get Cole's upcoming USTA tournament registrations from services.usta.com.",
  {
    child_uaid: z.string().optional().describe("USTA child UAID (defaults to USTA_CHILD_UAID env var)."),
    include_withdrawn: z.boolean().optional().default(false).describe("Include WITHDRAWN registrations."),
  },
  async ({ child_uaid, include_withdrawn }) => {
    const uaid = child_uaid ?? USTA_CHILD_UAID;
    const data = await ustaFetch(`/v1/dataexchange/schedule/me/child/${uaid}/upcoming`);
    const registrations = data?.data?.players?.[0]?.registrations ?? [];

    const filtered = registrations.filter(r => {
      if (r.isCancelled) return false;
      if (!include_withdrawn && r.status === "WITHDRAWN") return false;
      return true;
    });

    if (!filtered.length) {
      return { content: [{ type: "text", text: "No upcoming USTA registrations found." }] };
    }

    const lines = filtered.map(r => {
      const level = parseUstaLevel(r.name);
      const levelTag = level ? ` **(${level})**` : "";
      const start = fmtUstaDate(r.period?.startDate);
      const end   = r.period?.endDate && r.period.endDate !== r.period.startDate
        ? ` – ${fmtUstaDate(r.period.endDate)}`
        : "";
      const loc   = [r.city, r.state].filter(Boolean).join(", ");
      const status = r.status === "WITHDRAWN" ? " ↩️ WITHDRAWN" : " ✅";
      return [
        `### ${r.name}${levelTag}${status}`,
        `**Dates:** ${start}${end}`,
        loc ? `**Location:** ${r.location ? `${r.location}, ` : ""}${loc}` : null,
        r.url ? `**URL:** ${r.url}` : null,
      ].filter(Boolean).join("\n");
    });

    return { content: [{ type: "text", text: `## USTA Schedule (${filtered.length})\n\n${lines.join("\n\n")}` }] };
  }
);

server.tool("get_usta_rankings",
  "Get Cole's USTA ranking points and position in the Eastern section.",
  {
    child_uaid: z.string().optional().describe("USTA child UAID (defaults to USTA_CHILD_UAID env var)."),
  },
  async ({ child_uaid }) => {
    const uaid = child_uaid ?? USTA_CHILD_UAID;
    const paths = [
      `/v1/dataexchange/rankings/me/child/${uaid}`,
      `/v1/rankings/player/${uaid}`,
      `/v1/dataexchange/player/me/child/${uaid}`,
    ];
    for (const path of paths) {
      try {
        const data = await ustaFetch(path);
        return { content: [{ type: "text", text: `**Endpoint:** \`${path}\`\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 3000)}\n\`\`\`` }] };
      } catch (e) {
        if (!e.message.includes("404")) throw e;
      }
    }
    return { content: [{ type: "text", text: "No rankings endpoint responded. All three paths returned 404." }] };
  }
);

server.tool("search_usta_tournaments",
  "Find upcoming USTA junior tournaments (L6/L7, 12U Boys) near a location, deduped against Cole's schedule.",
  {
    child_uaid:    z.string().optional(),
    lat:           z.number().optional().default(41.0534).describe("Latitude (default: Greenwich CT)."),
    lng:           z.number().optional().default(-73.6287).describe("Longitude (default: Greenwich CT)."),
    radius_miles:  z.number().optional().default(100),
    age_group:     z.string().optional().default("12U"),
    gender:        z.string().optional().default("boys"),
    levels:        z.array(z.string()).optional().default(["L6", "L7"]),
    start_date:    z.string().optional().describe("ISO date, defaults to today."),
    end_date:      z.string().optional().describe("ISO date, defaults to 90 days out."),
    show_withdrawn: z.boolean().optional().default(false),
    take:          z.number().optional().default(50),
  },
  async ({ child_uaid, lat, lng, radius_miles, age_group, gender, levels, start_date, end_date, show_withdrawn, take }) => {
    const uaid  = child_uaid ?? USTA_CHILD_UAID;
    const today = new Date().toISOString().slice(0, 10);
    const in90  = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const from  = start_date ?? today;
    const to    = end_date   ?? in90;

    // Collect already-registered/withdrawn IDs for deduplication (best-effort).
    const registeredIds = new Set();
    try {
      const sched = await ustaFetch(`/v1/dataexchange/schedule/me/child/${uaid}/upcoming`);
      const regs  = sched?.data?.players?.[0]?.registrations ?? [];
      for (const r of regs) {
        if (r.isCancelled) continue;
        if (!show_withdrawn && r.status === "WITHDRAWN") {
          if (r.id) registeredIds.add(r.id);
          continue;
        }
        if (r.status === "REGISTERED" && r.id) registeredIds.add(r.id);
      }
    } catch { /* best-effort */ }

    const data = await clubSparkSearch({
      take,
      skip: 0,
      sort: "date",
      location: { lat, lng, radiusMiles: radius_miles },
      dateRange: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
    });

    const allResults = data?.results ?? [];
    const filtered   = filterClubSparkResults(allResults, { levels, gender, ageGroup: age_group });
    const open       = filtered.filter(t => !registeredIds.has(t.id));

    if (!open.length) {
      return {
        content: [{
          type: "text",
          text: `No open ${levels.join("/")} ${gender} ${age_group} tournaments found (${filtered.length} matched filters, ${registeredIds.size} already registered).`,
        }],
      };
    }

    const lines = open.map(t => {
      const slug   = t.organizationSlug ?? t.orgSlug ?? "";
      const detailUrl = slug
        ? `https://playtennis.usta.com/Competitions/${slug}/Tournaments/Overview/${t.id}`
        : t.url
          ? (t.url.startsWith("http") ? t.url : `https://playtennis.usta.com${t.url}`)
          : null;
      const start  = fmtUstaDate((t.startDate ?? "").slice(0, 10));
      const endSlice = (t.endDate ?? "").slice(0, 10);
      const end    = endSlice && endSlice !== (t.startDate ?? "").slice(0, 10)
        ? ` – ${fmtUstaDate(endSlice)}`
        : "";
      const dist   = t.distance != null ? ` · ${Number(t.distance).toFixed(1)} mi` : "";
      const level  = parseUstaLevel(t.tournamentLevel ?? "") ?? parseUstaLevel(t.name ?? "");
      const regStatus = fmtRegStatus(t.registrationStatus ?? t.registrationDeadline);
      return [
        `### ${t.name}${level ? ` **(${level})**` : ""}`,
        `**Dates:** ${start}${end}${dist}`,
        t.location?.address ? `**Where:** ${t.location.address}` : null,
        regStatus ? `**${regStatus}**` : null,
        t.registrationDeadline ? `**Registration Deadline:** ${fmtUstaDate(t.registrationDeadline.slice(0, 10))}` : null,
        detailUrl ? `**Sign Up / Info:** ${detailUrl}` : null,
      ].filter(Boolean).join("\n");
    });

    return {
      content: [{
        type: "text",
        text: `## Open Tournaments — ${open.length} of ${filtered.length} matching (${registeredIds.size} already registered)\n\n${lines.join("\n\n")}`,
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("[utr-mcp] v2 running — api.utrsports.net v4 (decimal UTRs).\n");