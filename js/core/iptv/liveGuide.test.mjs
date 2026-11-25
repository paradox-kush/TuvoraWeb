import test from "node:test";
import assert from "node:assert/strict";
import { nowNext, programmeProgress, planNowNextFetch } from "./liveGuide.js";

const P = (title, s, e) => ({ title, startMs: s, endMs: e });

test("now is start <= t < end; next is the first that starts after now", () => {
  const list = [P("C", 300, 400), P("A", 100, 200), P("B", 200, 300)];
  assert.deepEqual(nowNext(list, 250), { now: P("B", 200, 300), next: P("C", 300, 400) });
  assert.equal(nowNext(list, 200).now.title, "B");
  assert.deepEqual(nowNext(list, 50), { now: null, next: P("A", 100, 200) });
  assert.deepEqual(nowNext([], 1), { now: null, next: null });
});

test("progress is clamped 0..1", () => {
  assert.equal(programmeProgress(P("a", 100, 200), 150), 0.5);
  assert.equal(programmeProgress(P("a", 100, 200), 500), 1);
  assert.equal(programmeProgress(null, 1), 0);
});

test("fetch plan asks only for visible channels that are missing or whose programme ended", () => {
  const cache = new Map([
    ["a", { state: "loaded", validUntilMs: 1000 }],
    ["b", { state: "loaded", validUntilMs: 500 }],
    ["c", { state: "failed" }],
    ["d", { state: "loading" }]
  ]);
  const plan = planNowNextFetch({ visibleIds: ["a", "b", "c", "d", "e"], cache, nowMs: 600, maxBatch: 10 });
  assert.deepEqual(plan.fetch, ["b", "e"]);
  assert.equal(plan.wakeAtMs, 1000);
});

test("an idle slate fetches nothing; failed ones wait for Retry, never a loop", () => {
  const cache = new Map([["a", { state: "loaded", validUntilMs: 900 }], ["c", { state: "failed" }]]);
  const plan = planNowNextFetch({ visibleIds: ["a", "c"], cache, nowMs: 100 });
  assert.deepEqual(plan.fetch, []);
  assert.equal(plan.wakeAtMs, 900);
});

test("the batch is capped and nothing visible means no wake", () => {
  const plan = planNowNextFetch({ visibleIds: ["1", "2", "3", "4"], cache: new Map(), nowMs: 0, maxBatch: 2 });
  assert.deepEqual(plan.fetch, ["1", "2"]);
  assert.equal(planNowNextFetch({ visibleIds: [], cache: new Map(), nowMs: 0 }).wakeAtMs, null);
});
