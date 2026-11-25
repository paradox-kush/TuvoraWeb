// The playlist and group the viewer last had open, per profile, on this browser.
// A playlist id can be derived from its address (see iptvPlaylists.js), so only a fingerprint
// of the id is stored: nothing that names a provider or a login is written to localStorage.

const KEY_PREFIX = "tuvora.live.selection.";

function fingerprint(value) {
  // FNV-1a, 32 bit. Collisions only mean "restore the wrong tab", never a wrong request.
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function createLiveSelectionMemory({ storage = globalThis.localStorage, profileId = 1 } = {}) {
  const key = `${KEY_PREFIX}${profileId}`;
  let state = { playlist: "", groups: {} };
  try {
    const parsed = JSON.parse(storage?.getItem(key) || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      state = {
        playlist: typeof parsed.playlist === "string" ? parsed.playlist : "",
        groups: parsed.groups && typeof parsed.groups === "object" && !Array.isArray(parsed.groups) ? { ...parsed.groups } : {}
      };
    }
  } catch {
    // Blocked or corrupt storage: nothing remembered.
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(state));
    } catch {
      // Private mode or blocked storage: the choice lasts for this visit only.
    }
  };
  return {
    /** The id of the remembered playlist among these, or "" when it is gone or none was. */
    pickPlaylist(playlists = []) {
      if (!state.playlist) return "";
      return playlists.find((playlist) => fingerprint(playlist.id) === state.playlist)?.id || "";
    },
    groupId(playlistId) {
      const value = state.groups[fingerprint(playlistId)];
      return typeof value === "string" ? value : "";
    },
    rememberPlaylist(playlistId) {
      state.playlist = fingerprint(playlistId);
      save();
    },
    rememberGroup(playlistId, groupId) {
      state.groups[fingerprint(playlistId)] = String(groupId || "");
      save();
    }
  };
}
