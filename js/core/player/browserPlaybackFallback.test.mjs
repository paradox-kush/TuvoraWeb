import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserPlaybackFailure,
  buildTuvoraAppLink,
  classifyBrowserPlaybackFailure,
  fallbackActionsFor,
  layoutFallbackActions,
  isBrowserMediaFailure,
  orderExternalPlayers
} from "./browserPlaybackFallback.js";

test("an http source on an https page is named as insecure, whatever the media error", () => {
  const failure = classifyBrowserPlaybackFailure({
    pageProtocol: "https:",
    mediaUrl: "http://provider.example/live/u/p/1.ts",
    mediaErrorCode: 4
  });
  assert.equal(failure.reason, BrowserPlaybackFailure.InsecureSource);
  assert.match(failure.message, /not secure \(http\)/);
});

test("an http source on a local http page is not an insecure-source failure", () => {
  const failure = classifyBrowserPlaybackFailure({
    pageProtocol: "http:",
    mediaUrl: "http://provider.example/movie.mp4",
    mediaErrorCode: 2
  });
  assert.notEqual(failure.reason, BrowserPlaybackFailure.InsecureSource);
});

test("a network failure with no HTTP status reads as the source blocking browsers", () => {
  const failure = classifyBrowserPlaybackFailure({
    pageProtocol: "https:",
    mediaUrl: "https://cdn.example/movie.m3u8",
    mediaErrorCode: 2
  });
  assert.equal(failure.reason, BrowserPlaybackFailure.BlockedBySource);
});

test("header-restricted sources are blocked-by-source", () => {
  const failure = classifyBrowserPlaybackFailure({
    pageProtocol: "https:",
    mediaUrl: "https://cdn.example/movie.mkv",
    mediaErrorCode: 4,
    headerRestricted: true
  });
  assert.equal(failure.reason, BrowserPlaybackFailure.BlockedBySource);
});

test("decode errors and unsupported formats read as unsupported-format", () => {
  for (const input of [
    { mediaErrorCode: 3 },
    { mediaErrorCode: 4, detail: "MEDIA_ERR_SRC_NOT_SUPPORTED: no supported source" }
  ]) {
    const failure = classifyBrowserPlaybackFailure({ pageProtocol: "https:", mediaUrl: "https://cdn.example/a.mkv", ...input });
    assert.equal(failure.reason, BrowserPlaybackFailure.UnsupportedFormat, JSON.stringify(input));
  }
});

test("an HTTP status from the source is a source error, not a browser limit", () => {
  const failure = classifyBrowserPlaybackFailure({
    pageProtocol: "https:",
    mediaUrl: "https://cdn.example/a.m3u8",
    mediaErrorCode: 4,
    httpStatus: 404
  });
  assert.equal(failure.reason, BrowserPlaybackFailure.SourceError);
});

const ids = (actions) => actions.map((a) => (a.id === "player" ? `player:${a.player}` : a.id));

test("browser-limit failures offer the Tuvora app, then the system player, VLC and others, then copy link", () => {
  const actions = fallbackActionsFor({
    reason: BrowserPlaybackFailure.BlockedBySource,
    players: ["system", "vlc", "mxplayer", "mpv"],
    contentType: "movie",
    contentId: "tt0111161",
    mediaUrl: "https://cdn.example/a.m3u8"
  });
  assert.deepEqual(ids(actions), ["open-app", "player:system", "player:vlc", "player:mxplayer", "player:mpv", "copy-link", "back"]);
  assert.equal(actions[0].href, "tuvora://meta?type=movie&id=tt0111161");
});

test("the viewer's saved external player moves to the front of the players", () => {
  const actions = fallbackActionsFor({
    reason: BrowserPlaybackFailure.InsecureSource,
    players: ["system", "vlc", "infuse", "outplayer", "lenna"],
    preferredPlayer: "infuse",
    contentType: "series",
    contentId: "tt0903747",
    mediaUrl: "http://provider.example/a.ts"
  });
  assert.deepEqual(ids(actions), ["open-app", "player:infuse", "player:system", "player:vlc", "player:outplayer", "player:lenna", "copy-link", "back"]);
});

test("a saved choice of disabled, or one not on this platform, keeps the default order", () => {
  assert.deepEqual(orderExternalPlayers(["disabled", "system"], "disabled"), ["system"]);
  assert.deepEqual(orderExternalPlayers(["system", "vlc"], "lenna"), ["system", "vlc"]);
});

test("no app link without a content id, and no players or copy without a transferable url", () => {
  const actions = fallbackActionsFor({
    reason: BrowserPlaybackFailure.UnsupportedFormat,
    players: ["system", "vlc"],
    contentType: "movie",
    contentId: "",
    mediaUrl: "blob:https://app.tuvora.co/x"
  });
  assert.deepEqual(ids(actions), ["back"]);
});

test("a source error does not push the user to another app: that source is broken everywhere", () => {
  const actions = fallbackActionsFor({
    reason: BrowserPlaybackFailure.SourceError,
    players: ["system", "vlc"],
    contentType: "movie",
    contentId: "tt0111161",
    mediaUrl: "https://cdn.example/a.m3u8"
  });
  assert.deepEqual(ids(actions), ["back"]);
});

test("app links encode ids like the apps' buildMetaDeepLinkUrl", () => {
  assert.equal(buildTuvoraAppLink({ type: "series", id: "tmdb:1399" }), "tuvora://meta?type=series&id=tmdb%3A1399");
  assert.equal(buildTuvoraAppLink({ type: " movie ", id: " tt1 " }), "tuvora://meta?type=movie&id=tt1");
  assert.equal(buildTuvoraAppLink({ type: "movie", id: "" }), "");
});

test("stalls and media errors get the fallback; resolver and missing-url errors do not", () => {
  for (const reason of ["play-start", "play-after-startup", "startup-media-error", "media-error", "startup-stall", "playback-stall"]) {
    assert.equal(isBrowserMediaFailure({ reason }), true, reason);
  }
  for (const reason of ["missing-url", "stream-resolve", "reload-sources", ""]) {
    assert.equal(isBrowserMediaFailure({ reason }), false, reason);
  }
  assert.equal(isBrowserMediaFailure({ reason: "", mediaErrorCode: 4 }), true);
});

test("a stall with no error code is offered the app and players as an unknown browser failure", () => {
  const failure = classifyBrowserPlaybackFailure({ pageProtocol: "https:", mediaUrl: "https://cdn.example/a.m3u8" });
  assert.equal(failure.reason, BrowserPlaybackFailure.Unknown);
  assert.match(failure.message, /didn't play in the browser/);
});

test("the error screen gets one primary action: the app, else the first player, else Back", () => {
  const app = { id: "open-app", href: "tuvora://meta?type=movie&id=tt1" };
  const vlc = { id: "player", player: "vlc" };
  const mpv = { id: "player", player: "mpv" };
  const copy = { id: "copy-link" };

  const full = layoutFallbackActions([app, vlc, mpv, copy]);
  assert.equal(full.primary, app);
  assert.deepEqual(full.players, [vlc, mpv]);
  assert.deepEqual(ids(full.quiet), ["copy-link", "back"]);

  const noApp = layoutFallbackActions([vlc, mpv, copy]);
  assert.equal(noApp.primary, vlc);
  assert.deepEqual(noApp.players, [mpv]);
  assert.deepEqual(ids(noApp.quiet), ["copy-link", "back"]);

  const backOnly = layoutFallbackActions([]);
  assert.deepEqual(ids([backOnly.primary]), ["back"]);
  assert.deepEqual(backOnly.players, []);
  assert.deepEqual(backOnly.quiet, [], "Back is never offered twice");

  // A stray Back in the input (fallbackActionsFor appends one) is not duplicated either.
  assert.deepEqual(ids(layoutFallbackActions([app, { id: "back" }]).quiet), ["back"]);
});

test("the tap-to-play prompt offers Play first and only Back beside it", () => {
  const layout = layoutFallbackActions([{ id: "player", player: "vlc" }], { awaitingGesture: true });
  assert.deepEqual(ids([layout.primary]), ["play"]);
  assert.deepEqual(layout.players, []);
  assert.deepEqual(ids(layout.quiet), ["back"]);
});

test("fallback messages state the reason only; the buttons carry the way out", () => {
  for (const input of [
    { mediaUrl: "http://p.example/a.ts" },
    { mediaUrl: "https://p.example/a.m3u8", mediaErrorCode: 2 },
    { mediaUrl: "https://p.example/a.mkv", mediaErrorCode: 3 },
    { mediaUrl: "https://p.example/a.m3u8" }
  ]) {
    const { message } = classifyBrowserPlaybackFailure({ pageProtocol: "https:", ...input });
    assert.ok(message, JSON.stringify(input));
    assert.doesNotMatch(message, /Tuvora app|another player/, message);
  }
});
