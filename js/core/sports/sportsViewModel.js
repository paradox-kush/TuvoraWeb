// Pure view-model for the Sports hub: repository state + clock in, plain card data out.
// The screen renders these; nothing here touches the DOM or the network.
import { displayTitle, fixtureKey, hasTeams, isDateOnly, isUpcomingWindow, roundLabel, startMs } from "./sportsFixtures.js";
import { badgeProgress, gameState } from "./liveStatus.js";
import { scoreSlots } from "./scoreSpoiler.js";
import { collectFixtures, dayKeyFor, groupByDay, localDayOf } from "./sportsCalendar.js";

/**
 * @typedef {Object} SportsCard
 * @property {string} key            fixtureKey: the route param for the game page
 * @property {string} state          "live" | "final" | "upcoming" | "postponed"
 * @property {string} title          "Arsenal v Chelsea" or the event name
 * @property {boolean} twoSided      home/away present (else an event: race, fight card, tournament day)
 * @property {{name:string, badge:string|null, score:string|null}} home
 * @property {{name:string, badge:string|null, score:string|null}} away
 * @property {string|null} leader    "home" | "away" | null (never set while scores are hidden)
 * @property {boolean} scoreHidden   Hide scores is covering this card's score
 * @property {string|null} progress  feed minute for "LIVE 67'" (null for period sports)
 * @property {number|null} kickoffMs
 * @property {boolean} dateOnly      no kick-off time, the whole day (tennis/golf/cycling)
 * @property {string} day            "YYYY-MM-DD" local
 * @property {string} leagueId
 * @property {string} league
 * @property {string|null} leagueBadge
 * @property {string} sport
 * @property {string|null} round
 * @property {string|null} venue
 */

const safeUrl = value => (/^https:\/\//i.test(String(value || "")) ? String(value) : null);

export function buildCard(fixture, ctx) {
  const { liveState, nowMs, spoiler, leagueById, timeZone } = ctx;
  const state = gameState(fixture, liveState, nowMs);
  const liveScore = fixture?.id != null ? liveState?.liveScores?.get?.(String(fixture.id)) : null;
  const slots = scoreSlots(spoiler, fixture, liveScore, state);
  const league = leagueById?.(fixture.leagueId) || null;
  return {
    key: fixtureKey(fixture),
    state,
    title: displayTitle(fixture),
    twoSided: hasTeams(fixture),
    home: { name: String(fixture.home || ""), badge: safeUrl(fixture.homeBadge), score: slots.home },
    away: { name: String(fixture.away || ""), badge: safeUrl(fixture.awayBadge), score: slots.away },
    leader: slots.leader,
    scoreHidden: slots.hidden,
    progress: state === "live" ? badgeProgress(fixture.sport, liveScore?.progress) : null,
    kickoffMs: startMs(fixture),
    dateOnly: isDateOnly(fixture),
    day: dayKeyFor(fixture, timeZone),
    leagueId: String(fixture.leagueId || ""),
    league: String(fixture.league || league?.name || ""),
    leagueBadge: safeUrl(fixture.leagueBadge || league?.badge),
    sport: String(fixture.sport || league?.sport || ""),
    round: roundLabel(fixture),
    venue: fixture.venue ? String(fixture.venue) : null
  };
}

/**
 * The hub's sections from everything followed.
 * -> { live: SportsCard[], next: SportsCard[], results: SportsCard[], days: [{ day, cards, liveCount }], today }
 *  - live:    in play now
 *  - next:    upcoming within the next 7 days, soonest first (capped)
 *  - results: finished in the last 7 days, most recent first (capped)
 *  - days:    every fixture by local day, for the calendar
 */
export function buildHub(state, ctx) {
  const fixtures = collectFixtures(state);
  const cards = fixtures.map(f => ({ fixture: f, card: buildCard(f, ctx) })).filter(({ card }) => card.title && card.day);
  const { nowMs } = ctx;
  const WEEK = 7 * 86_400_000;
  const live = cards.filter(({ card }) => card.state === "live").map(({ card }) => card)
    .sort((a, b) => (a.kickoffMs ?? 0) - (b.kickoffMs ?? 0));
  const next = cards
    .filter(({ fixture, card }) => card.state === "upcoming" && isUpcomingWindow(fixture, nowMs) && (card.kickoffMs ?? Infinity) < nowMs + WEEK)
    .map(({ card }) => card)
    .sort((a, b) => (a.kickoffMs ?? 0) - (b.kickoffMs ?? 0))
    .slice(0, ctx.nextCap ?? 24);
  const results = cards
    .filter(({ card }) => card.state === "final" && (card.kickoffMs ?? 0) > nowMs - WEEK)
    .map(({ card }) => card)
    .sort((a, b) => (b.kickoffMs ?? 0) - (a.kickoffMs ?? 0))
    .slice(0, ctx.resultsCap ?? 24);
  const byKey = new Map(cards.map(({ fixture, card }) => [fixtureKey(fixture), card]));
  const days = groupByDay(fixtures, ctx.timeZone).map(({ day, fixtures: list }) => {
    const dayCards = list.map(f => byKey.get(fixtureKey(f))).filter(Boolean);
    return { day, cards: dayCards, liveCount: dayCards.filter(c => c.state === "live").length };
  });
  return { live, next, results, days, today: localDayOf(nowMs, ctx.timeZone) };
}
