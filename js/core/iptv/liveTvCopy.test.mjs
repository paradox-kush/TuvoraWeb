import test from "node:test";
import assert from "node:assert/strict";
import { LoadFailure, PlaylistStatus } from "./iptvSourceCapability.js";
import { appOnlyCopy, failureCopy, playbackNotice, statusBadge } from "./liveTvCopy.js";

test("every playlist status has a short badge and a tone", () => {
  for (const status of Object.values(PlaylistStatus)) {
    const badge = statusBadge(status);
    assert.ok(badge.label.length > 0 && badge.label.length <= 24, status);
    assert.ok(["good", "warn", "app", "bad", "muted"].includes(badge.tone), status);
  }
  assert.equal(statusBadge(PlaylistStatus.PlaysInBrowser).tone, "good");
  assert.equal(statusBadge(PlaylistStatus.OpensInApp).tone, "app");
  assert.equal(statusBadge(PlaylistStatus.Failed).tone, "bad");
});

test("each app-only reason is explained in its own plain words", () => {
  const reasons = ["stalker-portal", "device-file", "insecure-source", "missing-address", "unsupported-type"];
  const bodies = reasons.map((reason) => appOnlyCopy(reason).body);
  assert.equal(new Set(bodies).size, reasons.length);
  assert.match(appOnlyCopy("stalker-portal").body, /Stalker portal/);
  assert.match(appOnlyCopy("insecure-source").body, /http/);
  assert.match(appOnlyCopy("device-file").body, /file/);
  assert.ok(appOnlyCopy("something-new").body.length > 0);
});

test("a failure names its reason and only a blocked source is not worth retrying blindly", () => {
  const failures = Object.values(LoadFailure);
  const bodies = failures.map((failure) => failureCopy(failure).body);
  assert.equal(new Set(bodies).size, failures.length);
  assert.match(failureCopy(LoadFailure.BlockedBySource).body, /doesn't allow web browsers/);
  assert.equal(failureCopy(LoadFailure.BlockedBySource).offerApp, true);
  assert.equal(failureCopy(LoadFailure.Timeout).offerApp, false);
  assert.ok(failureCopy("").body.length > 0);
});

test("only partly and lists-only playlists carry the other-player notice", () => {
  assert.ok(playbackNotice(PlaylistStatus.Partly));
  assert.ok(playbackNotice(PlaylistStatus.ListsOnly));
  assert.equal(playbackNotice(PlaylistStatus.PlaysInBrowser), "");
  assert.equal(playbackNotice(PlaylistStatus.Checking), "");
});

test("no copy ever contains an address", () => {
  const all = [
    ...Object.values(PlaylistStatus).map((s) => statusBadge(s).label + playbackNotice(s)),
    ...["stalker-portal", "device-file", "insecure-source", "missing-address", "unsupported-type"].map((r) => appOnlyCopy(r).title + appOnlyCopy(r).body),
    ...Object.values(LoadFailure).map((f) => failureCopy(f).title + failureCopy(f).body)
  ].join(" ");
  assert.equal(/:\/\//.test(all), false);
});
