import assert from "node:assert/strict";
import test from "node:test";
import { __testing, isUsableCatalog } from "./sportsRepository.js";

test("a catalog league is pushed by id only; a user-added league keeps its own metadata", () => {
  assert.deepEqual(__testing.followPushRow({ league_id: 4328, sport: "Soccer", sort_order: 7, name: "ignored" }, 0),
    { league_id: "4328", sport: "Soccer", sort_order: 0 });
  assert.deepEqual(__testing.followPushRow({ league_id: "9", sport: "Darts", custom: true, name: "PDC", badge: "https://b", keywords: ["pdc"] }, 3),
    { league_id: "9", sport: "Darts", sort_order: 3, custom: true, name: "PDC", badge: "https://b", keywords: ["pdc"] });
});

test("an empty or truncated published catalog is not adopted", () => {
  assert.equal(isUsableCatalog(null), false);
  assert.equal(isUsableCatalog({ categories: [{ leagues: [{}, {}] }, { leagues: [] }, { leagues: [] }] }), false);
  const categories = Array.from({ length: 3 }, () => ({ leagues: Array.from({ length: 4 }, () => ({})) }));
  assert.equal(isUsableCatalog({ categories }), true);
});

test("two follow clicks in a row both stick (writes are serialised, never read-read-write-write)", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const { sportsRepository } = await import("./sportsRepository.js");
  await Promise.all([
    sportsRepository.setLeagueFollowed({ profileId: "9", signedIn: false, league: { id: "4387", sport: "Basketball" }, followed: true }),
    sportsRepository.setLeagueFollowed({ profileId: "9", signedIn: false, league: { id: "4380", sport: "Ice Hockey" }, followed: true }),
    sportsRepository.setScoresShown({ profileId: "9", signedIn: false, shown: false })
  ]);
  const saved = JSON.parse(store.get("tuvora.sports.v1.9"));
  assert.deepEqual(saved.leagues.map(l => l.league_id), ["4387", "4380"]);
  assert.equal(saved.prefs.scores_shown, false);
  delete globalThis.localStorage;
});
