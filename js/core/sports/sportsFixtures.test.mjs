import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTimestamp, isDateOnly, isFinishedOrOff, inferredLive, isUpcomingWindow,
  fixtureKey, displayTitle, roundLabel, maxLiveWindowMs
} from "./sportsFixtures.js";

const HOUR = 3_600_000;
const at = iso => Date.parse(iso);

test("timestamps are UTC, accept a space separator and a trailing Z, and reject junk", () => {
  assert.equal(parseTimestamp("2026-07-02T14:00:00"), at("2026-07-02T14:00:00Z"));
  assert.equal(parseTimestamp("2026-07-02 14:00:00"), at("2026-07-02T14:00:00Z"));
  assert.equal(parseTimestamp("2026-07-02T14:00:00Z"), at("2026-07-02T14:00:00Z"));
  assert.equal(parseTimestamp("2026-07-02"), at("2026-07-02T00:00:00Z"));
  for (const bad of [null, "", "soon", "2026-13-40T00:00:00"]) assert.equal(parseTimestamp(bad), null);
});

test("tennis, golf and cycling rows at midnight are date-only; soccer at midnight is a real kick-off", () => {
  assert.equal(isDateOnly({ sport: "Tennis", ts: "2026-07-02T00:00:00" }), true);
  assert.equal(isDateOnly({ sport: "Golf", ts: "2026-07-02" }), true);
  assert.equal(isDateOnly({ sport: "Tennis", ts: "2026-07-02T13:00:00" }), false);
  assert.equal(isDateOnly({ sport: "Soccer", ts: "2026-07-02T00:00:00" }), false);
});

test("finished, postponed and cancelled statuses are never live", () => {
  for (const status of ["FT", "Match Finished", "AET", "final_ot", "Postponed", "CANC", "Cancelled", "abandoned"]) {
    assert.equal(isFinishedOrOff({ status }), true, status);
  }
  assert.equal(isFinishedOrOff({ postponed: "yes" }), true);
  for (const status of ["NS", "1H", "HT", "", null]) assert.equal(isFinishedOrOff({ status }), false, String(status));
});

test("inferred live covers kick-off to the sport's typical duration only", () => {
  const f = { sport: "Soccer", ts: "2026-07-02T14:00:00" };
  assert.equal(inferredLive(f, at("2026-07-02T13:59:00Z")), false);
  assert.equal(inferredLive(f, at("2026-07-02T15:00:00Z")), true);
  assert.equal(inferredLive(f, at("2026-07-02T16:31:00Z")), false);
  assert.equal(inferredLive({ ...f, postponed: "yes" }, at("2026-07-02T15:00:00Z")), false);
  assert.equal(maxLiveWindowMs({ sport: "Soccer" }), 4.5 * HOUR);
});

test("upcoming holds a kick-off for 4 h and a date-only day for 36 h", () => {
  const kick = { sport: "Soccer", ts: "2026-07-02T14:00:00" };
  assert.equal(isUpcomingWindow(kick, at("2026-07-02T17:59:00Z")), true);
  assert.equal(isUpcomingWindow(kick, at("2026-07-02T18:01:00Z")), false);
  const day = { sport: "Tennis", ts: "2026-07-02T00:00:00" };
  assert.equal(isUpcomingWindow(day, at("2026-07-03T11:00:00Z")), true);
  assert.equal(isUpcomingWindow(day, at("2026-07-03T12:01:00Z")), false);
});

test("keys, titles and round labels match the native app", () => {
  assert.equal(fixtureKey({ id: "42" }), "42");
  assert.equal(fixtureKey({ leagueId: "4370", event: "Monaco GP", ts: "2026-06-07T13:00:00" }), "4370/Monaco GP/2026-06-07T13:00:00");
  assert.equal(displayTitle({ home: "Arsenal", away: "Chelsea" }), "Arsenal v Chelsea");
  assert.equal(displayTitle({ event: "Monaco Grand Prix" }), "Monaco Grand Prix");
  assert.equal(roundLabel({ sport: "Soccer", round: "150" }), "Semi-final");
  assert.equal(roundLabel({ sport: "Soccer", round: "12" }), "Round 12");
  assert.equal(roundLabel({ sport: "Tennis", round: "57" }), null);
  assert.equal(roundLabel({ sport: "Soccer", round: "0" }), null);
});
