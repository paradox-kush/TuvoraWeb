import assert from "node:assert/strict";
import test from "node:test";
import { buildHub, buildCard } from "./sportsViewModel.js";
import { EMPTY_LIVE_STATE } from "./liveStatus.js";

const nowMs = Date.parse("2026-11-24T15:00:00Z");
const ctx = { liveState: EMPTY_LIVE_STATE, nowMs, spoiler: { scoresShown: true, revealed: new Set() }, leagueById: () => null, timeZone: "UTC" };
const state = {
  leagueIds: ["epl"], teamIds: [],
  fixturesByLeague: { epl: [
    { id: "live", leagueId: "epl", sport: "Soccer", home: "A", away: "B", ts: "2026-11-24T14:30:00", status: "1H", homeScore: "1", awayScore: "0" },
    { id: "done", leagueId: "epl", sport: "Soccer", home: "C", away: "D", ts: "2026-11-22T14:30:00", status: "FT", homeScore: "0", awayScore: "2" },
    { id: "soon", leagueId: "epl", sport: "Soccer", home: "E", away: "F", ts: "2026-11-25T20:00:00", status: "NS" },
    { id: "far", leagueId: "epl", sport: "Soccer", home: "G", away: "H", ts: "2026-12-20T20:00:00", status: "NS" }
  ] },
  fixturesByTeam: {}
};

test("the hub splits followed fixtures into live, next and results, and every fixture lands on a calendar day", () => {
  const hub = buildHub(state, ctx);
  assert.deepEqual(hub.live.map(c => c.key), ["live"]);
  assert.deepEqual(hub.next.map(c => c.key), ["soon"]);
  assert.deepEqual(hub.results.map(c => c.key), ["done"]);
  assert.deepEqual(hub.days.map(d => d.day), ["2026-11-22", "2026-11-24", "2026-11-25", "2026-12-20"]);
  assert.equal(hub.days.find(d => d.day === "2026-11-24").liveCount, 1);
  assert.equal(hub.today, "2026-11-24");
  assert.equal(hub.results[0].leader, "away");
});

test("with scores hidden no card carries a number or a leader", () => {
  const hub = buildHub(state, { ...ctx, spoiler: { scoresShown: false, revealed: new Set() } });
  for (const card of [...hub.live, ...hub.results]) {
    assert.equal(card.home.score, null);
    assert.equal(card.away.score, null);
    assert.equal(card.leader, null);
    assert.equal(card.scoreHidden, true);
  }
});

test("cards never carry a non-https image url", () => {
  const card = buildCard({ id: "1", home: "A", away: "B", ts: "2026-11-24T14:30:00", homeBadge: "javascript:alert(1)", awayBadge: "https://x/b.png" }, ctx);
  assert.equal(card.home.badge, null);
  assert.equal(card.away.badge, "https://x/b.png");
});
