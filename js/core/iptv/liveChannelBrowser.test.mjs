import test from "node:test";
import assert from "node:assert/strict";
import {
  GroupId,
  buildGroupRail,
  filterChannels,
  nextWindow,
  providerGroupId,
  resolveGroup,
  resolvePlaylist,
  rowNeighbour,
  withChannelNumbers
} from "./liveChannelBrowser.js";

const channels = [
  { id: "a", name: "RÚV", group: "Iceland" },
  { id: "b", name: "Stöð 2 Sport", group: "Sports" },
  { id: "c", name: "BBC News HD", group: "News" },
  { id: "d", name: "Sky Sports News", group: "Sports" }
];
const groups = ["Iceland", "Sports", "News"];
const favs = new Set(["c"]);
const isFavourite = (channel) => favs.has(channel.id);

test("the group rail lists Favourites first, then All, then the provider's groups in its order", () => {
  const rail = buildGroupRail({ groups, channels, isFavourite });
  assert.deepEqual(rail.map((g) => g.id), [
    GroupId.Favourites, GroupId.All, "group:Iceland", "group:Sports", "group:News"
  ]);
  assert.deepEqual(rail.map((g) => g.count), [1, 4, 1, 2, 1]);
  assert.equal(rail[3].label, "Sports");
});

test("a provider group that happens to be called 'all' cannot collide with the built-in rail ids", () => {
  const rail = buildGroupRail({ groups: ["all"], channels: [{ id: "x", name: "X", group: "all" }], isFavourite: () => false });
  assert.equal(new Set(rail.map((g) => g.id)).size, rail.length);
  assert.equal(filterChannels({ channels: [{ id: "x", name: "X", group: "all" }], groupId: providerGroupId("all") }).length, 1);
});

test("filtering by group keeps provider order", () => {
  assert.deepEqual(filterChannels({ channels, groupId: providerGroupId("Sports") }).map((c) => c.id), ["b", "d"]);
  assert.deepEqual(filterChannels({ channels, groupId: GroupId.All }).map((c) => c.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterChannels({ channels, groupId: GroupId.Favourites, isFavourite }).map((c) => c.id), ["c"]);
});

test("search ignores case and accents and needs every word", () => {
  assert.deepEqual(filterChannels({ channels, query: "ruv" }).map((c) => c.id), ["a"]);
  assert.deepEqual(filterChannels({ channels, query: "  STOD sport " }).map((c) => c.id), ["b"]);
  assert.deepEqual(filterChannels({ channels, query: "news sports" }).map((c) => c.id), ["d"]);
  assert.deepEqual(filterChannels({ channels, query: "zzz" }), []);
});

test("a search looks across the whole playlist, not only the selected group", () => {
  assert.deepEqual(
    filterChannels({ channels, groupId: providerGroupId("Iceland"), query: "news" }).map((c) => c.id),
    ["c", "d"]
  );
});

test("channel numbers use the provider's number, else the position in the playlist", () => {
  const numbered = withChannelNumbers([{ id: "a", number: 101 }, { id: "b" }, { id: "c", number: 0 }]);
  assert.deepEqual(numbered.map((c) => c.number), [101, 2, 3]);
});

test("the remembered group is restored only while it still exists and is not empty", () => {
  const rail = buildGroupRail({ groups, channels, isFavourite });
  assert.equal(resolveGroup(rail, "group:Sports"), "group:Sports");
  assert.equal(resolveGroup(rail, "group:Gone"), GroupId.Favourites);
  const noFavs = buildGroupRail({ groups, channels, isFavourite: () => false });
  assert.equal(resolveGroup(noFavs, ""), GroupId.All);
  assert.equal(resolveGroup(noFavs, GroupId.Favourites), GroupId.All);
});

test("the remembered playlist is restored, else the first one", () => {
  const playlists = [{ id: "p1" }, { id: "p2" }];
  assert.equal(resolvePlaylist(playlists, "p2"), "p2");
  assert.equal(resolvePlaylist(playlists, "gone"), "p1");
  assert.equal(resolvePlaylist([], "p2"), "");
});

test("a large list is rendered a window at a time and never past its end", () => {
  assert.equal(nextWindow({ rendered: 0, total: 10_000 }), 80);
  assert.equal(nextWindow({ rendered: 80, total: 10_000 }), 160);
  assert.equal(nextWindow({ rendered: 80, total: 100 }), 100);
  assert.equal(nextWindow({ rendered: 100, total: 100 }), 100);
  assert.equal(nextWindow({ rendered: 0, total: 0 }), 0);
});

test("Up and Down move one row and stop at the ends", () => {
  assert.equal(rowNeighbour({ index: 3, total: 10, key: "ArrowDown" }), 4);
  assert.equal(rowNeighbour({ index: 3, total: 10, key: "ArrowUp" }), 2);
  assert.equal(rowNeighbour({ index: 9, total: 10, key: "ArrowDown" }), -1);
  assert.equal(rowNeighbour({ index: 0, total: 10, key: "ArrowUp" }), -1);
  assert.equal(rowNeighbour({ index: 3, total: 10, key: "Home" }), 0);
  assert.equal(rowNeighbour({ index: 3, total: 10, key: "End" }), 9);
  assert.equal(rowNeighbour({ index: 3, total: 10, key: "Enter" }), -1);
});
