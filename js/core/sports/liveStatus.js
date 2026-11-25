// What a card says about a live game. Port of the native RadarUiState.isLive,
// LiveStatusPolicy and RadarCalendarGames.stateOf (NuvioMobile features/radar).
import { isFinishedOrOff, isPostponed, inferredLive, maxLiveWindowMs, startMs } from "./sportsFixtures.js";

const HOUR = 3_600_000;
const PRE_KICKOFF_GRACE_MS = 10 * 60_000;
const PERIOD_SPORTS = new Set(["ice hockey", "basketball", "american football"]);

/** Longest a game of this sport plausibly stays live: the backstop for a lagging feed. */
export function displayMaxLiveMs(sport) {
  switch (String(sport ?? "").toLowerCase()) {
    case "ice hockey": return 3.75 * HOUR;
    case "basketball": return 3.5 * HOUR;
    case "american football": return 4.25 * HOUR;
    case "soccer": return 3.25 * HOUR;
    case "baseball": return 5 * HOUR;
    default: return Infinity;
  }
}

/**
 * liveState: { liveEventIds:Set, livescoreSports:Set (sports with FRESH, non-empty feed data), liveScores:Map }.
 */
export function isLive(fixture, liveState, nowMs) {
  if (isFinishedOrOff(fixture)) return false;
  const start = startMs(fixture);
  if (start != null) {
    if (nowMs < start - PRE_KICKOFF_GRACE_MS) return false;
    if (nowMs >= start + Math.min(maxLiveWindowMs(fixture), displayMaxLiveMs(fixture.sport))) return false;
  }
  const feedConfirmed = fixture?.id != null && Boolean(liveState?.liveEventIds?.has(String(fixture.id)));
  const sport = String(fixture?.sport ?? "").toLowerCase();
  if (sport && liveState?.livescoreSports?.has(sport)) return feedConfirmed;
  return feedConfirmed || inferredLive(fixture, nowMs);
}

/** "live" | "final" | "upcoming" | "postponed". */
export function gameState(fixture, liveState, nowMs) {
  if (isPostponed(fixture)) return "postponed";
  if (isLive(fixture, liveState, nowMs)) return "live";
  const start = startMs(fixture);
  if (start == null) return "upcoming";
  return isFinishedOrOff(fixture) || nowMs >= start + maxLiveWindowMs(fixture) ? "final" : "upcoming";
}

/** The text after "LIVE": the feed minute, but never for period sports (the minute means nothing there). */
export function badgeProgress(sport, rawProgress) {
  if (PERIOD_SPORTS.has(String(sport ?? "").toLowerCase())) return null;
  const value = String(rawProgress ?? "").trim();
  return value || null;
}

/** The livescore feed's status for period sports is the period itself ("Q2", "P3", "OT", "HT"). */
export function periodFromStatus(sport, status) {
  if (!PERIOD_SPORTS.has(String(sport ?? "").toLowerCase())) return null;
  const value = String(status ?? "").trim().toUpperCase();
  return /^(Q[1-4]|P[1-3]|[1-4](ST|ND|RD|TH)|OT\d?|HT|BT|SO)$/.test(value) ? value : null;
}

export const EMPTY_LIVE_STATE = Object.freeze({ liveEventIds: new Set(), livescoreSports: new Set(), liveScores: new Map() });

/** A radar-fixtures response's livescore lanes as live state. An EMPTY lane is not coverage. */
export function liveStateFromResponse(response) {
  const liveEventIds = new Set();
  const livescoreSports = new Set();
  const liveScores = new Map();
  Object.entries(response?.livescore || {}).forEach(([sport, rows]) => {
    if (!Array.isArray(rows) || !rows.length) return;
    livescoreSports.add(sport.toLowerCase());
    rows.forEach(row => {
      if (row?.eventId == null) return;
      liveEventIds.add(String(row.eventId));
      liveScores.set(String(row.eventId), row);
    });
  });
  return { liveEventIds, livescoreSports, liveScores };
}

/** A live tick adds to what the last full refresh knew; the full refresh replaces it. */
export function mergeLiveState(base, tick) {
  return {
    liveEventIds: new Set([...(base?.liveEventIds || []), ...(tick?.liveEventIds || [])]),
    livescoreSports: new Set([...(base?.livescoreSports || []), ...(tick?.livescoreSports || [])]),
    liveScores: new Map([...(base?.liveScores || []), ...(tick?.liveScores || [])])
  };
}
