import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeXtreamBase,
  xtreamApiUrl,
  chooseLiveExtension,
  xtreamLiveUrl,
  mapXtreamLive,
  parseShortEpg
} from "./xtreamApi.js";

test("base url loses trailing slashes and a pasted player_api.php", () => {
  assert.equal(normalizeXtreamBase("https://p.example:8443/"), "https://p.example:8443");
  assert.equal(normalizeXtreamBase("https://p.example/player_api.php"), "https://p.example");
  assert.equal(normalizeXtreamBase(" p.example "), "http://p.example");
});

test("api url encodes credentials and extra params", () => {
  const url = xtreamApiUrl({ baseUrl: "https://p.example/", username: "a b", password: "p&w" }, "get_short_epg", { stream_id: 5, limit: 2 });
  assert.equal(url, "https://p.example/player_api.php?username=a%20b&password=p%26w&action=get_short_epg&stream_id=5&limit=2");
  assert.equal(xtreamApiUrl({ baseUrl: "https://p", username: "u", password: "p" }), "https://p/player_api.php?username=u&password=p");
});

test("the browser prefers m3u8 (hls.js) when the panel allows it, else ts", () => {
  assert.equal(chooseLiveExtension(["m3u8", "ts", "rtmp"]), "m3u8");
  assert.equal(chooseLiveExtension(["ts"]), "ts");
  assert.equal(chooseLiveExtension([]), "m3u8");
  assert.equal(chooseLiveExtension(undefined), "m3u8");
});

test("live url follows the panel path shape", () => {
  assert.equal(
    xtreamLiveUrl({ baseUrl: "https://p.example", username: "u", password: "p" }, 42, "m3u8"),
    "https://p.example/live/u/p/42.m3u8"
  );
});

test("categories and streams map to channels with groups, logo and guide ids", () => {
  const r = mapXtreamLive(
    [{ category_id: "1", category_name: "UK" }, { category_id: "2", category_name: "Sports" }],
    [
      { stream_id: 7, name: "BBC One", stream_icon: "https://l/1.png", epg_channel_id: "bbc1.uk", category_id: "1", tv_archive: 1, num: 2 },
      { stream_id: 8, name: "Sky Sports", stream_icon: "", epg_channel_id: null, category_id: "2", num: 1 },
      { stream_id: "x", name: "Broken" },
      { stream_id: 9, name: "Lost", category_id: "99" }
    ]
  );
  assert.deepEqual(r.groups, ["UK", "Sports", "Other"]);
  assert.equal(r.channels.length, 3);
  const first = r.channels[0];
  assert.deepEqual(
    { id: first.id, streamId: first.streamId, group: first.group, tvgId: first.tvgId, catchUp: first.catchUp },
    { id: "7", streamId: 7, group: "UK", tvgId: "bbc1.uk", catchUp: true }
  );
  assert.equal(r.channels[2].group, "Other");
});

test("short epg decodes base64 titles (utf-8) and second timestamps", () => {
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const list = parseShortEpg({
    epg_listings: [
      { title: b64("Café Live"), description: b64("Desc"), start_timestamp: "1000", stop_timestamp: "2000" },
      { title: b64("Next"), start_timestamp: "2000", stop_timestamp: "3000" },
      { title: b64("Bad"), start_timestamp: "x" }
    ]
  });
  assert.deepEqual(list.map((p) => [p.title, p.startMs, p.endMs]), [["Café Live", 1000000, 2000000], ["Next", 2000000, 3000000]]);
  assert.deepEqual(parseShortEpg(null), []);
});
