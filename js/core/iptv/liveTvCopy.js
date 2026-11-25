// The words the Live TV screen uses for each state. Pure, so the wording is tested: every
// reason is named, none is shown as "no channels", and no line can carry an address.
import { LoadFailure, PlaylistStatus } from "./iptvSourceCapability.js";

const BADGES = {
  [PlaylistStatus.NotChecked]: { label: "Not checked yet", tone: "muted" },
  [PlaylistStatus.Checking]: { label: "Checking…", tone: "muted" },
  [PlaylistStatus.PlaysInBrowser]: { label: "Plays here", tone: "good" },
  [PlaylistStatus.Partly]: { label: "Partly plays here", tone: "warn" },
  [PlaylistStatus.ListsOnly]: { label: "Lists here", tone: "warn" },
  [PlaylistStatus.OpensInApp]: { label: "Tuvora app only", tone: "app" },
  [PlaylistStatus.Empty]: { label: "No channels", tone: "muted" },
  [PlaylistStatus.Failed]: { label: "Couldn't load", tone: "bad" }
};

export function statusBadge(status) {
  return BADGES[status] || BADGES[PlaylistStatus.NotChecked];
}

const APP_ONLY = {
  "stalker-portal": {
    title: "This playlist opens in the Tuvora apps",
    body: "This provider uses a Stalker portal, which only works in the Tuvora apps. A web page can't sign in to one."
  },
  "device-file": {
    title: "This playlist lives on another device",
    body: "This playlist is a file on another device, so this browser has no copy of it. It plays in the Tuvora app it was added to."
  },
  "insecure-source": {
    title: "Browsers block this provider",
    body: "This provider is http-only; browsers block it on a secure page. It plays in the Tuvora apps."
  },
  "missing-address": {
    title: "This playlist has no address",
    body: "This playlist was saved without a provider address. Open it in the Tuvora app to fix it there."
  },
  "unsupported-type": {
    title: "This playlist opens in the Tuvora apps",
    body: "This kind of playlist isn't supported in a web browser yet. It plays in the Tuvora apps."
  }
};

export function appOnlyCopy(reason) {
  return APP_ONLY[reason] || {
    title: "This playlist opens in the Tuvora apps",
    body: "This playlist can't be opened in a web browser. It plays in the Tuvora apps."
  };
}

const FAILURES = {
  [LoadFailure.BlockedBySource]: {
    title: "This provider can't be reached from a web browser",
    body: "This provider doesn't allow web browsers to read its channel list, or is offline. It plays in the Tuvora apps.",
    offerApp: true
  },
  [LoadFailure.SourceError]: {
    title: "The provider refused the request",
    body: "The provider answered with an error. The subscription may have expired, or the provider may be down.",
    offerApp: false
  },
  [LoadFailure.Timeout]: {
    title: "The provider took too long",
    body: "The provider didn't answer in time, so we stopped waiting.",
    offerApp: false
  },
  [LoadFailure.Offline]: {
    title: "You're offline",
    body: "This device has no connection right now. Retry once you're back online.",
    offerApp: false
  },
  [LoadFailure.BadResponse]: {
    title: "The provider sent something unexpected",
    body: "The provider answered, but not with a channel list we can read.",
    offerApp: false
  }
};

export function failureCopy(failure) {
  return FAILURES[failure] || {
    title: "Couldn't load this playlist",
    body: "Something went wrong while loading the channel list.",
    offerApp: false
  };
}

/** One line above the channel list when some streams will not play on this page. */
export function playbackNotice(status) {
  if (status === PlaylistStatus.Partly) {
    return "Some channels on this playlist can't play in a browser. Those open with a choice of another player.";
  }
  if (status === PlaylistStatus.ListsOnly) {
    return "Channels on this playlist can't play in a browser. Picking one offers another player instead.";
  }
  return "";
}
