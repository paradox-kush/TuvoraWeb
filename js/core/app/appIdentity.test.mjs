import assert from "node:assert/strict";
import test from "node:test";
import { createAppIdentity } from "./appIdentity.js";

test("app identity preserves fork provenance while using fork-owned links", () => {
  const identity = createAppIdentity({
    name: "Tuvora Web",
    version: "0.1.0",
    upstreamVersion: "0.3.35",
    maintainer: "Tuvora",
    sourceRepositoryUrl: "https://github.com/paradox-kush/TuvoraWeb",
    issuesUrl: "https://github.com/paradox-kush/TuvoraWeb/issues",
    contributorsUrl: "https://github.com/paradox-kush/TuvoraWeb/graphs/contributors",
    licenseUrl: "https://github.com/paradox-kush/TuvoraWeb/blob/main/LICENSE",
    upstreamRepositoryUrl: "https://github.com/alphasquare404/NuvioWeb",
    latestReleaseUrl: "https://api.github.com/repos/paradox-kush/TuvoraWeb/releases/latest"
  });

  assert.equal(identity.version, "0.1.0");
  assert.equal(identity.upstreamVersion, "0.3.35");
  assert.equal(identity.maintainer, "Tuvora");
  assert.equal(identity.sourceRepositoryUrl, "https://github.com/paradox-kush/TuvoraWeb");
  assert.equal(identity.contributorsUrl, "https://github.com/paradox-kush/TuvoraWeb/graphs/contributors");
  assert.equal(identity.upstreamRepositoryUrl, "https://github.com/alphasquare404/NuvioWeb");
});

test("app identity rejects non-HTTPS runtime links", () => {
  const identity = createAppIdentity({ sourceRepositoryUrl: "javascript:alert(1)" });
  assert.equal(identity.sourceRepositoryUrl, "https://github.com/paradox-kush/TuvoraWeb");
});


test("About preserves validated build identity", () => {
  const identity = createAppIdentity({version: "0.2.0-beta.1", channel: "beta", revision: "b".repeat(40)});
  assert.equal(identity.version, "0.2.0-beta.1");
  assert.equal(identity.channel, "beta");
  assert.equal(identity.revision, "b".repeat(40));
  assert.equal(createAppIdentity({channel: "unknown", revision: "oops"}).channel, "development");
  assert.equal(createAppIdentity({revision: "oops"}).revision, "");
});
