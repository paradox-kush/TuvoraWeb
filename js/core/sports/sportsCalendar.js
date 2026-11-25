// Fixtures grouped by the viewer's local day. Pure: pass a time zone (undefined = the device's).
// A date-only fixture (tennis/golf/cycling, `ts` = midnight UTC of the match day) keeps its own
// date everywhere: shifting it to local time would move it to the previous day west of UTC.
import { fixtureKey, isDateOnly, startMs } from "./sportsFixtures.js";

const formatters = new Map();
function formatterFor(timeZone) {
  const key = timeZone || "";
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }));
  }
  return formatters.get(key);
}

/** "YYYY-MM-DD" in the given zone for an epoch ms. */
export function localDayOf(epochMs, timeZone) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(epochMs)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dayKeyFor(fixture, timeZone) {
  const start = startMs(fixture);
  if (start == null) return null;
  if (isDateOnly(fixture)) return String(fixture.ts).trim().slice(0, 10);
  return localDayOf(start, timeZone);
}

/** [{ day, fixtures }] sorted by day, fixtures by kick-off. Rows without a time are dropped. */
export function groupByDay(fixtures, timeZone) {
  const byDay = new Map();
  (fixtures || []).forEach(fixture => {
    const day = dayKeyFor(fixture, timeZone);
    if (!day) return;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(fixture);
  });
  return [...byDay.keys()].sort().map(day => ({
    day,
    fixtures: byDay.get(day).sort((a, b) => startMs(a) - startMs(b) || String(a.id).localeCompare(String(b.id)))
  }));
}

/** Every fixture of the followed leagues and teams, once each. */
export function collectFixtures({ leagueIds = [], teamIds = [], fixturesByLeague = {}, fixturesByTeam = {} }) {
  const seen = new Map();
  [...leagueIds.map(id => fixturesByLeague[id]), ...teamIds.map(id => fixturesByTeam[id])]
    .forEach(list => (list || []).forEach(fixture => {
      const key = fixtureKey(fixture);
      if (!seen.has(key)) seen.set(key, fixture);
    }));
  return [...seen.values()];
}

/** Consecutive "YYYY-MM-DD" keys around `today` (a day key). */
export function dayStrip(today, { back = 7, ahead = 14 } = {}) {
  const [y, m, d] = today.split("-").map(Number);
  return Array.from({ length: back + ahead + 1 }, (_, i) => new Date(Date.UTC(y, m - 1, d - back + i)).toISOString().slice(0, 10));
}
