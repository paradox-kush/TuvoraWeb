import test from "node:test";
import assert from "node:assert/strict";
import { createLiveFavourites } from "./liveFavourites.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

test("favourites toggle, persist per profile and keep newest first", () => {
  const storage = memoryStorage();
  const fav = createLiveFavourites({ storage, profileId: 1 });
  fav.toggle("xtream:p:live:1");
  fav.toggle("xtream:p:live:2");
  assert.deepEqual(fav.list(), ["xtream:p:live:2", "xtream:p:live:1"]);
  fav.toggle("xtream:p:live:2");
  assert.equal(fav.has("xtream:p:live:2"), false);
  assert.deepEqual(createLiveFavourites({ storage, profileId: 1 }).list(), ["xtream:p:live:1"]);
  assert.deepEqual(createLiveFavourites({ storage, profileId: 2 }).list(), []);
});

test("a broken or missing storage never throws and starts empty", () => {
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const fav = createLiveFavourites({ storage: throwing, profileId: 1 });
  assert.deepEqual(fav.list(), []);
  fav.toggle("a");
  assert.equal(fav.has("a"), true);
  const garbage = memoryStorage();
  garbage.setItem("tuvora.live.favourites.1", "{not json");
  assert.deepEqual(createLiveFavourites({ storage: garbage, profileId: 1 }).list(), []);
});
