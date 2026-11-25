// Live channel favourites, per profile, on this browser. Keys use the apps' content id
// (xtream:{playlist}:live:{channel}) so moving them onto the synced library later is a
// storage swap, not a migration. Phase 1 is local only: see docs/iptv-web.md.

const KEY_PREFIX = "tuvora.live.favourites.";

export function createLiveFavourites({ storage = globalThis.localStorage, profileId = 1 } = {}) {
  const key = `${KEY_PREFIX}${profileId}`;
  let ids = [];
  try {
    const parsed = JSON.parse(storage?.getItem(key) || "[]");
    if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === "string");
  } catch {
    ids = [];
  }
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify(ids));
    } catch {
      // Private mode or blocked storage: favourites last for this visit only.
    }
  };
  return {
    list: () => [...ids],
    has: (id) => ids.includes(id),
    toggle(id) {
      ids = ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids];
      save();
      return ids.includes(id);
    }
  };
}
