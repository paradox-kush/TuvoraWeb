// Live guide decisions. Pure.
// nowNext mirrors the apps' GuideNowNextPolicy. planNowNextFetch is the refresh policy:
// delta-shaped (only visible channels whose programme is missing or over), no timer polling
// (the caller wakes once at wakeAtMs, the earliest programme end, and only while visible),
// and a failed fetch waits for the viewer's Retry instead of looping.

export function nowNext(programmes = [], nowMs = Date.now()) {
  const sorted = [...(programmes || [])].sort((a, b) => a.startMs - b.startMs);
  const now = sorted.find((p) => p.startMs <= nowMs && nowMs < p.endMs) || null;
  const next = sorted.find((p) => p.startMs > nowMs && (!now || p.startMs >= now.endMs)) || null;
  return { now, next };
}

export function programmeProgress(programme, nowMs = Date.now()) {
  if (!programme || !(programme.endMs > programme.startMs)) return 0;
  const value = (nowMs - programme.startMs) / (programme.endMs - programme.startMs);
  return Math.min(1, Math.max(0, value));
}

export const NOW_NEXT_BATCH = 12;

/**
 * cache: Map<channelId, { state: "loading" | "loaded" | "failed", validUntilMs? }>
 * Returns the ids to fetch now and when (if ever) to look again.
 */
export function planNowNextFetch({ visibleIds = [], cache = new Map(), nowMs = Date.now(), maxBatch = NOW_NEXT_BATCH } = {}) {
  const fetch = [];
  let wakeAtMs = null;
  for (const id of visibleIds) {
    const entry = cache.get(id);
    if (!entry) {
      if (fetch.length < maxBatch) fetch.push(id);
      continue;
    }
    if (entry.state === "loading" || entry.state === "failed") continue;
    const until = Number(entry.validUntilMs);
    if (!Number.isFinite(until) || until <= nowMs) {
      if (fetch.length < maxBatch) fetch.push(id);
      continue;
    }
    wakeAtMs = wakeAtMs === null ? until : Math.min(wakeAtMs, until);
  }
  return { fetch, wakeAtMs };
}

/** How long a now/next answer stays true: until the current programme ends (or 30 min if none). */
export function nowNextValidUntil(programmes = [], nowMs = Date.now()) {
  const { now, next } = nowNext(programmes, nowMs);
  if (now) return now.endMs;
  if (next) return next.startMs;
  return nowMs + 30 * 60 * 1000;
}
