// What to tell the viewer, and offer them, when a stream cannot play in the browser.
// Pure: no DOM, no player. The player screen renders the result.
//
// A browser refuses things a native app does fine: http sources on an https page,
// sources that do not allow cross-site playback (CORS) or need custom headers,
// and formats it cannot decode. Those failures name the browser limit and point
// to a Tuvora app (or VLC on a phone) instead of failing silently. A failure the
// source itself reports (an HTTP status) is broken everywhere, so it offers only Back.

export const BrowserPlaybackFailure = Object.freeze({
  InsecureSource: "insecure-source",
  BlockedBySource: "blocked-by-source",
  UnsupportedFormat: "unsupported-format",
  SourceError: "source-error",
  Unknown: "unknown"
});

const BROWSER_LIMITS = new Set([
  BrowserPlaybackFailure.InsecureSource,
  BrowserPlaybackFailure.BlockedBySource,
  BrowserPlaybackFailure.UnsupportedFormat,
  BrowserPlaybackFailure.Unknown
]);

const MESSAGES = Object.freeze({
  [BrowserPlaybackFailure.InsecureSource]:
    "This source is not secure (http), and browsers block insecure video on a secure page. Open it in the Tuvora app or another player.",
  [BrowserPlaybackFailure.BlockedBySource]:
    "This source doesn't allow playback in a web browser. Open it in the Tuvora app or another player.",
  [BrowserPlaybackFailure.UnsupportedFormat]:
    "Your browser can't play this video format. Open it in the Tuvora app or another player.",
  [BrowserPlaybackFailure.SourceError]: "",
  [BrowserPlaybackFailure.Unknown]: "This stream didn't play in the browser. Try the Tuvora app or another player."
});

function protocolOf(url) {
  try {
    return new URL(String(url || "")).protocol;
  } catch {
    return "";
  }
}

// Failures where the browser never got playable media from the source. Resolver and
// missing-URL errors are not browser limits: another app would fail the same way.
const MEDIA_FAILURE_REASONS = new Set([
  "play-start",
  "play-after-startup",
  "startup-media-error",
  "media-error",
  "startup-stall",
  "playback-stall"
]);

export function isBrowserMediaFailure({ reason = "", mediaErrorCode = 0 } = {}) {
  return Number(mediaErrorCode) > 0 || MEDIA_FAILURE_REASONS.has(String(reason));
}

export function classifyBrowserPlaybackFailure({
  pageProtocol = "",
  mediaUrl = "",
  mediaErrorCode = 0,
  httpStatus = 0,
  detail = "",
  headerRestricted = false
} = {}) {
  const code = Number(mediaErrorCode || 0);
  const text = String(detail || "").toLowerCase();
  let reason;
  if (pageProtocol === "https:" && protocolOf(mediaUrl) === "http:") {
    reason = BrowserPlaybackFailure.InsecureSource;
  } else if (Number(httpStatus) >= 400) {
    reason = BrowserPlaybackFailure.SourceError;
  } else if (headerRestricted) {
    reason = BrowserPlaybackFailure.BlockedBySource;
  } else if (code === 3 || (code === 4 && /not supported|no supported source|unsupported/.test(text))) {
    reason = BrowserPlaybackFailure.UnsupportedFormat;
  } else if (code === 2 || code === 4) {
    // A cross-site refusal hides the status from the page, so it surfaces as a bare network error.
    reason = BrowserPlaybackFailure.BlockedBySource;
  } else {
    reason = BrowserPlaybackFailure.Unknown;
  }
  return { reason, message: MESSAGES[reason] };
}

/** Same shape as the apps' buildMetaDeepLinkUrl (AppUrlBridge.kt). */
export function buildTuvoraAppLink({ type = "", id = "" } = {}) {
  const cleanType = String(type || "").trim();
  const cleanId = String(id || "").trim();
  if (!cleanType || !cleanId) return "";
  return `tuvora://meta?type=${encodeURIComponent(cleanType)}&id=${encodeURIComponent(cleanId)}`;
}

function isTransferable(url) {
  const protocol = protocolOf(url);
  return protocol === "http:" || protocol === "https:";
}

/** The platform's players with the viewer's saved choice first; the rest keep their order. */
export function orderExternalPlayers(players = [], preferred = "") {
  const list = players.filter((id) => id && id !== "disabled");
  return list.includes(preferred) ? [preferred, ...list.filter((id) => id !== preferred)] : list;
}

export function fallbackActionsFor({
  reason,
  players = [],
  preferredPlayer = "",
  contentType = "",
  contentId = "",
  mediaUrl = ""
} = {}) {
  const actions = [];
  if (BROWSER_LIMITS.has(reason)) {
    const href = buildTuvoraAppLink({ type: contentType, id: contentId });
    if (href) actions.push({ id: "open-app", href });
    if (isTransferable(mediaUrl)) {
      orderExternalPlayers(players, preferredPlayer).forEach((player) => actions.push({ id: "player", player }));
      actions.push({ id: "copy-link" });
    }
  }
  actions.push({ id: "back" });
  return actions;
}
