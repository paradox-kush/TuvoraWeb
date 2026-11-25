import assert from "node:assert/strict";
import test from "node:test";
import { isLive, gameState, badgeProgress, liveStateFromResponse, mergeLiveState } from "./liveStatus.js";

const at = iso => Date.parse(iso);
const soccer = { id: "1", sport: "Soccer", ts: "2026-07-02T14:00:00", status: "NS" };
const nba = { id: "2", sport: "Basketball", ts: "2026-07-02T23:00:00", status: "NS" };
const empty = { liveEventIds: new Set(), livescoreSports: new Set(), liveScores: new Map() };

test("a sport the feed covers is live only when the feed lists the game", () => {
  const covered = { ...empty, livescoreSports: new Set(["soccer"]) };
  assert.equal(isLive(soccer, covered, at("2026-07-02T15:00:00Z")), false);
  assert.equal(isLive(soccer, { ...covered, liveEventIds: new Set(["1"]) }, at("2026-07-02T15:00:00Z")), true);
});

test("without feed coverage, live is inferred from the kick-off window", () => {
  assert.equal(isLive(soccer, empty, at("2026-07-02T15:00:00Z")), true);
  assert.equal(isLive(soccer, empty, at("2026-07-02T13:00:00Z")), false);
});

test("a stale feed id never makes a finished, unstarted or long-over game live", () => {
  const state = { ...empty, liveEventIds: new Set(["1"]), livescoreSports: new Set(["soccer"]) };
  assert.equal(isLive({ ...soccer, status: "FT" }, state, at("2026-07-02T15:00:00Z")), false);
  assert.equal(isLive(soccer, state, at("2026-07-02T13:40:00Z")), false, "more than 10 min before kick-off");
  assert.equal(isLive(soccer, state, at("2026-07-02T13:55:00Z")), true, "inside the pre-kick-off grace");
  assert.equal(isLive(soccer, state, at("2026-07-02T17:20:00Z")), false, "past the 3.25 h display cap");
});

test("game state: postponed, live, final and upcoming", () => {
  assert.equal(gameState({ ...soccer, status: "Postponed" }, empty, at("2026-07-02T15:00:00Z")), "postponed");
  assert.equal(gameState({ ...soccer, postponed: "yes" }, empty, at("2026-07-02T15:00:00Z")), "postponed");
  assert.equal(gameState(soccer, empty, at("2026-07-02T15:00:00Z")), "live");
  assert.equal(gameState({ ...soccer, status: "FT" }, empty, at("2026-07-02T15:00:00Z")), "final");
  assert.equal(gameState(soccer, empty, at("2026-07-03T15:00:00Z")), "final", "the window ran out without a status");
  assert.equal(gameState(soccer, empty, at("2026-07-01T15:00:00Z")), "upcoming");
});

test("period sports never show the feed's elapsed minute", () => {
  assert.equal(badgeProgress("Basketball", "20"), null);
  assert.equal(badgeProgress("Ice Hockey", "41"), null);
  assert.equal(badgeProgress("Soccer", "67"), "67");
  assert.equal(badgeProgress("Soccer", " "), null);
});

test("an empty livescore lane is not coverage; a tick merges, a full refresh replaces", () => {
  const response = { livescore: {
    soccer: [{ eventId: "1", homeScore: "1", awayScore: "0", progress: "30" }],
    basketball: []
  } };
  const fresh = liveStateFromResponse(response);
  assert.deepEqual([...fresh.livescoreSports], ["soccer"]);
  assert.deepEqual([...fresh.liveEventIds], ["1"]);
  assert.equal(fresh.liveScores.get("1").homeScore, "1");
  const tick = liveStateFromResponse({ livescore: { basketball: [{ eventId: "2", homeScore: "50", awayScore: "48" }] } });
  const merged = mergeLiveState(fresh, tick);
  assert.deepEqual([...merged.liveEventIds].sort(), ["1", "2"]);
  assert.deepEqual([...merged.livescoreSports].sort(), ["basketball", "soccer"]);
  assert.equal(isLive(nba, merged, at("2026-07-02T23:30:00Z")), true);
});
