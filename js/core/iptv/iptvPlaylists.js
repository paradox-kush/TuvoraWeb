// Synced IPTV playlists (sync_pull_iptv_playlists_v2) -> the web's playlist model. Pure.
// Ids follow the apps (XtreamAccountSyncService): the server playlist_key wins, else the
// address-derived id. Credentials stay on the model for building provider requests only;
// nothing here (name included) may ever show an address, because an M3U query is the login.

function hostOf(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch {
    return "";
  }
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function derivedId(row) {
  switch (row.source_type) {
    case "xtream":
      return row.base_url && row.username ? `${row.base_url}|${row.username}` : "";
    case "m3u_url":
    case "url": {
      const url = row.url || row.base_url;
      return url ? `m3u|${url}` : "";
    }
    case "m3u_file":
    case "file":
      return `m3u_file|${row.file_name || row.name || "Playlist"}|synced`;
    case "stalker": {
      const portal = row.portal_url || row.base_url;
      return portal && row.mac_address ? `stalker|${portal}|${row.mac_address}` : "";
    }
    default:
      return row.id ? `${row.source_type}|${row.id}` : "";
  }
}

export function normalizePlaylistRows(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.playlists)) {
    throw new TypeError("Unexpected playlist payload");
  }
  return payload.playlists
    .filter((row) => row && row.enabled !== false)
    .map((row, index) => {
      const sourceType = text(row.source_type) || "xtream";
      const normalized = { ...row, source_type: sourceType };
      const address = sourceType === "stalker" ? row.portal_url || row.base_url : row.url || row.base_url;
      return {
        id: text(row.playlist_key) || derivedId(normalized) || `row-${index}`,
        name: text(row.name) || hostOf(address) || text(row.file_name) || "Playlist",
        sourceType,
        sortOrder: Number(row.sort_order) || 0,
        baseUrl: text(row.base_url) || (sourceType === "stalker" ? text(row.portal_url) : ""),
        url: text(row.url),
        username: text(row.username),
        password: typeof row.password === "string" ? row.password : "",
        epgUrl: text(row.epg_url),
        fileName: text(row.file_name),
        hasCustomUserAgent: Boolean(text(row.user_agent))
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The id the apps save a live channel under (XtreamItemRegistry.liveId). */
export function liveContentId(playlistId, channelId) {
  return `xtream:${playlistId}:live:${channelId}`;
}
