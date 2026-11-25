// When the Sports hub fetches, and what. Port of the native RadarLiveRefreshPolicy plus the
// repository's 15-minute full-refresh throttle (CLAUDE.md "recurring network work is
// delta-shaped, lifecycle-bound and cheap"). Pure: ids + fixtures + clock in, a decision out.
//
//  - full:  every followed league/team, at most every FULL_REFRESH_MS (schedule discovery).
//  - live:  every LIVE_TICK_MS, ONLY leagues/teams with a live or imminent fixture.
//  - none:  an idle slate makes no request at all.
// The caller owns the lifecycle: run only while the Sports screen is shown and the page visible.
import { isFinishedOrOff, maxLiveWindowMs, startMs } from "./sportsFixtures.js";

export const FULL_REFRESH_MS = 15 * 60_000;
export const LIVE_TICK_MS = 2 * 60_000;
/** A pre-game card joins the live tick this long before kick-off so it gains its score on time. */
export const PRE_KICKOFF_LEAD_MS = 30 * 60_000;

function isLiveOrImminent(fixture, nowMs, leadMs) {
  if (isFinishedOrOff(fixture)) return false;
  const start = startMs(fixture);
  return start != null && nowMs >= start - leadMs && nowMs < start + maxLiveWindowMs(fixture);
}

/** Leagues/teams on screen that have a live or imminent fixture. */
export function liveTargets({ leagueIds = [], teamIds = [], fixturesByLeague = {}, fixturesByTeam = {}, nowMs, leadMs = PRE_KICKOFF_LEAD_MS }) {
  const pick = (ids, byId) => [...new Set(ids)].filter(id => (byId[id] || []).some(f => isLiveOrImminent(f, nowMs, leadMs)));
  return { leagueIds: pick(leagueIds, fixturesByLeague), teamIds: pick(teamIds, fixturesByTeam) };
}

const remaining = (lastMs, nowMs, everyMs) => (lastMs == null ? 0 : Math.max(0, everyMs - (nowMs - lastMs)));

/**
 * One hub tick. Returns { kind: "full" | "live" | "none", targets?, nextCheckInMs }.
 * nextCheckInMs null = nothing followed, nothing to wake for.
 */
export function hubTick({ leagueIds = [], teamIds = [], fixturesByLeague = {}, fixturesByTeam = {}, nowMs, lastFullAtMs = null, lastLiveAtMs = null }) {
  if (!leagueIds.length && !teamIds.length) return { kind: "none", nextCheckInMs: null };
  const fullWait = remaining(lastFullAtMs, nowMs, FULL_REFRESH_MS);
  if (fullWait === 0) return { kind: "full", targets: { leagueIds: [...leagueIds], teamIds: [...teamIds] }, nextCheckInMs: LIVE_TICK_MS };
  const liveWait = remaining(Math.max(lastLiveAtMs ?? -Infinity, lastFullAtMs ?? -Infinity), nowMs, LIVE_TICK_MS);
  if (liveWait > 0) return { kind: "none", nextCheckInMs: Math.min(liveWait, fullWait) };
  const targets = liveTargets({ leagueIds, teamIds, fixturesByLeague, fixturesByTeam, nowMs });
  if (!targets.leagueIds.length && !targets.teamIds.length) return { kind: "none", nextCheckInMs: Math.min(LIVE_TICK_MS, fullWait) };
  return { kind: "live", targets, nextCheckInMs: Math.min(LIVE_TICK_MS, fullWait) };
}
