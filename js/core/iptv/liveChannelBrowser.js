// What the Live TV screen shows for a loaded playlist: the group rail, the filtered channel
// list, what to restore from last time, how much of a long list to draw. Pure: no DOM.

export const GroupId = Object.freeze({
  Favourites: "favourites",
  All: "all"
});

/** Prefixed so a provider group named "all" or "favourites" cannot collide with ours. */
export function providerGroupId(name) {
  return `group:${name}`;
}

/** Rows to draw per step. An Xtream panel can list 10k+ channels; the DOM never holds them all. */
export const CHANNEL_WINDOW = 80;

function fold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ð/gi, "d")
    .replace(/þ/gi, "th")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** The provider's channel number when it sent one, else the position in the playlist. */
export function withChannelNumbers(channels = []) {
  return channels.map((channel, index) => ({
    ...channel,
    number: Number(channel.number) > 0 ? Number(channel.number) : index + 1
  }));
}

/** Favourites first, then All, then the provider's groups in the provider's order. */
export function buildGroupRail({ groups = [], channels = [], isFavourite = () => false } = {}) {
  const counts = new Map();
  let favourites = 0;
  for (const channel of channels) {
    counts.set(channel.group, (counts.get(channel.group) || 0) + 1);
    if (isFavourite(channel)) favourites += 1;
  }
  return [
    { id: GroupId.Favourites, label: "Favourites", count: favourites },
    { id: GroupId.All, label: "All channels", count: channels.length },
    ...groups.map((name) => ({ id: providerGroupId(name), label: name, count: counts.get(name) || 0 }))
  ];
}

/**
 * The channels to list. A search looks across the whole playlist (the viewer is looking for
 * a channel, not for a channel inside the group that happens to be open).
 */
export function filterChannels({ channels = [], groupId = GroupId.All, query = "", isFavourite = () => false } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length) {
    return channels.filter((channel) => {
      const name = fold(channel.name);
      return words.every((word) => name.includes(word));
    });
  }
  if (groupId === GroupId.All) return channels.slice();
  if (groupId === GroupId.Favourites) return channels.filter((channel) => isFavourite(channel));
  return channels.filter((channel) => providerGroupId(channel.group) === groupId);
}

/** Last time's group if it still has channels; else Favourites when there are any; else All. */
export function resolveGroup(rail = [], rememberedId = "") {
  const remembered = rail.find((group) => group.id === rememberedId);
  if (remembered && remembered.count > 0) return remembered.id;
  const favourites = rail.find((group) => group.id === GroupId.Favourites);
  return favourites && favourites.count > 0 ? GroupId.Favourites : GroupId.All;
}

export function resolvePlaylist(playlists = [], rememberedId = "") {
  if (playlists.some((playlist) => playlist.id === rememberedId)) return rememberedId;
  return playlists[0]?.id || "";
}

/** How many rows to have drawn after the next step. */
export function nextWindow({ rendered = 0, total = 0, step = CHANNEL_WINDOW } = {}) {
  return Math.max(0, Math.min(total, rendered + step));
}

/** The row a key moves to, or -1 when the key does not move within the list. */
export function rowNeighbour({ index = 0, total = 0, key = "" } = {}) {
  if (total <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return index + 1 < total ? index + 1 : -1;
    case "ArrowUp":
      return index > 0 ? index - 1 : -1;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return -1;
  }
}
