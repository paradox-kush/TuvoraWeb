// What the Sports hub knows, shared with the game page for one browser session and one profile:
// fixtures, live state, follows and Hide-scores reveals. Rebuilt on a profile or account change.
import { EMPTY_LIVE_STATE } from "../../../core/sports/liveStatus.js";

function fresh(profileKey) {
  return {
    profileKey,
    catalog: null,
    follows: null,               // { leagues, teams, prefs, source }
    fixturesByLeague: {},
    fixturesByTeam: {},
    liveState: EMPTY_LIVE_STATE,
    lastFullAtMs: null,
    lastLiveAtMs: null,
    revealed: new Set()          // fixture keys revealed while Hide scores is on (never stored)
  };
}

let session = fresh(null);

export function sportsSessionFor(profileKey) {
  if (session.profileKey !== profileKey) session = fresh(profileKey);
  return session;
}

export function findFixture(key) {
  const lists = [...Object.values(session.fixturesByLeague), ...Object.values(session.fixturesByTeam)];
  for (const list of lists) {
    const hit = (list || []).find(f => String(f?.id ?? "") === String(key) || `${f?.leagueId}/${f?.event}/${f?.ts}` === key);
    if (hit) return hit;
  }
  return null;
}
