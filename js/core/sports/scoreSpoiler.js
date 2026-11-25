// Hide scores, ported from the native ScoreSpoilerPolicy + GameSpoilerRedaction
// (NuvioMobile features/radar/ScoreSpoilerPolicy.kt, sportsdetail/internal/GameSpoilerGate.kt).
// settings: { scoresShown: boolean (radar_prefs.scores_shown), revealed: Set<fixtureKey> (this session only) }.
// The score delay (radar_prefs.score_delay_s) exists to stay behind a live stream; the web app plays no
// sports streams yet, so it is not applied here (phase 2, with "watch this game").
import { fixtureKey } from "./sportsFixtures.js";

export function isScoreHidden(settings, key) {
  return settings?.scoresShown === false && !settings?.revealed?.has?.(String(key));
}

const clean = value => {
  const text = String(value ?? "").trim();
  return text || null;
};

/**
 * What a card's score slots show. state = gameState(...). The live feed's score is fresher than the fixture row.
 * -> { home, away, hidden, leader: "home" | "away" | null }
 */
export function scoreSlots(settings, fixture, liveScore, state) {
  const started = state === "live" || state === "final";
  if (!started) return { home: null, away: null, hidden: false, leader: null };
  if (isScoreHidden(settings, fixtureKey(fixture))) return { home: null, away: null, hidden: true, leader: null };
  const home = clean(liveScore?.homeScore) ?? clean(fixture?.homeScore);
  const away = clean(liveScore?.awayScore) ?? clean(fixture?.awayScore);
  let leader = null;
  if (home != null && away != null && Number.isFinite(+home) && Number.isFinite(+away) && +home !== +away) {
    leader = +home > +away ? "home" : "away";
  }
  return { home, away, hidden: false, leader };
}

/** Blocks a started game keeps while scores are hidden: none of them tells how the game is going. */
const KEEP_WHEN_STARTED = new Set(["watch", "broadcast", "lineup", "next"]);

function redactSide(side, started) {
  if (!side) return side;
  return { ...side, score: null, record: started ? null : side.record ?? null, form: started ? null : side.form ?? null };
}

/** A game-detail payload with every spoiler removed. Upcoming games keep their blocks: nothing to spoil yet. */
export function redactGameDetail(detail) {
  const started = detail?.state === "live" || detail?.state === "final";
  const header = detail?.header || {};
  const redactedHeader = header.kind === "teams"
    ? { ...header, home: redactSide(header.home, started), away: redactSide(header.away, started) }
    : header.kind === "versus"
      ? { ...header, a: redactSide(header.a, started), b: redactSide(header.b, started) }
      : header;
  return {
    ...detail,
    header: redactedHeader,
    blocks: started ? (detail.blocks || []).filter(block => KEEP_WHEN_STARTED.has(block?.type)) : [...(detail.blocks || [])],
    spoilerRedacted: true
  };
}
