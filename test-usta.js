#!/usr/bin/env node
/**
 * Unit tests for the USTA helper functions and tool logic.
 * Uses mock data matching the confirmed USTA response shape.
 * No live API calls — safe to run without credentials.
 */

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertContains(label, actual, substring) {
  const ok = typeof actual === "string" && actual.includes(substring);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected string to contain: ${JSON.stringify(substring)}`);
    console.log(`     actual: ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Helper functions (copied from index.js) ──────────────────────────────

function parseUstaLevel(name = "") {
  const m = name.match(/Level\s*(\d+)/i);
  return m ? `L${m[1]}` : null;
}

function fmtUstaDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Mock data (matches confirmed USTA response shape from briefing) ───────

const MOCK_SCHEDULE_RESPONSE = {
  data: {
    players: [{
      registrations: [
        {
          id: "AA000001-0001-0001-0001-000000000001",
          name: "Level 6 - L6 THE CHAMPIONSHIPS @ Masters School Spring 1",
          location: "The Masters School",
          status: "REGISTERED",
          address1: "49 CLINTON AVE",
          city: "DOBBS FERRY",
          state: "NY",
          zip: "10522",
          period: { startDate: "2026-05-03", endDate: "2026-05-03" },
          url: "https://playtennis.usta.com/MyGame/TournamentDetails?id=AA000001-0001-0001-0001-000000000001",
          isCancelled: false,
        },
        {
          id: "AA000002-0002-0002-0002-000000000002",
          name: "Level 6 - L6 THE CHAMPIONSHIPS @ Masters School Spring 2",
          location: "The Masters School",
          status: "REGISTERED",
          address1: "49 CLINTON AVE",
          city: "DOBBS FERRY",
          state: "NY",
          zip: "10522",
          period: { startDate: "2026-05-17", endDate: "2026-05-17" },
          url: "https://playtennis.usta.com/MyGame/TournamentDetails?id=AA000002-0002-0002-0002-000000000002",
          isCancelled: false,
        },
        {
          id: "BB000001-0001-0001-0001-000000000001",
          name: "Level 6 - L6 UnitedSets Greenwich",
          location: "Greenwich TC",
          status: "WITHDRAWN",
          city: "GREENWICH",
          state: "CT",
          zip: "06830",
          period: { startDate: "2026-05-01", endDate: "2026-05-01" },
          url: "https://playtennis.usta.com/MyGame/TournamentDetails?id=BB000001",
          isCancelled: false,
        },
        {
          id: "BB000002-0002-0002-0002-000000000002",
          name: "Level 6 - L6 UnitedSets @ Chelsea Piers May",
          location: "Chelsea Piers",
          status: "WITHDRAWN",
          city: "NEW YORK",
          state: "NY",
          zip: "10011",
          period: { startDate: "2026-05-08", endDate: "2026-05-10" },
          url: "https://playtennis.usta.com/MyGame/TournamentDetails?id=BB000002",
          isCancelled: false,
        },
        {
          id: "CC000001-0001-0001-0001-000000000001",
          name: "Level 6 - L6 Cancelled Event",
          location: "Nowhere TC",
          status: "REGISTERED",
          city: "ALBANY",
          state: "NY",
          zip: "12207",
          period: { startDate: "2026-06-01", endDate: "2026-06-01" },
          url: "https://playtennis.usta.com/MyGame/TournamentDetails?id=CC000001",
          isCancelled: true,
        },
      ],
    }],
  },
};

// ─── Tool logic (extracted from index.js handler bodies) ──────────────────

function runGetUstaSchedule(mockData, { include_withdrawn = false } = {}) {
  const registrations = mockData?.data?.players?.[0]?.registrations ?? [];
  const filtered = registrations.filter(r => {
    if (r.isCancelled) return false;
    if (!include_withdrawn && r.status === "WITHDRAWN") return false;
    return true;
  });

  if (!filtered.length) return "No upcoming USTA registrations found.";

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

  return `## USTA Schedule (${filtered.length})\n\n${lines.join("\n\n")}`;
}

function buildRegisteredIds(mockData, { show_withdrawn = false } = {}) {
  const regs = mockData?.data?.players?.[0]?.registrations ?? [];
  const ids = new Set();
  for (const r of regs) {
    if (r.isCancelled) continue;
    if (!show_withdrawn && r.status === "WITHDRAWN") {
      if (r.id) ids.add(r.id);
      continue;
    }
    if (r.status === "REGISTERED" && r.id) ids.add(r.id);
  }
  return ids;
}

// ─── Tests ────────────────────────────────────────────────────────────────

console.log("\n── parseUstaLevel ───────────────────────────────────────────");
assert("standard format",        parseUstaLevel("Level 6 - L6 THE CHAMPIONSHIPS"),   "L6");
assert("Level 7",                parseUstaLevel("Level 7 - Junior Open"),             "L7");
assert("no space before digit",  parseUstaLevel("Level6 Tournament"),                 "L6");
assert("case insensitive",       parseUstaLevel("LEVEL 5 Sectional"),                 "L5");
assert("no level in name",       parseUstaLevel("UTR Open Classic"),                  null);
assert("empty string",           parseUstaLevel(""),                                  null);

console.log("\n── fmtUstaDate ──────────────────────────────────────────────");
assert("standard date",    fmtUstaDate("2026-05-03"), "May 3, 2026");
assert("multi-digit day",  fmtUstaDate("2026-05-17"), "May 17, 2026");
assert("empty string",     fmtUstaDate(""),           "");
assert("null",             fmtUstaDate(null),          "");

console.log("\n── get_usta_schedule: default (REGISTERED only) ─────────────");
{
  const out = runGetUstaSchedule(MOCK_SCHEDULE_RESPONSE);
  assert("count header shows 2",         out.includes("USTA Schedule (2)"),       true);
  assertContains("Spring 1 present",     out, "Masters School Spring 1");
  assertContains("Spring 2 present",     out, "Masters School Spring 2");
  assertContains("level tag L6",         out, "**(L6)**");
  assertContains("registered emoji",     out, "✅");
  assertContains("May 3, 2026",          out, "May 3, 2026");
  assertContains("May 17, 2026",         out, "May 17, 2026");
  assertContains("DOBBS FERRY, NY",      out, "DOBBS FERRY, NY");
  assertContains("playtennis URL",       out, "playtennis.usta.com");
  assert("WITHDRAWN not shown",          out.includes("WITHDRAWN"), false);
  assert("cancelled not shown",          out.includes("Cancelled Event"), false);
}

console.log("\n── get_usta_schedule: include_withdrawn=true ────────────────");
{
  const out = runGetUstaSchedule(MOCK_SCHEDULE_RESPONSE, { include_withdrawn: true });
  assert("count header shows 4",         out.includes("USTA Schedule (4)"),   true);
  assertContains("withdrawn emoji",      out, "↩️ WITHDRAWN");
  assertContains("Greenwich present",    out, "UnitedSets Greenwich");
  assertContains("Chelsea Piers present",out, "Chelsea Piers");
  assert("cancelled still not shown",    out.includes("Cancelled Event"), false);
}

console.log("\n── get_usta_schedule: multi-day date range ──────────────────");
{
  const out = runGetUstaSchedule(MOCK_SCHEDULE_RESPONSE, { include_withdrawn: true });
  assertContains("multi-day range",      out, "May 8, 2026 – May 10, 2026");
}

console.log("\n── get_usta_schedule: empty registrations ───────────────────");
{
  const out = runGetUstaSchedule({ data: { players: [{ registrations: [] }] } });
  assert("empty message", out, "No upcoming USTA registrations found.");
}

console.log("\n── get_usta_schedule: all cancelled ────────────────────────");
{
  const allCancelled = {
    data: { players: [{ registrations: [
      { id: "X1", name: "Level 6 - foo", status: "REGISTERED", isCancelled: true,
        period: { startDate: "2026-06-01", endDate: "2026-06-01" }, city: "NY", state: "NY" },
    ]}]}
  };
  const out = runGetUstaSchedule(allCancelled);
  assert("all-cancelled → empty message", out, "No upcoming USTA registrations found.");
}

console.log("\n── buildRegisteredIds (dedup for search_usta_tournaments) ──");
{
  const ids = buildRegisteredIds(MOCK_SCHEDULE_RESPONSE);
  assert("REGISTERED ids included",  ids.has("AA000001-0001-0001-0001-000000000001"), true);
  assert("REGISTERED ids included 2",ids.has("AA000002-0002-0002-0002-000000000002"), true);
  assert("WITHDRAWN ids included",   ids.has("BB000001-0001-0001-0001-000000000001"), true);
  assert("WITHDRAWN ids included 2", ids.has("BB000002-0002-0002-0002-000000000002"), true);
  assert("cancelled id excluded",    ids.has("CC000001-0001-0001-0001-000000000001"), false);
  assert("total 4 ids",              ids.size, 4);
}

console.log("\n── buildRegisteredIds: show_withdrawn=true ──────────────────");
{
  // show_withdrawn=true means withdrawn tournaments CAN appear in search results,
  // so their IDs must NOT be in the dedup set.
  const ids = buildRegisteredIds(MOCK_SCHEDULE_RESPONSE, { show_withdrawn: true });
  assert("REGISTERED included",          ids.has("AA000001-0001-0001-0001-000000000001"), true);
  assert("WITHDRAWN excluded from dedup",ids.has("BB000001-0001-0001-0001-000000000001"), false);
  assert("cancelled excluded",           ids.has("CC000001-0001-0001-0001-000000000001"), false);
  assert("total 2 ids",                  ids.size, 2);
}

// ─── Full output preview ──────────────────────────────────────────────────

console.log("\n── Sample formatted output (default schedule) ───────────────");
console.log(runGetUstaSchedule(MOCK_SCHEDULE_RESPONSE));
console.log("\n── Sample formatted output (include_withdrawn=true) ─────────");
console.log(runGetUstaSchedule(MOCK_SCHEDULE_RESPONSE, { include_withdrawn: true }));

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(52)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
