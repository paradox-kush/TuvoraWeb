// Live TV I/O for the browser: synced playlists from Tuvora's backend, channels and now/next
// straight from the provider when the page is allowed to reach it. Decisions live in the pure
// modules next to this file; this one only fetches.
//
// Provider requests use bare fetch (never httpClient): no Tuvora session token or apikey may
// ever travel to a third-party host. Credentials never reach logs, errors or analytics.
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "../profile/profileManager.js";
import { normalizePlaylistRows } from "./iptvPlaylists.js";
import { parseM3u } from "./m3uParser.js";
import { chooseLiveExtension, mapXtreamLive, parseShortEpg, xtreamApiUrl, xtreamLiveUrl } from "./xtreamApi.js";
import { secureStreamShare } from "./iptvSourceCapability.js";
import { nowNextValidUntil } from "./liveGuide.js";

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { httpStatus: status });
}

async function providerFetch(url, signal, as = "json") {
  // credentials: "omit" and no custom headers keep it a CORS "simple" request (no preflight).
  const response = await fetch(url, { signal, credentials: "omit", cache: "no-store" });
  if (!response.ok) throw httpError(response.status);
  return as === "text" ? response.text() : response.json();
}

function activeProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId?.() ?? 1);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

export async function fetchSyncedPlaylists() {
  const payload = await SupabaseApi.rpc("sync_pull_iptv_playlists_v2", { p_profile_id: activeProfileId() });
  return normalizePlaylistRows(payload);
}

async function loadXtreamChannels(playlist, signal) {
  const login = await providerFetch(xtreamApiUrl(playlist), signal);
  if (login?.user_info && Number(login.user_info.auth) === 0) throw httpError(401);
  const extension = chooseLiveExtension(login?.user_info?.allowed_output_formats);
  const [categories, streams] = await Promise.all([
    providerFetch(xtreamApiUrl(playlist, "get_live_categories"), signal),
    providerFetch(xtreamApiUrl(playlist, "get_live_streams"), signal)
  ]);
  const mapped = mapXtreamLive(categories, streams);
  mapped.channels.forEach((channel) => {
    channel.url = xtreamLiveUrl(playlist, channel.streamId, extension);
  });
  return { ...mapped, extension, guide: "xtream-short-epg" };
}

async function loadM3uChannels(playlist, signal) {
  const text = await providerFetch(playlist.url || playlist.baseUrl, signal, "text");
  const parsed = parseM3u(text);
  if (!parsed.valid) throw new SyntaxError("Not an M3U playlist");
  const groups = [];
  parsed.channels.forEach((channel) => {
    if (channel.group && !groups.includes(channel.group)) groups.push(channel.group);
  });
  if (parsed.channels.some((channel) => !channel.group)) {
    parsed.channels.forEach((channel) => { if (!channel.group) channel.group = "Other"; });
    groups.push("Other");
  }
  // M3U guides are XMLTV files (often gzip, often without CORS): phase 2, via the EPG mirror.
  return { groups, channels: parsed.channels, extension: "", guide: "none" };
}

/** Channels for one playlist. Throws on any failure; runBoundedLoad turns that into Failed. */
export async function fetchPlaylistChannels(playlist, signal) {
  const result = playlist.sourceType === "xtream"
    ? await loadXtreamChannels(playlist, signal)
    : await loadM3uChannels(playlist, signal);
  const pageProtocol = String(globalThis.location?.protocol || "https:");
  return { ...result, secureShare: secureStreamShare(result.channels, pageProtocol) };
}

/** Now/next for one Xtream channel: { programmes, validUntilMs }. */
export async function fetchXtreamNowNext(playlist, channel, signal) {
  const payload = await providerFetch(
    xtreamApiUrl(playlist, "get_short_epg", { stream_id: channel.streamId, limit: 4 }),
    signal
  );
  const programmes = parseShortEpg(payload);
  return { programmes, validUntilMs: nowNextValidUntil(programmes, Date.now()) };
}
