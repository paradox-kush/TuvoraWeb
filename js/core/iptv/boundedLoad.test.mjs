import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedLoad } from "./boundedLoad.js";
import { LoadFailure } from "./iptvSourceCapability.js";

test("a load that returns items ends Loaded, an empty one ends Empty", async () => {
  assert.deepEqual(await runBoundedLoad(async () => [1], { deadlineMs: 50 }), { state: "loaded", value: [1], failure: "" });
  assert.equal((await runBoundedLoad(async () => [], { deadlineMs: 50 })).state, "empty");
});

test("a load that never returns ends Failed(timeout) at the deadline and is aborted", async () => {
  let aborted = false;
  const result = await runBoundedLoad(
    (signal) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })),
    { deadlineMs: 20 }
  );
  assert.deepEqual(result, { state: "failed", value: null, failure: LoadFailure.Timeout });
  assert.equal(aborted, true);
});

test("a blocked fetch is Failed(blocked-by-source), never Empty", async () => {
  const result = await runBoundedLoad(async () => { throw new TypeError("Failed to fetch"); }, { deadlineMs: 50 });
  assert.equal(result.state, "failed");
  assert.equal(result.failure, LoadFailure.BlockedBySource);
});

test("an http status error carries through as a source error", async () => {
  const error = Object.assign(new Error("HTTP 403"), { httpStatus: 403 });
  const result = await runBoundedLoad(async () => { throw error; }, { deadlineMs: 50 });
  assert.equal(result.failure, LoadFailure.SourceError);
});

test("an outer abort (screen left) ends Failed without waiting", async () => {
  const outer = new AbortController();
  const pending = runBoundedLoad((signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), {
    deadlineMs: 10000,
    signal: outer.signal
  });
  outer.abort();
  assert.equal((await pending).state, "failed");
});
