// What a browser can do with a synced IPTV playlist, decided before and after one request.
// Pure: no DOM, no network. The Live TV screen renders the result.
//
// A page cannot: load http from https (mixed content), read a provider that sends no CORS
// headers, set a User-Agent / Authorization / Cookie (Stalker needs all three), or read a
// playlist file that lives on another device. Each of those is a named reason, never an
// empty channel list. Measured on prod 2026-11-24: see docs/iptv-web.md.

export const PlaylistAccess = Object.freeze({
  Try: "try",
  AppOnly: "app-only"
});

export const LoadFailure = Object.freeze({
  BlockedBySource: "blocked-by-source",
  SourceError: "source-error",
  Timeout: "timeout",
  BadResponse: "bad-response"
});

export const ChannelPlayback = Object.freeze({
  TryInBrowser: "try",
  Insecure: "insecure",
  Missing: "missing",
  Unsupported: "unsupported"
});

export const PlaylistStatus = Object.freeze({
  NotChecked: "not-checked",
  Checking: "checking",
  PlaysInBrowser: "plays-in-browser",
  Partly: "partly",
  ListsOnly: "lists-only",
  OpensInApp: "opens-in-app",
  Empty: "empty",
  Failed: "failed"
});

const LIVE_SOURCE_TYPES = new Set(["xtream", "m3u_url", "url"]);

function protocolOf(url) {
  try {
    return new URL(String(url || "")).protocol;
  } catch {
    return "";
  }
}

export function playlistAddress(playlist = {}) {
  const type = String(playlist.sourceType || "");
  if (type === "m3u_url" || type === "url") return String(playlist.url || playlist.baseUrl || "").trim();
  return String(playlist.baseUrl || playlist.url || "").trim();
}

/** Before any request: is this playlist worth trying from this page? */
export function classifyPlaylistAccess(playlist = {}, pageProtocol = "https:") {
  const type = String(playlist.sourceType || "");
  if (type === "stalker") return { access: PlaylistAccess.AppOnly, reason: "stalker-portal" };
  if (type === "m3u_file" || type === "file") return { access: PlaylistAccess.AppOnly, reason: "device-file" };
  if (!LIVE_SOURCE_TYPES.has(type)) return { access: PlaylistAccess.AppOnly, reason: "unsupported-type" };
  const address = playlistAddress(playlist);
  if (!address) return { access: PlaylistAccess.AppOnly, reason: "missing-address" };
  const protocol = protocolOf(address) || "http:";
  if (pageProtocol === "https:" && protocol === "http:") {
    return { access: PlaylistAccess.AppOnly, reason: "insecure-source" };
  }
  return { access: PlaylistAccess.Try, reason: "" };
}

/**
 * After a request failed. A cross-site refusal hides everything from the page, so it
 * surfaces as a bare TypeError: that is the browser blocking, not "no channels".
 */
export function classifyLoadFailure({ error = null, httpStatus = 0, timedOut = false } = {}) {
  if (timedOut || error?.name === "AbortError" || error?.name === "TimeoutError") return LoadFailure.Timeout;
  if (Number(httpStatus) >= 400) return LoadFailure.SourceError;
  if (error instanceof SyntaxError) return LoadFailure.BadResponse;
  if (error instanceof TypeError) return LoadFailure.BlockedBySource;
  return error ? LoadFailure.BadResponse : LoadFailure.BlockedBySource;
}

/** Per channel, before handing it to the player. */
export function channelPlayback(streamUrl = "", pageProtocol = "https:") {
  const url = String(streamUrl || "").trim();
  if (!url) return ChannelPlayback.Missing;
  const protocol = protocolOf(url);
  if (protocol !== "http:" && protocol !== "https:") return ChannelPlayback.Unsupported;
  if (pageProtocol === "https:" && protocol === "http:") return ChannelPlayback.Insecure;
  return ChannelPlayback.TryInBrowser;
}

/** Share (0..1) of channels whose stream address this page may request at all. */
export function secureStreamShare(channels = [], pageProtocol = "https:") {
  if (!channels.length) return 0;
  const ok = channels.filter((ch) => channelPlayback(ch.url, pageProtocol) === ChannelPlayback.TryInBrowser).length;
  return ok / channels.length;
}

/** The one label a playlist row shows. */
export function summarizePlaylistStatus({ access = {}, load = null } = {}) {
  if (access.access === PlaylistAccess.AppOnly) return PlaylistStatus.OpensInApp;
  if (!load) return PlaylistStatus.NotChecked;
  switch (load.state) {
    case "loading":
      return PlaylistStatus.Checking;
    case "empty":
      return PlaylistStatus.Empty;
    case "failed":
      return load.failure === LoadFailure.BlockedBySource ? PlaylistStatus.OpensInApp : PlaylistStatus.Failed;
    case "loaded": {
      const share = Number(load.secureShare ?? 1);
      if (share >= 0.95) return PlaylistStatus.PlaysInBrowser;
      if (share > 0) return PlaylistStatus.Partly;
      return PlaylistStatus.ListsOnly;
    }
    default:
      return PlaylistStatus.NotChecked;
  }
}
