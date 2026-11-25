import assert from "node:assert/strict";
import test from "node:test";
import { dayKeyFor, groupByDay, collectFixtures, dayStrip } from "./sportsCalendar.js";

test("a kick-off falls on the viewer's local day", () => {
  const late = { id: "1", sport: "Basketball", ts: "2026-11-25T01:30:00" };
  assert.equal(dayKeyFor(late, "UTC"), "2026-11-25");
  assert.equal(dayKeyFor(late, "America/New_York"), "2026-11-24");
  assert.equal(dayKeyFor(late, "Asia/Kolkata"), "2026-11-25");
  const early = { id: "2", sport: "Soccer", ts: "2026-11-24T20:00:00" };
  assert.equal(dayKeyFor(early, "Pacific/Auckland"), "2026-11-25");
});

test("a date-only fixture stays on its own date in every time zone", () => {
  const match = { id: "3", sport: "Tennis", ts: "2026-11-24T00:00:00" };
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) assert.equal(dayKeyFor(match, zone), "2026-11-24", zone);
});

test("fixtures without a time have no day", () => {
  assert.equal(dayKeyFor({ id: "4", ts: null }, "UTC"), null);
});

test("grouping sorts days and kick-offs, and drops timeless rows", () => {
  const rows = [
    { id: "c", sport: "Soccer", ts: "2026-11-25T15:00:00" },
    { id: "a", sport: "Soccer", ts: "2026-11-24T20:00:00" },
    { id: "b", sport: "Soccer", ts: "2026-11-24T12:00:00" },
    { id: "x", ts: "" }
  ];
  const groups = groupByDay(rows, "UTC");
  assert.deepEqual(groups.map(g => g.day), ["2026-11-24", "2026-11-25"]);
  assert.deepEqual(groups[0].fixtures.map(f => f.id), ["b", "a"]);
});

test("followed leagues and teams are merged without duplicates", () => {
  const shared = { id: "1", sport: "Soccer", ts: "2026-11-24T20:00:00" };
  const all = collectFixtures({
    leagueIds: ["epl"], teamIds: ["ars"],
    fixturesByLeague: { epl: [shared, { id: "2", ts: "2026-11-24T12:00:00" }], other: [{ id: "9" }] },
    fixturesByTeam: { ars: [{ ...shared }] }
  });
  assert.deepEqual(all.map(f => f.id).sort(), ["1", "2"]);
});

test("the day strip runs from a week back to two weeks ahead of today", () => {
  const strip = dayStrip("2026-11-24", { back: 7, ahead: 14 });
  assert.equal(strip.length, 22);
  assert.equal(strip[0], "2026-11-17");
  assert.equal(strip[7], "2026-11-24");
  assert.equal(strip.at(-1), "2026-12-08");
});
