import test from "node:test";
import assert from "node:assert/strict";
import {
  PlaylistAccess,
  classifyPlaylistAccess,
  classifyLoadFailure,
  LoadFailure,
  channelPlayback,
  ChannelPlayback,
  summarizePlaylistStatus,
  PlaylistStatus
} from "./iptvSourceCapability.js";

const xtream = (base) => ({ sourceType: "xtream", baseUrl: base, username: "u", password: "p" });

test("stalker portals open in the app: they need headers and a MAC cookie a page cannot send", () => {
  const r = classifyPlaylistAccess({ sourceType: "stalker", baseUrl: "https://portal.example" }, "https:");
  assert.equal(r.access, PlaylistAccess.AppOnly);
  assert.equal(r.reason, "stalker-portal");
});

test("a device file playlist opens in the app: its bytes never sync", () => {
  const r = classifyPlaylistAccess({ sourceType: "m3u_file", fileName: "a.m3u" }, "https:");
  assert.equal(r.access, PlaylistAccess.AppOnly);
  assert.equal(r.reason, "device-file");
});

test("an http provider on an https page is blocked before any request", () => {
  const r = classifyPlaylistAccess(xtream("http://panel.example:8080"), "https:");
  assert.equal(r.access, PlaylistAccess.AppOnly);
  assert.equal(r.reason, "insecure-source");
});

test("an http provider is worth trying when the page itself is http (self-hosted)", () => {
  assert.equal(classifyPlaylistAccess(xtream("http://panel.example"), "http:").access, PlaylistAccess.Try);
});

test("https xtream and https m3u are worth trying", () => {
  assert.equal(classifyPlaylistAccess(xtream("https://panel.example"), "https:").access, PlaylistAccess.Try);
  assert.equal(
    classifyPlaylistAccess({ sourceType: "m3u_url", url: "https://lists.example/a.m3u" }, "https:").access,
    PlaylistAccess.Try
  );
});

test("missing address and media servers are not live tv sources here", () => {
  assert.equal(classifyPlaylistAccess({ sourceType: "xtream", baseUrl: "" }, "https:").reason, "missing-address");
  assert.equal(classifyPlaylistAccess({ sourceType: "jellyfin", baseUrl: "https://j" }, "https:").reason, "unsupported-type");
});

test("a fetch TypeError is the browser blocking the provider, never an empty list", () => {
  assert.equal(classifyLoadFailure({ error: new TypeError("Failed to fetch") }), LoadFailure.BlockedBySource);
});

test("an http status is the provider's own error", () => {
  assert.equal(classifyLoadFailure({ httpStatus: 403 }), LoadFailure.SourceError);
  assert.equal(classifyLoadFailure({ httpStatus: 456 }), LoadFailure.SourceError);
});

test("a deadline or abort is a timeout; unparseable bodies are bad responses", () => {
  assert.equal(classifyLoadFailure({ timedOut: true }), LoadFailure.Timeout);
  assert.equal(classifyLoadFailure({ error: new SyntaxError("Unexpected token") }), LoadFailure.BadResponse);
});

test("channel playback: http stream on https page goes straight to the fallback", () => {
  assert.equal(channelPlayback("http://edge.example/1.m3u8", "https:"), ChannelPlayback.Insecure);
  assert.equal(channelPlayback("https://edge.example/1.m3u8", "https:"), ChannelPlayback.TryInBrowser);
  assert.equal(channelPlayback("", "https:"), ChannelPlayback.Missing);
  assert.equal(channelPlayback("rtmp://x/y", "https:"), ChannelPlayback.Unsupported);
});

test("playlist status summarises what the viewer can do", () => {
  const tryAccess = { access: PlaylistAccess.Try };
  assert.equal(summarizePlaylistStatus({ access: { access: PlaylistAccess.AppOnly } }), PlaylistStatus.OpensInApp);
  assert.equal(summarizePlaylistStatus({ access: tryAccess }), PlaylistStatus.NotChecked);
  assert.equal(summarizePlaylistStatus({ access: tryAccess, load: { state: "loading" } }), PlaylistStatus.Checking);
  assert.equal(
    summarizePlaylistStatus({ access: tryAccess, load: { state: "failed", failure: LoadFailure.BlockedBySource } }),
    PlaylistStatus.OpensInApp
  );
  assert.equal(
    summarizePlaylistStatus({ access: tryAccess, load: { state: "failed", failure: LoadFailure.Timeout } }),
    PlaylistStatus.Failed
  );
  assert.equal(summarizePlaylistStatus({ access: tryAccess, load: { state: "loaded", secureShare: 1 } }), PlaylistStatus.PlaysInBrowser);
  assert.equal(summarizePlaylistStatus({ access: tryAccess, load: { state: "loaded", secureShare: 0.4 } }), PlaylistStatus.Partly);
  assert.equal(summarizePlaylistStatus({ access: tryAccess, load: { state: "loaded", secureShare: 0 } }), PlaylistStatus.ListsOnly);
  assert.equal(summarizePlaylistStatus({ access: tryAccess, load: { state: "empty" } }), PlaylistStatus.Empty);
});

test("a fetch TypeError while this device is offline is Offline, not the provider blocking browsers", () => {
  assert.equal(classifyLoadFailure({ error: new TypeError("Failed to fetch"), online: false }), LoadFailure.Offline);
  assert.equal(classifyLoadFailure({ error: new TypeError("Failed to fetch"), online: true }), LoadFailure.BlockedBySource);
});
