import test from "node:test";
import assert from "node:assert/strict";
import { createLiveSelectionMemory } from "./liveSelectionMemory.js";

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data
  };
}

test("the last playlist and each playlist's group survive a reload, per profile", () => {
  const storage = fakeStorage();
  const first = createLiveSelectionMemory({ storage, profileId: 2 });
  first.rememberPlaylist("p2");
  first.rememberGroup("p2", "group:Sports");
  first.rememberGroup("p1", "all");
  const again = createLiveSelectionMemory({ storage, profileId: 2 });
  assert.equal(again.pickPlaylist([{ id: "p1" }, { id: "p2" }]), "p2");
  assert.equal(again.groupId("p2"), "group:Sports");
  assert.equal(again.groupId("p1"), "all");
  assert.equal(again.groupId("unknown"), "");
  const other = createLiveSelectionMemory({ storage, profileId: 3 });
  assert.equal(other.pickPlaylist([{ id: "p1" }, { id: "p2" }]), "");
});

test("blocked or corrupt storage falls back to nothing remembered instead of throwing", () => {
  const throwing = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  };
  const memory = createLiveSelectionMemory({ storage: throwing, profileId: 1 });
  assert.equal(memory.pickPlaylist([{ id: "p1" }]), "");
  assert.doesNotThrow(() => memory.rememberPlaylist("p1"));
  assert.equal(memory.pickPlaylist([{ id: "p0" }, { id: "p1" }]), "p1");
  const corrupt = createLiveSelectionMemory({ storage: fakeStorage({ "tuvora.live.selection.1": "{nope" }), profileId: 1 });
  assert.equal(corrupt.pickPlaylist([{ id: "p1" }]), "");
  const wrongShape = createLiveSelectionMemory({ storage: fakeStorage({ "tuvora.live.selection.1": "[1]" }), profileId: 1 });
  assert.equal(wrongShape.groupId("p1"), "");
});

test("a playlist id can be its address, so only a fingerprint of it is stored", () => {
  const storage = fakeStorage();
  const memory = createLiveSelectionMemory({ storage, profileId: 1 });
  const id = "http://host.example:8080|viewer01";
  memory.rememberPlaylist(id);
  memory.rememberGroup(id, "group:Sports");
  const raw = [...storage.data.values()].join("");
  assert.equal(/host\.example|viewer01/.test(raw), false);
  const again = createLiveSelectionMemory({ storage, profileId: 1 });
  assert.equal(again.pickPlaylist([{ id: "other" }, { id }]), id);
  assert.equal(again.groupId(id), "group:Sports");
});
