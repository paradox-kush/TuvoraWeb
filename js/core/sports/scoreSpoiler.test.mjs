import assert from "node:assert/strict";
import test from "node:test";
import { scoreSlots, redactGameDetail, isScoreHidden } from "./scoreSpoiler.js";

const live = { id: "7", homeScore: "1", awayScore: "0" };
const shown = { scoresShown: true, revealed: new Set() };
const hidden = { scoresShown: false, revealed: new Set() };

test("scores shown: the feed's live score beats the fixture row, and the leader is marked", () => {
  const slots = scoreSlots(shown, { id: "7", homeScore: "0", awayScore: "0" }, live, "live");
  assert.deepEqual(slots, { home: "1", away: "0", hidden: false, leader: "home" });
});

test("an upcoming game has no score to show or hide", () => {
  assert.deepEqual(scoreSlots(hidden, { id: "7" }, null, "upcoming"), { home: null, away: null, hidden: false, leader: null });
});

test("scores hidden: live and final games show no numbers and no leader", () => {
  for (const state of ["live", "final"]) {
    assert.deepEqual(scoreSlots(hidden, { id: "7", homeScore: "2", awayScore: "1" }, live, state), { home: null, away: null, hidden: true, leader: null });
  }
});

test("revealing one game shows only that game", () => {
  const settings = { scoresShown: false, revealed: new Set(["7"]) };
  assert.equal(scoreSlots(settings, { id: "7", homeScore: "2", awayScore: "2" }, null, "final").home, "2");
  assert.equal(scoreSlots(settings, { id: "8", homeScore: "2", awayScore: "2" }, null, "final").hidden, true);
  assert.equal(scoreSlots(settings, { id: "8", homeScore: "2", awayScore: "2" }, null, "final").leader, null);
  assert.equal(isScoreHidden(settings, "7"), false);
  assert.equal(isScoreHidden(settings, "8"), true);
});

test("a draw has no leader", () => {
  assert.equal(scoreSlots(shown, { id: "1", homeScore: "2", awayScore: "2" }, null, "final").leader, null);
});

const detail = {
  gameId: "tsdb:7", state: "final",
  header: { kind: "teams", home: { name: "A", score: "4", record: "10-2", form: ["W"] }, away: { name: "B", score: "0" } },
  blocks: [{ type: "stats" }, { type: "timeline" }, { type: "lineup" }, { type: "standings" }, { type: "form" },
    { type: "highlights" }, { type: "next" }, { type: "broadcast" }, { type: "somethingNew" }]
};

test("a hidden started game keeps only the allow-listed blocks and loses scores, records and form", () => {
  const redacted = redactGameDetail(detail);
  assert.deepEqual(redacted.blocks.map(b => b.type), ["lineup", "next", "broadcast"]);
  assert.equal(redacted.header.home.score, null);
  assert.equal(redacted.header.home.record, null);
  assert.equal(redacted.header.home.form, null);
  assert.equal(redacted.header.away.score, null);
  assert.equal(detail.header.home.score, "4", "the original is untouched");
});

test("a hidden upcoming game keeps every block", () => {
  assert.equal(redactGameDetail({ ...detail, state: "upcoming" }).blocks.length, detail.blocks.length);
});
