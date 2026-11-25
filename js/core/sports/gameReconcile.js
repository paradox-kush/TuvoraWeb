// The backend game-detail (TheSportsDB) can lag the livescore feed by a long way: an NBA game in
// Q2 an hour after tip-off still read "upcoming" with no score (seen 2026-11-25). The native apps
// cover this with an ESPN overlay (phase 2 on the web); until then the game page trusts the hub's
// fresher verdict when it says more than the detail does. Pure, never mutates the payload.

const RANK = { upcoming: 0, live: 1, final: 2, postponed: 2 };

export function reconcileGame(detail, card) {
  if (!detail || !card || !(card.state in RANK)) return detail;
  if ((RANK[card.state] ?? 0) <= (RANK[detail.state] ?? 0)) return detail;
  const header = detail.header?.kind === "teams"
    ? {
      ...detail.header,
      home: { ...detail.header.home, score: detail.header.home?.score ?? card.home?.score ?? null },
      away: { ...detail.header.away, score: detail.header.away?.score ?? card.away?.score ?? null }
    }
    : detail.header;
  const live = card.state === "live"
    ? { ...(detail.live || {}), periodLabel: detail.live?.periodLabel ?? card.progress ?? null }
    : detail.live;
  return { ...detail, state: card.state, header, live, reconciledFromFeed: true };
}
