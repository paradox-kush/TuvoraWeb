// Sports Centre I/O. The same backend and user data as the native apps:
//  - radar-fixtures (Supabase edge function, verify_jwt=false, CORS *): catalog, fixtures, livescore.
//  - game-detail (GET, CORS *): one game's normalised header + blocks; ±14 days of kick-off only.
//  - radar_follows / radar_team_follows / radar_prefs (RLS, per profile) when signed in, written
//    through sync_push_radar exactly as the native RadarSyncService does. Signed out, follows live
//    in this browser only (per profile), like the native local-anonymous state.
// Every call takes an AbortSignal; deadlines are the caller's (boundedLoad.withDeadline).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config.js";
import { SupabaseApi } from "../remote/supabase/supabaseApi.js";
import { BUNDLED_SPORTS_CATALOG } from "../../core/sports/sportsCatalogData.js";

const FUNCTIONS = `${String(SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1`;
const LOCAL_KEY = profileId => `tuvora.sports.v1.${profileId}`;
const CATALOG_KEY = "tuvora.sports.catalog.v1";
const CATALOG_TTL_MS = 6 * 3_600_000;
const MIN_CATALOG_CATEGORIES = 3;
const MIN_CATALOG_LEAGUES = 10;

function readLocal(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeLocal(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
}

async function callRadarFixtures(body, signal) {
  const response = await fetch(`${FUNCTIONS}/radar-fixtures`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
    credentials: "omit",
    signal
  });
  if (!response.ok) {
    const error = new Error(`Sports data request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function isUsableCatalog(catalog) {
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  return categories.length >= MIN_CATALOG_CATEGORIES
    && categories.reduce((sum, c) => sum + (Array.isArray(c?.leagues) ? c.leagues.length : 0), 0) >= MIN_CATALOG_LEAGUES;
}

// Follow/prefs writes are read-modify-write: run them one at a time so a second click reads the
// first click's result instead of racing it (a lost update would silently drop a follow).
let writeQueue = Promise.resolve();
function serialised(work) {
  const run = writeQueue.then(work, work);
  writeQueue = run.catch(() => {});
  return run;
}

export const sportsRepository = {
  /** Cached published catalog, else the bundled copy: never empty, never waits on the network. */
  cachedCatalog() {
    const cached = readLocal(CATALOG_KEY, null);
    return isUsableCatalog(cached?.catalog) ? cached.catalog : BUNDLED_SPORTS_CATALOG;
  },

  /** Refresh the published catalog when the cache is older than 6 h; a bad publish keeps the current one. */
  async refreshCatalog(signal, nowMs = Date.now()) {
    const cached = readLocal(CATALOG_KEY, null);
    if (cached?.fetchedAtMs && nowMs - cached.fetchedAtMs < CATALOG_TTL_MS && isUsableCatalog(cached.catalog)) return cached.catalog;
    const envelope = await callRadarFixtures({ catalog: "1" }, signal);
    if (!isUsableCatalog(envelope?.payload)) return this.cachedCatalog();
    writeLocal(CATALOG_KEY, { catalog: envelope.payload, fetchedAtMs: nowMs, version: envelope.version });
    return envelope.payload;
  },

  /** -> { fixtures, teamFixtures, livescore, fetchedAt }. Throws on failure (never "empty"). */
  async fetchFixtures({ leagueIds = [], teamIds = [], livescoreSports = [] }, signal) {
    if (!leagueIds.length && !teamIds.length && !livescoreSports.length) return { fixtures: {}, teamFixtures: {}, livescore: {} };
    const body = await callRadarFixtures({ league_ids: leagueIds, livescore_sports: livescoreSports, team_ids: teamIds }, signal);
    return {
      fixtures: body?.fixtures && typeof body.fixtures === "object" ? body.fixtures : {},
      teamFixtures: body?.teamFixtures && typeof body.teamFixtures === "object" ? body.teamFixtures : {},
      livescore: body?.livescore && typeof body.livescore === "object" ? body.livescore : {},
      fetchedAt: body?.fetchedAt || null
    };
  },

  /**
   * One game's detail. -> { status: "ok", detail, maxAgeS } | { status: "unavailable" } (404: outside the
   * backend's ±14-day window or unknown) | { status: "disabled" } (kill switch). Throws on other failures.
   */
  async fetchGameDetail(eventId, leagueId, signal) {
    const params = new URLSearchParams({ event_id: String(eventId) });
    if (/^\d{3,7}$/.test(String(leagueId || ""))) params.set("league_id", String(leagueId));
    const response = await fetch(`${FUNCTIONS}/game-detail?${params}`, { credentials: "omit", signal });
    if (response.status === 404 || response.status === 400) return { status: "unavailable" };
    if (!response.ok) {
      const error = new Error(response.status === 429 ? "Too many requests; try again in a minute" : `Game details failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const detail = await response.json();
    if (detail?.disabled) return { status: "disabled" };
    const maxAge = /max-age=(\d+)/.exec(response.headers.get("Cache-Control") || "");
    return { status: "ok", detail, maxAgeS: maxAge ? Number(maxAge[1]) : null };
  },

  /**
   * Follows + prefs for a profile. -> { leagues: [follow row], teams: [team row], prefs: {...}|null, source }.
   * Signed in reads the synced rows (RLS-scoped). Throws when that read fails: the screen shows Failed, never "nothing followed".
   */
  async loadFollows({ profileId, signedIn }) {
    if (!signedIn) {
      const local = readLocal(LOCAL_KEY(profileId), null) || {};
      return { leagues: Array.isArray(local.leagues) ? local.leagues : [], teams: Array.isArray(local.teams) ? local.teams : [], prefs: local.prefs || null, source: "local" };
    }
    const pid = encodeURIComponent(String(profileId));
    const [leagues, teams, prefs] = await Promise.all([
      SupabaseApi.select("radar_follows", `select=league_id,sport,sort_order,name,badge,banner,keywords,custom&profile_id=eq.${pid}&order=sort_order.asc`),
      SupabaseApi.select("radar_team_follows", `select=team_id,name,sport,badge,league_id,league,keywords,sort_order&profile_id=eq.${pid}&order=sort_order.asc`),
      SupabaseApi.select("radar_prefs", `select=featured_event_id,opt_in_state,promo_dismissed,scores_shown,score_delay_s&profile_id=eq.${pid}`)
    ]);
    return { leagues: leagues || [], teams: teams || [], prefs: Array.isArray(prefs) ? prefs[0] || null : null, source: "remote" };
  },

  /**
   * Follow or unfollow a catalog league. Signed in: re-reads the profile's rows immediately before the
   * full-replace push (so a change made on another device is not wiped), keeps custom leagues' own
   * metadata, and leaves prefs and teams untouched (p_prefs / p_teams null = "nothing to say").
   */
  setLeagueFollowed(args) {
    return serialised(() => this.writeLeagueFollowed(args));
  },

  async writeLeagueFollowed({ profileId, signedIn, league, followed }) {
    const current = await this.loadFollows({ profileId, signedIn });
    const without = current.leagues.filter(row => String(row.league_id) !== String(league.id));
    const leagues = followed
      ? [...without, { league_id: String(league.id), sport: league.sport || "", sort_order: without.length }]
      : without;
    if (!signedIn) {
      writeLocal(LOCAL_KEY(profileId), { leagues, teams: current.teams, prefs: current.prefs });
      return { ...current, leagues };
    }
    await SupabaseApi.rpc("sync_push_radar", {
      p_profile_id: Number(profileId),
      p_follows: leagues.map((row, index) => followPushRow(row, index)),
      p_prefs: null
    });
    return { ...current, leagues };
  },

  /**
   * Hide scores (radar_prefs.scores_shown), synced per profile like the native apps. The score delay is
   * not sent, so the stored one is kept (the RPC treats a missing key as "keep").
   */
  setScoresShown(args) {
    return serialised(() => this.writeScoresShown(args));
  },

  async writeScoresShown({ profileId, signedIn, shown }) {
    const current = await this.loadFollows({ profileId, signedIn });
    const prefs = { ...(current.prefs || {}), scores_shown: Boolean(shown) };
    if (!signedIn) {
      writeLocal(LOCAL_KEY(profileId), { leagues: current.leagues, teams: current.teams, prefs });
      return { ...current, prefs };
    }
    await SupabaseApi.rpc("sync_push_radar", {
      p_profile_id: Number(profileId),
      p_follows: current.leagues.map((row, index) => followPushRow(row, index)),
      p_prefs: {
        featured_event_id: prefs.featured_event_id || "",
        opt_in_state: prefs.opt_in_state || "unset",
        promo_dismissed: Boolean(prefs.promo_dismissed),
        scores_shown: Boolean(shown)
      }
    });
    return { ...current, prefs };
  }
};

/** The native push shape: custom leagues carry their own metadata, catalog leagues only their id. */
function followPushRow(row, index) {
  const out = { league_id: String(row.league_id), sport: row.sport || "", sort_order: index };
  if (row.custom) {
    out.custom = true;
    if (row.name) out.name = row.name;
    if (row.badge) out.badge = row.badge;
    if (row.banner) out.banner = row.banner;
    if (Array.isArray(row.keywords) && row.keywords.length) out.keywords = row.keywords;
  }
  return out;
}

export const __testing = { followPushRow };
