// Every Live TV load ends: Loaded, Empty or Failed within a deadline (the apps' BoundedLoad).
// The deadline lives here, not in the work, so a provider that trickles bytes or never answers
// still ends the wait; the work is aborted. A failure is never reported as Empty.
import { classifyLoadFailure } from "./iptvSourceCapability.js";

/** Deadlines in ms, matching the apps' BoundedLoad stall budgets. */
export const LiveDeadlines = Object.freeze({
  Playlists: 25_000,
  Channels: 25_000,
  NowNext: 20_000
});

function isEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (Array.isArray(value.channels)) return value.channels.length === 0;
  return false;
}

export async function runBoundedLoad(work, { deadlineMs = LiveDeadlines.Channels, signal = null, isEmptyValue = isEmpty } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ timedOut: true });
    }, deadlineMs);
  });
  const outerAbort = new Promise((resolve) => {
    controller.signal.addEventListener("abort", () => resolve({ aborted: true }), { once: true });
  });
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => work(controller.signal))
        .then((value) => ({ value }), (error) => ({ error })),
      deadline,
      outerAbort
    ]);
    if (outcome.timedOut || (timedOut && !("value" in outcome))) {
      return { state: "failed", value: null, failure: classifyLoadFailure({ timedOut: true }) };
    }
    if (outcome.aborted) {
      return { state: "failed", value: null, failure: classifyLoadFailure({ timedOut: true }) };
    }
    if ("error" in outcome) {
      const error = outcome.error;
      return {
        state: "failed",
        value: null,
        failure: classifyLoadFailure({ error, httpStatus: Number(error?.httpStatus) || 0, timedOut })
      };
    }
    return isEmptyValue(outcome.value)
      ? { state: "empty", value: outcome.value, failure: "" }
      : { state: "loaded", value: outcome.value, failure: "" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onOuterAbort);
  }
}
