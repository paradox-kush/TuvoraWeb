// Markup for the Live TV screen. Strings in, strings out: no fetches, no decisions about
// what a playlist can do (those come from js/core/iptv). Nothing here may print an address.
import { ChannelPlayback, PlaylistStatus } from "../../../core/iptv/iptvSourceCapability.js";
import { nowNext, programmeProgress } from "../../../core/iptv/liveGuide.js";
import { appOnlyCopy, failureCopy, playbackNotice, statusBadge } from "../../../core/iptv/liveTvCopy.js";

export const TUVORA_APP_URL = "https://tuvora.co";

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const icon = (name) => `<span class="material-icons" aria-hidden="true">${name}</span>`;

const appLink = (label = "Open the Tuvora app") =>
  `<a class="live-tv-button live-tv-button-primary" href="${TUVORA_APP_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}${icon("open_in_new")}</a>`;

function stateCard({ glyph, title, body, actions = "", tone = "" }) {
  return `<section class="live-tv-card${tone ? ` is-${tone}` : ""}" role="status">
    <span class="live-tv-card-glyph" aria-hidden="true">${icon(glyph)}</span>
    <div class="live-tv-card-copy"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></div>
    ${actions ? `<div class="live-tv-card-actions">${actions}</div>` : ""}
  </section>`;
}

export function signedOutCard() {
  return stateCard({
    glyph: "live_tv",
    title: "Sign in to watch Live TV",
    body: "Your IPTV playlists are saved to your Tuvora account. Sign in to see the ones this browser can play.",
    actions: `<button type="button" class="live-tv-button live-tv-button-primary" data-live-action="sign-in">Sign in</button>`
  });
}

export function noPlaylistsCard() {
  return stateCard({
    glyph: "playlist_add",
    title: "No playlists on this profile yet",
    body: "Playlists are added in the Tuvora app on your TV, phone or computer. Once one is added there, it shows up here.",
    actions: `${appLink("Get the Tuvora app")}<button type="button" class="live-tv-button" data-live-action="reload-playlists">${icon("refresh")}Check again</button>`
  });
}

export function playlistsFailedCard() {
  return stateCard({
    glyph: "cloud_off",
    tone: "bad",
    title: "Couldn't load your playlists",
    body: "We couldn't reach your Tuvora account to read your playlists. Your playlists are still there.",
    actions: `<button type="button" class="live-tv-button live-tv-button-primary" data-live-action="reload-playlists">${icon("refresh")}Retry</button>`
  });
}

export function appOnlyCard(reason) {
  const copy = appOnlyCopy(reason);
  return stateCard({ glyph: "devices", tone: "app", title: copy.title, body: copy.body, actions: appLink() });
}

export function failedCard(failure) {
  const copy = failureCopy(failure);
  const retry = `<button type="button" class="live-tv-button${copy.offerApp ? "" : " live-tv-button-primary"}" data-live-action="retry-channels">${icon("refresh")}Retry</button>`;
  return stateCard({
    glyph: copy.offerApp ? "devices" : "error_outline",
    tone: copy.offerApp ? "app" : "bad",
    title: copy.title,
    body: copy.body,
    actions: copy.offerApp ? `${appLink()}${retry}` : retry
  });
}

export function emptyPlaylistCard() {
  return stateCard({
    glyph: "tv_off",
    title: "This playlist has no live channels",
    body: "The provider answered, and its channel list is empty.",
    actions: `<button type="button" class="live-tv-button" data-live-action="retry-channels">${icon("refresh")}Check again</button>`
  });
}

export function skeleton(label) {
  const row = `<div class="live-tv-skeleton-row"><span class="live-tv-skeleton-logo"></span><span class="live-tv-skeleton-lines"><span></span><span></span></span></div>`;
  return `<div class="live-tv-skeleton" role="status" aria-live="polite">
    <p class="live-tv-skeleton-label">${escapeHtml(label)}</p>
    <div aria-hidden="true">${row.repeat(8)}</div>
  </div>`;
}

export function playlistTabs(playlists, statuses, selectedIndex) {
  return playlists.map((playlist, index) => {
    const badge = statusBadge(statuses[index]);
    const selected = index === selectedIndex;
    return `<button type="button" role="tab" class="live-tv-playlist${selected ? " is-selected" : ""}" data-live-playlist="${index}"
      aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}">
      <span class="live-tv-playlist-name">${escapeHtml(playlist.name)}</span>
      <span class="live-tv-badge is-${badge.tone}">${escapeHtml(badge.label)}</span>
    </button>`;
  }).join("");
}

export function groupRail(rail, selectedId, searching) {
  return rail.map((group, index) => {
    const selected = !searching && group.id === selectedId;
    return `<button type="button" class="live-tv-group${selected ? " is-selected" : ""}" data-live-group="${index}" aria-pressed="${selected}">
      ${index === 0 ? icon("star") : ""}<span class="live-tv-group-name">${escapeHtml(group.label)}</span>
      <span class="live-tv-group-count">${group.count}</span>
    </button>`;
  }).join("");
}

export function notice(status) {
  const text = status === PlaylistStatus.Partly || status === PlaylistStatus.ListsOnly ? playbackNotice(status) : "";
  return text ? `<p class="live-tv-notice">${icon("info")}<span>${escapeHtml(text)}</span></p>` : "";
}

function logoUrl(value, pageProtocol) {
  const url = String(value || "");
  if (/^https:\/\//i.test(url)) return escapeHtml(url);
  return pageProtocol !== "https:" && /^http:\/\//i.test(url) ? escapeHtml(url) : "";
}

/** The guide lines of one row. Nothing at all when there is no programme: no placeholders. */
export function guideMarkup(entry, nowMs = Date.now()) {
  if (!entry || entry.state !== "loaded") return "";
  const { now, next } = nowNext(entry.programmes, nowMs);
  if (!now && !next) return "";
  const percent = Math.round(programmeProgress(now, nowMs) * 100);
  return `${now ? `<span class="live-tv-now">${escapeHtml(now.title || "On now")}</span>
      <span class="live-tv-progress" role="progressbar" aria-label="Programme progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></span>` : ""}
    ${next ? `<span class="live-tv-next">Next: ${escapeHtml(next.title || "Untitled")}</span>` : ""}`;
}

export function channelRows({ channels, from, to, isFavourite, playbackOf, guideOf, pageProtocol, nowMs }) {
  let html = "";
  for (let index = from; index < to; index += 1) {
    const channel = channels[index];
    const favourite = isFavourite(channel);
    const playback = playbackOf(channel);
    const missing = playback === ChannelPlayback.Missing;
    const logo = logoUrl(channel.logo, pageProtocol);
    const name = escapeHtml(channel.name);
    const tag = missing ? "No stream" : playback !== ChannelPlayback.TryInBrowser ? "Other player" : "";
    html += `<div class="live-tv-row" role="listitem" data-live-row="${index}">
      <button type="button" class="live-tv-row-play" data-live-channel="${index}"${missing ? " disabled" : ""}>
        <span class="live-tv-number">${channel.number}</span>
        <span class="live-tv-logo" aria-hidden="true"><span>${escapeHtml(String(channel.name || "?").trim().charAt(0).toUpperCase())}</span>${logo ? `<img src="${logo}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ""}</span>
        <span class="live-tv-row-copy">
          <span class="live-tv-title-line"><strong>${name}</strong>${tag ? `<span class="live-tv-tag">${tag}</span>` : ""}</span>
          <span class="live-tv-guide" data-live-guide>${guideMarkup(guideOf(channel), nowMs)}</span>
        </span>
      </button>
      <button type="button" class="live-tv-star${favourite ? " is-on" : ""}" data-live-favourite="${index}" aria-pressed="${favourite}"
        aria-label="${favourite ? "Remove" : "Add"} ${name} ${favourite ? "from" : "to"} favourites" title="${favourite ? "Remove from favourites" : "Add to favourites"}">${icon(favourite ? "star" : "star_border")}</button>
    </div>`;
  }
  return html;
}

export function listEmpty({ searching, favourites }) {
  if (searching) return `<p class="live-tv-list-empty">No channel on this playlist matches your search.</p>`;
  if (favourites) return `<p class="live-tv-list-empty">No favourites yet. Use the star on a channel to keep it here.</p>`;
  return `<p class="live-tv-list-empty">This group has no channels.</p>`;
}
