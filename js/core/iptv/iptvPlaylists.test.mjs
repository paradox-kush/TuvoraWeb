import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlaylistRows, liveContentId } from "./iptvPlaylists.js";

test("rows become playlists in sort order; disabled ones are dropped", () => {
  const list = normalizePlaylistRows({
    playlists: [
      { id: "2", source_type: "m3u_url", name: "Free", url: "https://l/a.m3u", sort_order: 2, enabled: true },
      { id: "1", source_type: "xtream", name: "Prov", base_url: "https://p/", username: "u", password: "s", sort_order: 1, enabled: true, playlist_key: "pk1", epg_url: "" },
      { id: "3", source_type: "xtream", name: "Off", base_url: "https://p", username: "u", sort_order: 0, enabled: false }
    ]
  });
  assert.deepEqual(list.map((p) => p.name), ["Prov", "Free"]);
  assert.equal(list[0].id, "pk1");
  assert.equal(list[1].id, "m3u|https://l/a.m3u");
});

test("derived ids match the apps when the server has no key", () => {
  const [x, s, f] = normalizePlaylistRows({
    playlists: [
      { source_type: "xtream", base_url: "https://p", username: "u", password: "s", sort_order: 0, enabled: true },
      { source_type: "stalker", portal_url: "http://s", mac_address: "00:1A", sort_order: 1, enabled: true },
      { source_type: "m3u_file", file_name: "tv.m3u", sort_order: 2, enabled: true }
    ]
  });
  assert.equal(x.id, "https://p|u");
  assert.equal(s.id, "stalker|http://s|00:1A");
  assert.equal(f.id, "m3u_file|tv.m3u|synced");
});

test("a playlist with no name never shows its address (the query is the login)", () => {
  const [m] = normalizePlaylistRows({ playlists: [{ source_type: "m3u_url", url: "https://h.example/get.php?username=u&password=p", enabled: true }] });
  assert.equal(m.name, "h.example");
  const [x] = normalizePlaylistRows({ playlists: [{ source_type: "xtream", base_url: "https://panel.example:8080", username: "u", enabled: true }] });
  assert.equal(x.name, "panel.example");
});

test("a non-object payload is a failure for the caller, not an empty list", () => {
  assert.throws(() => normalizePlaylistRows(null));
  assert.deepEqual(normalizePlaylistRows({ playlists: [] }), []);
});

test("live content id matches the apps' xtream:{account}:live:{id}", () => {
  assert.equal(liveContentId("pk1", "42"), "xtream:pk1:live:42");
});
