// What the game page should fetch now. Port of the native GameDetailRefreshPolicy, reduced to the
// one source the web app uses (the backend `game-detail` function; ESPN's 15 s overlay is phase 2).
// The backend caps a client at 20 requests a minute and caches live games 10 s, so the live cadence
// is 30 s. The caller runs this only while the game page is shown and the tab visible.

export const LIVE_MS = 30_000;
export const LEAD_MS = 30 * 60_000;
const STALE_UPCOMING_MS = 3 * 3_600_000;
const STALE_UPCOMING_RECHECK_MS = 5 * 60_000;
const MAX_LIVE_MS = 12 * 3_600_000;
const MAX_BACKOFF_SHIFT = 3;

const remaining = (lastMs, nowMs, everyMs) => (lastMs == null ? 0 : Math.max(0, everyMs - (nowMs - lastMs)));
const plan = wait => ({ fetch: wait === 0, nextCheckInMs: wait });
const IDLE = Object.freeze({ fetch: false, nextCheckInMs: null });

/** -> { fetch: boolean, nextCheckInMs: number | null } (null = stop, nothing will change). */
export function planGameRefresh({ state, startsAtMs, nowMs, lastFetchMs, consecutiveFailures = 0 }) {
  const backoff = 2 ** Math.min(Math.max(consecutiveFailures, 0), MAX_BACKOFF_SHIFT);
  const every = LIVE_MS * backoff;
  if (state === "final" || state === "postponed") return { ...IDLE };
  if (!Number.isFinite(startsAtMs)) return state === "live" ? plan(remaining(lastFetchMs, nowMs, every)) : { ...IDLE };
  if (state === "live") return nowMs - startsAtMs > MAX_LIVE_MS ? { ...IDLE } : plan(remaining(lastFetchMs, nowMs, every));
  const untilKickoff = startsAtMs - nowMs;
  if (untilKickoff > LEAD_MS) return { fetch: false, nextCheckInMs: untilKickoff - LEAD_MS };
  if (-untilKickoff > STALE_UPCOMING_MS) return plan(remaining(lastFetchMs, nowMs, STALE_UPCOMING_RECHECK_MS));
  return plan(remaining(lastFetchMs, nowMs, every));
}
