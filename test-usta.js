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

// Throttle helpers — copied from index.js, must stay in sync.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function jitter(maxMs) {
  return Math.floor(Math.random() * maxMs);
}
{
  const _lastCallMs = new Map();
  globalThis._testThrottle = async function throttle(domain, minGapMs, jitterMs) {
    const now     = Date.now();
    const elapsed = now - (_lastCallMs.get(domain) ?? 0);
    const gap     = Math.max(0, minGapMs - elapsed);
    const wait    = gap + jitter(jitterMs);
    if (wait > 0) await sleep(wait);
    _lastCallMs.set(domain, Date.now());
  };
}

function parseUstaLevel(name = "") {
  const m = name.match(/Level\s*(\d+)/i);
  return m ? `L${m[1]}` : null;
}

function fmtUstaDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Copied from index.js — must stay in sync.
function fmtRegStatus(status) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "open")         return "Registration: Open";
  if (s.includes("closed")) return "Registration: Closed";
  if (s.includes("full"))   return "Registration: Full";
  if (s.includes("not yet") || s.includes("upcoming")) return "Registration: Not Yet Open";
  return `Registration: ${status}`;
}

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

console.log("\n── sleep / jitter ───────────────────────────────────────────");
{
  const t0 = Date.now();
  await sleep(50);
  const elapsed = Date.now() - t0;
  assert("sleep(50) waits at least 50ms", elapsed >= 50, true);
  assert("sleep(50) doesn't overshoot by >200ms", elapsed < 250, true);

  const samples = Array.from({ length: 200 }, () => jitter(100));
  assert("jitter always in [0, 100)",  samples.every(v => v >= 0 && v < 100), true);
  assert("jitter produces varied values", new Set(samples).size > 10, true);
}

console.log("\n── throttle: min-gap enforcement ───────────────────────────");
{
  const throttle = globalThis._testThrottle;

  // First call to a fresh domain should be near-instant (only jitter, no gap).
  const d1 = `test-domain-${Date.now()}`;
  const t1 = Date.now();
  await throttle(d1, 0, 10);       // minGap=0, jitter up to 10ms
  assert("first call completes quickly", Date.now() - t1 < 100, true);

  // Second call immediately after must wait at least minGapMs.
  const d2 = `test-domain-${Date.now()}-b`;
  await throttle(d2, 0, 0);        // prime the domain
  const t2 = Date.now();
  await throttle(d2, 80, 0);       // minGap=80ms, jitter=0 — deterministic wait
  const waited = Date.now() - t2;
  assert("second call waits minGapMs", waited >= 75, true);   // 5ms tolerance
  assert("second call doesn't wildly overshoot", waited < 300, true);

  // Third call after minGap has already elapsed should be near-instant.
  const d3 = `test-domain-${Date.now()}-c`;
  await throttle(d3, 0, 0);
  await sleep(100);                 // let more than minGap pass
  const t3 = Date.now();
  await throttle(d3, 50, 0);       // minGap=50 but 100ms already elapsed → no wait
  assert("call after gap elapsed is immediate", Date.now() - t3 < 50, true);
}

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

// ─── Mock ClubSpark search response ──────────────────────────────────────
// 7 results: 3 are already on Cole's schedule (2 registered + 1 withdrawn);
// 4 are open tournaments he has not yet signed up for.

const MOCK_CLUBSPARK_RESPONSE = {
  total: 7,
  results: [
    // Already registered (AA IDs match MOCK_SCHEDULE_RESPONSE REGISTERED entries)
    {
      id: "AA000001-0001-0001-0001-000000000001",
      name: "L6 Championships @ Masters School Spring 1 Boys 12U",
      tournamentLevel: "Level 6",
      startDate: "2026-05-03T00:00:00Z",
      endDate: "2026-05-03T23:59:59Z",
      location: { address: "The Masters School, Dobbs Ferry, NY 10522" },
      distance: 8.2,
      registrationStatus: "Open",
      organizationSlug: "masters-school",
    },
    {
      id: "AA000002-0002-0002-0002-000000000002",
      name: "L6 Championships @ Masters School Spring 2 Boys 12U",
      tournamentLevel: "Level 6",
      startDate: "2026-05-17T00:00:00Z",
      endDate: "2026-05-17T23:59:59Z",
      location: { address: "The Masters School, Dobbs Ferry, NY 10522" },
      distance: 8.2,
      registrationStatus: "Open",
      organizationSlug: "masters-school",
    },
    // Withdrawn (BB000001 matches MOCK_SCHEDULE_RESPONSE WITHDRAWN entry)
    {
      id: "BB000001-0001-0001-0001-000000000001",
      name: "L6 UnitedSets Greenwich Boys Girls 12U",
      tournamentLevel: "Level 6",
      startDate: "2026-05-01T00:00:00Z",
      endDate: "2026-05-01T23:59:59Z",
      location: { address: "Greenwich TC, Greenwich, CT 06830" },
      distance: 14.1,
      registrationStatus: "Open",
      organizationSlug: "unitedsets-greenwich",
    },
    // Open — Cole has NOT signed up for these four
    {
      id: "f3f8cd73-c646-4b08-aec9-6b021012edc4",
      name: "L7 SPORTIME Lake Isle May Championships Boys 12U",
      tournamentLevel: "Level 7",
      startDate: "2026-05-02T00:00:00Z",
      endDate: "2026-05-03T23:59:59Z",
      location: { address: "SPORTIME Lake Isle, Eastchester, NY 10709" },
      distance: 6.3,
      registrationStatus: "Open",
      organizationSlug: "sportime-lake-isle",
    },
    {
      id: "0db0271e-a3e9-4350-a4de-78ee6edad842",
      name: "L6 WTC Boys 12U Singles Doubles",
      tournamentLevel: "Level 6",
      startDate: "2026-05-02T00:00:00Z",
      endDate: "2026-05-03T23:59:59Z",
      location: { address: "Westchester Tennis Center, White Plains, NY 10601" },
      distance: 5.8,
      registrationStatus: "Open",
      organizationSlug: "westchestertenniscenter",
    },
    {
      id: "731fe4ed-89d7-4878-8be2-6d2a73fa0b45",
      name: "L7 WTC Boys 12U 14U 16U Singles Doubles",
      tournamentLevel: "Level 7",
      startDate: "2026-05-08T00:00:00Z",
      endDate: "2026-05-10T23:59:59Z",
      location: { address: "Westchester Tennis Center, White Plains, NY 10601" },
      distance: 5.8,
      registrationStatus: "Open",
      organizationSlug: "westchestertenniscenter",
    },
    {
      id: "facacf69-b26a-444f-9077-8338bdb7b14e",
      name: "L6 UnitedSets Greenwich Boys Girls 12U to 18U",
      tournamentLevel: "Level 6",
      startDate: "2026-05-01T00:00:00Z",
      endDate: "2026-05-03T23:59:59Z",
      location: { address: "Greenwich TC, Greenwich, CT 06830" },
      distance: 14.1,
      registrationStatus: "Open",
      organizationSlug: "unitedsets-greenwich",
    },
  ],
};

// ─── search_usta_tournaments logic (mirrors index.js handler) ─────────────

function runSearchUstaTournaments(scheduleData, searchData, opts = {}) {
  const {
    levels        = ["L6", "L7"],
    gender        = "boys",
    age_group     = "12U",
    show_withdrawn = false,
  } = opts;

  const registeredIds = buildRegisteredIds(scheduleData, { show_withdrawn });
  const allResults    = searchData?.results ?? [];
  const filtered      = filterClubSparkResults(allResults, { levels, gender, ageGroup: age_group });
  const open          = filtered.filter(t => !registeredIds.has(t.id));

  if (!open.length) {
    return `No open ${levels.join("/")} ${gender} ${age_group} tournaments found (${filtered.length} matched filters, ${registeredIds.size} already registered).`;
  }

  const lines = open.map(t => {
    const slug      = t.organizationSlug ?? "";
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

  return `## Open Tournaments — ${open.length} of ${filtered.length} matching (${registeredIds.size} already registered)\n\n${lines.join("\n\n")}`;
}

// ─── Tests: filterClubSparkResults ───────────────────────────────────────

console.log("\n── filterClubSparkResults: level filtering ──────────────────");
{
  const all = MOCK_CLUBSPARK_RESPONSE.results;
  const l6only = filterClubSparkResults(all, { levels: ["L6"] });
  assert("L6 filter: only Level 6 tournaments", l6only.every(t => t.tournamentLevel === "Level 6"), true);
  assert("L6 filter: count correct (5 L6 in mock)", l6only.length, 5);

  const l7only = filterClubSparkResults(all, { levels: ["L7"] });
  assert("L7 filter: count correct (2 L7 in mock)", l7only.length, 2);
  assert("L7 filter: only Level 7 tournaments", l7only.every(t => t.tournamentLevel === "Level 7"), true);

  const both = filterClubSparkResults(all, { levels: ["L6", "L7"] });
  assert("L6+L7 filter: all 7 pass", both.length, 7);

  const none = filterClubSparkResults(all, { levels: [] });
  assert("empty levels: all pass", none.length, 7);
}

console.log("\n── filterClubSparkResults: gender filtering ─────────────────");
{
  const all = MOCK_CLUBSPARK_RESPONSE.results;
  const boys = filterClubSparkResults(all, { gender: "boys" });
  assert("boys filter: all 7 mock results contain 'boys'", boys.length, 7);

  const girls = filterClubSparkResults(all, { gender: "girls" });
  // 2 of the 7 mock tournaments mention "Girls" in the name (BB000001 and facacf69)
  assert("girls filter: 2 mention girls", girls.length, 2);

  const noGender = filterClubSparkResults(all, { gender: "" });
  assert("empty gender: all pass", noGender.length, 7);
}

console.log("\n── filterClubSparkResults: age group filtering ───────────────");
{
  const all = MOCK_CLUBSPARK_RESPONSE.results;
  const u12 = filterClubSparkResults(all, { ageGroup: "12U" });
  assert("12U filter: all 7 contain 12U", u12.length, 7);

  const u16 = filterClubSparkResults(all, { ageGroup: "16U" });
  // Only the WTC L7 entry mentions "16U"
  assert("16U filter: 1 result", u16.length, 1);
  assert("16U filter: correct id", u16[0].id, "731fe4ed-89d7-4878-8be2-6d2a73fa0b45");
}

console.log("\n── filterClubSparkResults: no-match / edge cases ────────────");
{
  const all = MOCK_CLUBSPARK_RESPONSE.results;
  const l8 = filterClubSparkResults(all, { levels: ["L8"] });
  assert("L8 filter: zero results", l8.length, 0);

  const l6name = filterClubSparkResults([{
    id: "x",
    name: "L6 Open Boys 12U",
    tournamentLevel: "",  // level only in name
  }], { levels: ["L6"] });
  assert("level in name fallback: matched", l6name.length, 1);
}

// ─── Tests: search_usta_tournaments full flow ─────────────────────────────

console.log("\n── search_usta_tournaments: default (registered + withdrawn deduped) ──");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE);
  // 4 registered IDs in dedup set (AA001, AA002, BB001 withdrawn, BB002 withdrawn)
  // 7 total → 4 deduped → 3 open... wait:
  // BB002 is NOT in MOCK_CLUBSPARK_RESPONSE results, so only AA001, AA002, BB001 are deduped
  // → 7 - 3 = 4 open
  assertContains("header shows 4 open",          out, "4 of 7 matching");
  assertContains("header shows 4 already reg'd", out, "4 already registered");
  assertContains("SPORTIME appears",             out, "SPORTIME Lake Isle");
  assertContains("WTC L6 appears",               out, "L6 WTC Boys");
  assertContains("WTC L7 appears",               out, "L7 WTC Boys");
  assertContains("UnitedSets L6 18U appears",    out, "12U to 18U");
  assert("registered Spring 1 not shown",        out.includes("Spring 1"), false);
  assert("registered Spring 2 not shown",        out.includes("Spring 2"), false);
  assert("withdrawn Greenwich not shown",        out.includes("BB000001"), false);
}

console.log("\n── search_usta_tournaments: show_withdrawn=true ─────────────");
{
  // With show_withdrawn=true, withdrawn IDs are NOT in dedup set → they appear in results
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE, { show_withdrawn: true });
  // Dedup set now only has REGISTERED: AA001, AA002 (2 IDs)
  // 7 - 2 = 5 open
  assertContains("5 open with show_withdrawn",   out, "5 of 7 matching");
  assertContains("withdrawn Greenwich now shown", out, "UnitedSets Greenwich Boys Girls 12U **(L6)**");
}

console.log("\n── fmtRegStatus ─────────────────────────────────────────────");
assert("Open",                fmtRegStatus("Open"),                  "Registration: Open");
assert("open lowercase",      fmtRegStatus("open"),                  "Registration: Open");
assert("Closed",              fmtRegStatus("Closed"),                "Registration: Closed");
assert("Registration Closed", fmtRegStatus("Registration Closed"),   "Registration: Closed");
assert("Full",                fmtRegStatus("Full"),                  "Registration: Full");
assert("Wait List Full",      fmtRegStatus("Wait List Full"),        "Registration: Full");
assert("Not Yet Open",        fmtRegStatus("Not Yet Open"),          "Registration: Not Yet Open");
assert("Upcoming",            fmtRegStatus("Upcoming"),              "Registration: Not Yet Open");
assert("unknown status",      fmtRegStatus("Pending"),               "Registration: Pending");
assert("null",                fmtRegStatus(null),                    null);
assert("undefined",           fmtRegStatus(undefined),               null);

console.log("\n── search_usta_tournaments: registration status in output ───");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE);
  // All mock results have registrationStatus: "Open"
  assertContains("registration status shown bold", out, "**Registration: Open**");
  assert("plain 'Registration: Open' not shown unbolded",
    out.split("**Registration: Open**").length > 1, true);
}
{
  // Verify a Closed tournament is formatted correctly
  const closedResult = { results: [{
    id: "zz000001",
    name: "L6 Closed Tournament Boys 12U",
    tournamentLevel: "Level 6",
    startDate: "2026-06-01T00:00:00Z",
    endDate:   "2026-06-01T23:59:59Z",
    distance: 10,
    registrationStatus: "Closed",
    organizationSlug: "some-club",
  }]};
  const out = runSearchUstaTournaments({ data: { players: [{ registrations: [] }] } }, closedResult);
  assertContains("closed status shown",   out, "**Registration: Closed**");
  assertContains("sign up URL present",   out, "https://playtennis.usta.com/Competitions/some-club/Tournaments/Overview/zz000001");
}
{
  // Verify a tournament with a registration deadline shows it
  const deadlineResult = { results: [{
    id: "zz000002",
    name: "L7 Deadline Tournament Boys 12U",
    tournamentLevel: "Level 7",
    startDate: "2026-06-15T00:00:00Z",
    endDate:   "2026-06-15T23:59:59Z",
    distance: 5,
    registrationStatus: "Open",
    registrationDeadline: "2026-06-10",
    organizationSlug: "some-club",
  }]};
  const out = runSearchUstaTournaments({ data: { players: [{ registrations: [] }] } }, deadlineResult);
  assertContains("deadline shown",        out, "**Registration Deadline:** Jun 10, 2026");
  assertContains("status also shown",     out, "**Registration: Open**");
}

console.log("\n── search_usta_tournaments: URL construction ─────────────────");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE);
  assertContains("Sign Up label present",         out, "**Sign Up / Info:**");
  assertContains("playtennis URL for SPORTIME",   out, "https://playtennis.usta.com/Competitions/sportime-lake-isle/Tournaments/Overview/f3f8cd73-c646-4b08-aec9-6b021012edc4");
  assertContains("playtennis URL for WTC",        out, "https://playtennis.usta.com/Competitions/westchestertenniscenter/Tournaments/Overview/0db0271e-a3e9-4350-a4de-78ee6edad842");
  assert("old '**URL:**' label gone",             out.includes("**URL:**"), false);
}

console.log("\n── search_usta_tournaments: level tags in output ─────────────");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE);
  assertContains("L6 tag present",  out, "**(L6)**");
  assertContains("L7 tag present",  out, "**(L7)**");
}

console.log("\n── search_usta_tournaments: multi-day date range in output ───");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE);
  assertContains("multi-day range for WTC L7", out, "May 8, 2026 – May 10, 2026");
}

console.log("\n── search_usta_tournaments: empty search results ────────────");
{
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, { results: [] });
  assertContains("empty no-match message", out, "No open L6/L7 boys 12U tournaments found");
}

console.log("\n── search_usta_tournaments: all results already registered ──");
{
  const onlyRegistered = { results: MOCK_CLUBSPARK_RESPONSE.results.slice(0, 2) };
  const out = runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, onlyRegistered);
  assertContains("all-registered message", out, "No open L6/L7 boys 12U tournaments found");
}

console.log("\n── Sample formatted tournament search output ─────────────────");
console.log(runSearchUstaTournaments(MOCK_SCHEDULE_RESPONSE, MOCK_CLUBSPARK_RESPONSE));

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(52)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
