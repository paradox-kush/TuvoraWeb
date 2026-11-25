import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { AddonApi } = await import("../remote/api/addonApi.js");
const { AddonRepository } = await import("./addonRepository.js");

// An add-on host that never answers (a LAN add-on seen from outside that network, a dead
// server) held Home and the profile overlay on a spinner for as long as the connection hung.
test("a manifest that never answers fails at its deadline and its request is aborted", async () => {
  const original = AddonApi.getManifest;
  let abortedSignal = null;
  AddonApi.getManifest = (_url, { signal } = {}) =>
    new Promise((_, reject) => {
      signal?.addEventListener("abort", () => {
        abortedSignal = signal;
        reject(new Error("aborted"));
      });
    });
  try {
    const repository = new AddonRepository();
    const startedAt = Date.now();
    const result = await repository.fetchAddon("http://192.168.1.90:18711", { deadlineMs: 50 });
    assert.equal(result.status, "error");
    assert.ok(
      Date.now() - startedAt < 2000,
      "the call ends at the deadline, not when the socket gives up"
    );
    assert.ok(abortedSignal?.aborted, "the hanging request is cancelled");
  } finally {
    AddonApi.getManifest = original;
  }
});

test("installed add-ons resolve without the one that hangs", async () => {
  const original = AddonApi.getManifest;
  AddonApi.getManifest = (url, { signal } = {}) =>
    url.startsWith("http://192.168.1.90")
      ? new Promise((_, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted")))
        )
      : Promise.resolve({
          id: "ok.addon",
          name: "OK",
          version: "1.0.0",
          resources: ["catalog"],
          types: ["movie"],
          catalogs: []
        });
  try {
    const repository = new AddonRepository();
    const results = await Promise.all([
      repository.fetchAddon("https://ok.example", { deadlineMs: 50 }),
      repository.fetchAddon("http://192.168.1.90:18711", { deadlineMs: 50 })
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["success", "error"]
    );
  } finally {
    AddonApi.getManifest = original;
  }
});
