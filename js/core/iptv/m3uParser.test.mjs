import test from "node:test";
import assert from "node:assert/strict";
import { parseM3u } from "./m3uParser.js";

const SAMPLE = [
  '#EXTM3U url-tvg="https://epg.example/guide.xml.gz"',
  '#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://l/bbc1.png" group-title="UK",BBC One HD',
  "https://cdn.example/bbc1.m3u8",
  '#EXTINF:-1 tvg-id="" group-title="News, World",Sky News, Live',
  "#EXTVLCOPT:http-user-agent=Foo",
  "http://cdn.example/sky.ts",
  "#EXTINF:-1,No Group",
  "#EXTGRP:Misc",
  "https://cdn.example/ng.m3u8",
  "https://cdn.example/orphan.m3u8",
  ""
].join("\n");

test("parses header guide url, attributes, groups and names with commas", () => {
  const r = parseM3u(SAMPLE);
  assert.equal(r.tvgUrl, "https://epg.example/guide.xml.gz");
  assert.equal(r.channels.length, 3);
  const [a, b, c] = r.channels;
  assert.deepEqual(
    { name: a.name, tvgId: a.tvgId, logo: a.logo, group: a.group, url: a.url },
    { name: "BBC One HD", tvgId: "bbc1.uk", logo: "https://l/bbc1.png", group: "UK", url: "https://cdn.example/bbc1.m3u8" }
  );
  assert.equal(b.name, "Sky News, Live");
  assert.equal(b.group, "News, World");
  assert.equal(b.tvgId, "");
  assert.equal(b.needsHeaders, true);
  assert.equal(c.group, "Misc");
});

test("bare urls without EXTINF are skipped and ids are stable and unique", () => {
  const r = parseM3u(SAMPLE);
  assert.ok(!r.channels.some((ch) => ch.url.endsWith("orphan.m3u8")));
  const ids = r.channels.map((ch) => ch.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(parseM3u(SAMPLE).channels.map((ch) => ch.id), ids);
});

test("crlf, BOM and missing header still parse; empty text gives no channels", () => {
  const r = parseM3u("﻿#EXTINF:-1,One\r\nhttps://a/1\r\n");
  assert.equal(r.channels.length, 1);
  assert.equal(r.channels[0].group, "");
  assert.deepEqual(parseM3u("").channels, []);
});

test("an html error page is not a playlist, so it is never read as an empty list", () => {
  assert.equal(parseM3u("<html><body>Forbidden</body></html>").valid, false);
  assert.equal(parseM3u(SAMPLE).valid, true);
});
