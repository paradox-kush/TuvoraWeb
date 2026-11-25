import assert from "node:assert/strict";
import test from "node:test";
import { paintThenFillProfile } from "./profileChip.js";

test("the screen paints before the profile lookup settles, and the chip fills in when it resolves", async () => {
  const events = [];
  let resolveProfile;
  const profile = new Promise(resolve => { resolveProfile = resolve; });
  const done = paintThenFillProfile({
    paint: chip => events.push(["paint", chip]),
    loadProfile: () => profile,
    fill: chip => events.push(["fill", chip]),
    isCurrent: () => true,
    deadlineMs: 1000
  });
  assert.deepEqual(events, [["paint", null]], "painted synchronously with the fallback chip");
  resolveProfile({ activeProfileName: "Home" });
  await done;
  assert.deepEqual(events, [["paint", null], ["fill", { activeProfileName: "Home" }]]);
});

test("a profile lookup stuck behind other traffic never blocks the screen and is dropped at its deadline", async () => {
  const events = [];
  const started = Date.now();
  await paintThenFillProfile({
    paint: chip => events.push(["paint", chip]),
    loadProfile: () => new Promise(() => {}),
    fill: chip => events.push(["fill", chip]),
    isCurrent: () => true,
    deadlineMs: 30
  });
  assert.deepEqual(events, [["paint", null]], "the fallback chip stays");
  assert.ok(Date.now() - started < 500);
});

test("a failed or late lookup does not touch a screen that was left", async () => {
  const events = [];
  await paintThenFillProfile({ paint: () => events.push("paint"), loadProfile: () => Promise.reject(new Error("x")), fill: () => events.push("fill"), isCurrent: () => true, deadlineMs: 100 });
  await paintThenFillProfile({ paint: () => events.push("paint"), loadProfile: async () => ({}), fill: () => events.push("fill"), isCurrent: () => false, deadlineMs: 100 });
  assert.deepEqual(events, ["paint", "paint"]);
});
