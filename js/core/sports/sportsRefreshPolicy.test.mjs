import assert from "node:assert/strict";
import test from "node:test";
import { liveTargets, hubTick, FULL_REFRESH_MS, LIVE_TICK_MS } from "./sportsRefreshPolicy.js";

const at = iso => Date.parse(iso);
const now = at("2026-11-29T16:45:00Z");
const fixturesByLeague = {
  epl: [{ id: "a", sport: "Soccer", ts: "2026-11-29T16:30:00", status: "1H" }],          // live
  nba: [{ id: "b", sport: "Basketball", ts: "2026-11-29T17:05:00", status: "NS" }],     // imminent (20 min)
  nfl: [{ id: "c", sport: "American Football", ts: "2026-11-30T18:00:00", status: "NS" }], // tomorrow
  ucl: [{ id: "d", sport: "Soccer", ts: "2026-11-29T16:00:00", status: "FT" }],          // finished
  browsed: [{ id: "e", sport: "Soccer", ts: "2026-11-29T16:30:00", status: "1H" }]       // live, not on screen
};
const fixturesByTeam = { ars: [{ id: "a", sport: "Soccer", ts: "2026-11-29T16:30:00", status: "1H" }], lal: [] };

test("the live tick targets only on-screen leagues and teams with a live or imminent game", () => {
  const targets = liveTargets({
    leagueIds: ["epl", "nba", "nfl", "ucl"], teamIds: ["ars", "lal"], fixturesByLeague, fixturesByTeam, nowMs: now
  });
  assert.deepEqual(targets.leagueIds, ["epl", "nba"]);
  assert.deepEqual(targets.teamIds, ["ars"]);
});

test("an idle slate makes no request at all", () => {
  const targets = liveTargets({ leagueIds: ["nfl", "ucl"], teamIds: ["lal"], fixturesByLeague, fixturesByTeam, nowMs: now });
  assert.deepEqual(targets, { leagueIds: [], teamIds: [] });
  const tick = hubTick({ leagueIds: ["nfl", "ucl"], teamIds: ["lal"], fixturesByLeague, fixturesByTeam, nowMs: now,
    lastFullAtMs: now - LIVE_TICK_MS, lastLiveAtMs: now - LIVE_TICK_MS });
  assert.equal(tick.kind, "none");
  assert.ok(tick.nextCheckInMs > 0 && tick.nextCheckInMs <= FULL_REFRESH_MS);
});

test("a full refresh runs first, then every 15 minutes; fast ticks every 2 minutes in between", () => {
  const base = { leagueIds: ["epl", "nfl"], teamIds: [], fixturesByLeague, fixturesByTeam, nowMs: now };
  assert.equal(hubTick({ ...base, lastFullAtMs: null, lastLiveAtMs: null }).kind, "full");
  assert.equal(hubTick({ ...base, lastFullAtMs: now - FULL_REFRESH_MS, lastLiveAtMs: now - 1000 }).kind, "full");
  const live = hubTick({ ...base, lastFullAtMs: now - 5 * 60_000, lastLiveAtMs: now - LIVE_TICK_MS });
  assert.equal(live.kind, "live");
  assert.deepEqual(live.targets.leagueIds, ["epl"]);
  const wait = hubTick({ ...base, lastFullAtMs: now - 5 * 60_000, lastLiveAtMs: now - 30_000 });
  assert.equal(wait.kind, "none");
  assert.equal(wait.nextCheckInMs, LIVE_TICK_MS - 30_000);
});

test("nothing followed means nothing to fetch, ever", () => {
  const tick = hubTick({ leagueIds: [], teamIds: [], fixturesByLeague: {}, fixturesByTeam: {}, nowMs: now, lastFullAtMs: null, lastLiveAtMs: null });
  assert.equal(tick.kind, "none");
  assert.equal(tick.nextCheckInMs, null);
});

test("FULL_REFRESH_MS is 15 minutes and LIVE_TICK_MS is 2 minutes", () => {
  assert.equal(FULL_REFRESH_MS, 15 * 60_000);
  assert.equal(LIVE_TICK_MS, 2 * 60_000);
});
