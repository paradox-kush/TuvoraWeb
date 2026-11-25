import assert from "node:assert/strict";
import test from "node:test";
import { withDeadline, LoadTimeoutError } from "./boundedLoad.js";

test("a load that answers in time resolves with its value", async () => {
  assert.equal(await withDeadline(async () => 42, 1000), 42);
});

test("a load that never answers fails at the deadline and is aborted", async () => {
  let aborted = false;
  const never = signal => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); });
  await assert.rejects(withDeadline(never, 20), LoadTimeoutError);
  assert.equal(aborted, true);
});

test("a failing load rejects with its own error, never an empty value", async () => {
  await assert.rejects(withDeadline(async () => { throw new Error("502"); }, 1000), /502/);
});
