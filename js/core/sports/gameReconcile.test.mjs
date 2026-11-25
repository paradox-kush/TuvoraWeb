import assert from "node:assert/strict";
import test from "node:test";
import { reconcileGame } from "./gameReconcile.js";
import { periodFromStatus } from "./liveStatus.js";

const lagging = { gameId: "tsdb:1", state: "upcoming", startsAt: "2026-11-25T03:00:00Z", blocks: [],
  header: { kind: "teams", home: { name: "Denver Nuggets" }, away: { name: "Dallas Mavericks" } } };
const liveCard = { state: "live", progress: "Q2", home: { score: "39" }, away: { score: "58" } };

test("a lagging upcoming detail takes the hub's live state, scores and period", () => {
  const game = reconcileGame(lagging, liveCard);
  assert.equal(game.state, "live");
  assert.equal(game.header.home.score, "39");
  assert.equal(game.header.away.score, "58");
  assert.equal(game.live.periodLabel, "Q2");
  assert.equal(lagging.state, "upcoming", "the payload is not mutated");
});

test("a detail that already knows more is left alone", () => {
  const final = { ...lagging, state: "final", header: { kind: "teams", home: { name: "A", score: "100" }, away: { name: "B", score: "90" } } };
  assert.equal(reconcileGame(final, liveCard), final);
  assert.equal(reconcileGame(lagging, { ...liveCard, state: "upcoming" }), lagging);
  assert.equal(reconcileGame(lagging, null), lagging);
  assert.equal(reconcileGame(null, liveCard), null);
});

test("the hub's final verdict ends a stale live detail", () => {
  const staleLive = { ...lagging, state: "live" };
  assert.equal(reconcileGame(staleLive, { ...liveCard, state: "final", progress: null }).state, "final");
});

test("period sports read the feed's status as the period; minutes elsewhere", () => {
  assert.equal(periodFromStatus("Basketball", "Q2"), "Q2");
  assert.equal(periodFromStatus("Ice Hockey", "P3"), "P3");
  assert.equal(periodFromStatus("American Football", "OT"), "OT");
  assert.equal(periodFromStatus("Basketball", "HT"), "HT");
  assert.equal(periodFromStatus("Basketball", "NS"), null);
  assert.equal(periodFromStatus("Soccer", "2H"), null);
});
