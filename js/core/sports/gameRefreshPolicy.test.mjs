import assert from "node:assert/strict";
import test from "node:test";
import { planGameRefresh, LIVE_MS, LEAD_MS } from "./gameRefreshPolicy.js";

const kickoff = Date.parse("2026-11-29T16:30:00Z");

test("final and postponed games make no request and schedule nothing", () => {
  for (const state of ["final", "postponed"]) {
    assert.deepEqual(planGameRefresh({ state, startsAtMs: kickoff, nowMs: kickoff, lastFetchMs: null }), { fetch: false, nextCheckInMs: null });
  }
});

test("a far-off game sleeps until the pre-kick-off window opens", () => {
  const nowMs = kickoff - LEAD_MS - 60_000;
  assert.deepEqual(planGameRefresh({ state: "upcoming", startsAtMs: kickoff, nowMs, lastFetchMs: nowMs - 1000 }), { fetch: false, nextCheckInMs: 60_000 });
});

test("a live game refreshes on the live cadence", () => {
  const nowMs = kickoff + 600_000;
  assert.deepEqual(planGameRefresh({ state: "live", startsAtMs: kickoff, nowMs, lastFetchMs: nowMs - LIVE_MS }), { fetch: true, nextCheckInMs: 0 });
  assert.deepEqual(planGameRefresh({ state: "live", startsAtMs: kickoff, nowMs, lastFetchMs: nowMs - 10_000 }), { fetch: false, nextCheckInMs: LIVE_MS - 10_000 });
});

test("failures back off 2x, 4x, 8x and no further", () => {
  const nowMs = kickoff + 600_000;
  const wait = failures => planGameRefresh({ state: "live", startsAtMs: kickoff, nowMs, lastFetchMs: nowMs, consecutiveFailures: failures }).nextCheckInMs;
  assert.deepEqual([0, 1, 2, 3, 9].map(wait), [LIVE_MS, 2 * LIVE_MS, 4 * LIVE_MS, 8 * LIVE_MS, 8 * LIVE_MS]);
});

test("a game still live 12 hours after kick-off stops polling", () => {
  assert.equal(planGameRefresh({ state: "live", startsAtMs: kickoff, nowMs: kickoff + 13 * 3_600_000, lastFetchMs: null }).nextCheckInMs, null);
});

test("a game hours past kick-off still marked upcoming is checked slowly", () => {
  const nowMs = kickoff + 4 * 3_600_000;
  assert.deepEqual(planGameRefresh({ state: "upcoming", startsAtMs: kickoff, nowMs, lastFetchMs: nowMs - 60_000 }), { fetch: false, nextCheckInMs: 240_000 });
});

test("the live cadence respects the backend's 20 requests a minute per client", () => {
  assert.ok(LIVE_MS >= 30_000);
});
