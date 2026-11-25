// Sports Centre fixtures: pure rules ported from the native apps' RadarFixture
// (NuvioMobile features/radar/RadarModels.kt). A fixture is the radar-fixtures
// edge function's row: { id, leagueId, league, sport, home, away, event, ts, status,
// postponed, homeScore, awayScore, round, venue, homeBadge, awayBadge, leagueBadge, ... }.
// `ts` is UTC without a zone ("2026-07-02T14:00:00", TheSportsDB strTimestamp).

const HOUR = 3_600_000;
const DAY_LONG_SPORTS = new Set(["tennis", "golf", "cycling"]);
const UPCOMING_GRACE_MS = 4 * HOUR;
const DATE_ONLY_HOLD_MS = 36 * HOUR;
const LIVE_WINDOW_GRACE_MS = 2 * HOUR;

/** Sports the TheSportsDB livescore feed covers; everything else infers live from the clock. */
export const LIVESCORE_SPORTS = new Set(["soccer", "american football", "basketball", "baseball", "ice hockey"]);

const FINISHED_STATUSES = new Set([
  "match finished", "finished", "game finished", "ft", "aet", "pen", "ft pen", "aot",
  "final", "final ot", "ended", "cancelled", "canceled", "postponed", "abandoned",
  "awarded", "walkover", "wo", "canc", "pst", "abd"
]);

const TYPICAL_HOURS = {
  soccer: 2.5, basketball: 3, "american football": 4, baseball: 4, "ice hockey": 3,
  motorsport: 4, fighting: 6, rugby: 2.5, "australian football": 3, cricket: 9,
  tennis: 10, golf: 10, cycling: 10
};

const lower = value => String(value ?? "").trim().toLowerCase();

/** UTC "YYYY-MM-DD[T| ]HH:MM:SS[Z]" -> epoch ms, or null. */
export function parseTimestamp(ts) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\.\d+)?Z?)?$/.exec(String(ts ?? "").trim());
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const check = new Date(ms);
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d) return null;
  return ms;
}

export const startMs = fixture => parseTimestamp(fixture?.ts);

/** Tennis/golf/cycling rows carry a date only: `ts` is midnight UTC of the match day, not a start time. */
export function isDateOnly(fixture) {
  if (!DAY_LONG_SPORTS.has(lower(fixture?.sport))) return false;
  const time = String(fixture?.ts ?? "").trim().replace(" ", "T").split("T")[1] || "";
  return /^[0:.]*Z?$/.test(time);
}

export function typicalDurationMs(sport) {
  return (TYPICAL_HOURS[lower(sport)] ?? 3) * HOUR;
}

/** The longest a fixture can plausibly still be live: typical duration plus overrun grace. */
export function maxLiveWindowMs(fixture) {
  return typicalDurationMs(fixture?.sport) + LIVE_WINDOW_GRACE_MS;
}

export function isPostponed(fixture) {
  const status = lower(fixture?.status).replace(/_/g, " ");
  return fixture?.postponed === "yes" || /postpone|cancel|canc\b|abandon|^pst$|^abd$/.test(status);
}

/** Finished, postponed or cancelled: never live, however stale the livescore feed is. */
export function isFinishedOrOff(fixture) {
  if (fixture?.postponed === "yes") return true;
  const status = lower(fixture?.status).replace(/_/g, " ");
  if (!status) return false;
  return FINISHED_STATUSES.has(status) || status.includes("finish") || status.includes("full time")
    || status.includes("full-time") || status.startsWith("final") || status.includes("ended");
}

/** In its live window by the clock alone. */
export function inferredLive(fixture, nowMs) {
  if (fixture?.postponed === "yes") return false;
  const start = startMs(fixture);
  return start != null && nowMs >= start && nowMs < start + typicalDurationMs(fixture.sport);
}

/** Still belongs in "upcoming": a kick-off for 4 h, a date-only day for 36 h (UTC-12..UTC+14 slack). */
export function isUpcomingWindow(fixture, nowMs) {
  const start = startMs(fixture);
  if (start == null) return false;
  return nowMs < start + (isDateOnly(fixture) ? DATE_ONLY_HOLD_MS : UPCOMING_GRACE_MS);
}

export function fixtureKey(fixture) {
  const id = String(fixture?.id ?? "").trim();
  return id || `${fixture?.leagueId}/${fixture?.event}/${fixture?.ts}`;
}

export function hasTeams(fixture) {
  return Boolean(String(fixture?.home ?? "").trim() && String(fixture?.away ?? "").trim());
}

export function displayTitle(fixture) {
  if (hasTeams(fixture)) return `${fixture.home} v ${fixture.away}`;
  return String(fixture?.event || fixture?.league || "").trim();
}

const ROUND_NAMES = { 125: "Quarter-final", 150: "Semi-final", 160: "Third place", 200: "Final", 500: "Play-off" };

/** TheSportsDB intRound -> label. Tennis' intRound is the tour week, never a round. */
export function roundLabel(fixture) {
  if (lower(fixture?.sport) === "tennis") return null;
  const round = String(fixture?.round ?? "").trim();
  if (!round || round === "0") return null;
  return ROUND_NAMES[round] || `Round ${round}`;
}
