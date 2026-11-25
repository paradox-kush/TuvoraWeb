// One game. The card from the hub draws instantly; the backend game-detail fills it in. Refreshes
// follow planGameRefresh (live 30 s, pre-kick-off window, final = no requests) and run only while
// this page is mounted and the tab is visible.
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { getSidebarProfileState } from "../../components/sidebarNavigation.js";
import { paintThenFillProfile, replaceNavigation } from "./profileChip.js";
import { bindDesktopNavigationEvents, renderDesktopNavigation } from "../../components/desktopNavigation.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { sportsRepository } from "../../../data/repository/sportsRepository.js";
import { withDeadline } from "../../../core/sports/boundedLoad.js";
import { planGameRefresh } from "../../../core/sports/gameRefreshPolicy.js";
import { isScoreHidden, redactGameDetail } from "../../../core/sports/scoreSpoiler.js";
import { buildCard } from "../../../core/sports/sportsViewModel.js";
import { reconcileGame } from "../../../core/sports/gameReconcile.js";
import { liveStateFromResponse, mergeLiveState } from "../../../core/sports/liveStatus.js";
import { LIVESCORE_SPORTS } from "../../../core/sports/sportsFixtures.js";
import { LIVE_TICK_MS } from "../../../core/sports/sportsRefreshPolicy.js";
import { findFixture, sportsSessionFor } from "./sportsSession.js";
import { renderSportsGame } from "./sportsViews.js";
import { dropBrokenImage } from "./sportsScreen.js";

const DETAIL_DEADLINE_MS = 15_000;

export const SportsGameScreen = {
  mount(params = {}) {
    const generation = this.generation = (this.generation || 0) + 1;
    this.container = document.getElementById("sportsGame");
    ScreenUtils.show(this.container);
    const signedIn = AuthManager.isAuthenticated;
    this.profileId = String(ProfileManager.getActiveProfileId() || "1");
    this.session = sportsSessionFor(`${signedIn ? "acct" : "local"}:${this.profileId}:${AuthManager.getSessionGeneration()}`);
    this.key = String(params.key || "");
    this.leagueId = String(params.leagueId || "");
    this.eventId = /^\d+$/.test(this.key) ? this.key : null;
    this.detail = null;
    this.status = this.eventId ? "loading" : "unavailable";
    this.errorMessage = null;
    this.lastFetchMs = null;
    this.failures = 0;
    this.active = true;
    // First paint never waits on the profile chip (it can sit behind Home's requests for ~40 s):
    // the shell goes up now with the fallback chip and the real one fills in when it arrives.
    void paintThenFillProfile({
      paint: profile => {
        this.container.innerHTML = `
          <div class="sports-game-screen">
            ${renderDesktopNavigation({ selectedRoute: "sports", profile })}
            <main class="sports-main" id="main-content"></main>
          </div>`;
        bindDesktopNavigationEvents(this.container);
      },
      loadProfile: () => getSidebarProfileState(),
      fill: profile => replaceNavigation(this.container, renderDesktopNavigation({ selectedRoute: "sports", profile }), bindDesktopNavigationEvents),
      isCurrent: () => this.active && generation === this.generation
    });
    this.main = this.container.querySelector(".sports-main");
    this.container.onclick = event => this.onClick(event);
    this.container.addEventListener("error", dropBrokenImage, true);
    this.onVisibility = () => {
      if (document.hidden) { clearTimeout(this.timer); clearTimeout(this.feedTimer); } else { this.tick(); this.scheduleFeed(); }
    };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.render();
    this.tick();
  },

  card(nowMs = Date.now(), spoiler = this.spoiler()) {
    const fixture = findFixture(this.key);
    if (!fixture) return null;
    return buildCard(fixture, { liveState: this.session.liveState, nowMs, spoiler, leagueById: () => null });
  },

  /** The detail with the hub's fresher live verdict folded in (never redacted here). */
  game(nowMs = Date.now()) {
    return reconcileGame(this.detail, this.card(nowMs, { scoresShown: true, revealed: new Set() }));
  },

  spoiler() {
    return { scoresShown: this.session.follows?.prefs?.scores_shown !== false, revealed: this.session.revealed };
  },

  gameState() {
    return this.game()?.state || this.card()?.state || "upcoming";
  },

  startsAtMs() {
    const fromDetail = Date.parse(this.detail?.startsAt || "");
    return Number.isFinite(fromDetail) ? fromDetail : this.card()?.kickoffMs ?? NaN;
  },

  tick() {
    clearTimeout(this.timer);
    if (!this.active || document.hidden || !this.eventId || this.status === "unavailable") return;
    const plan = planGameRefresh({
      state: this.gameState(), startsAtMs: this.startsAtMs(), nowMs: Date.now(),
      lastFetchMs: this.lastFetchMs, consecutiveFailures: this.failures
    });
    if (plan.fetch || this.lastFetchMs == null) void this.load();
    else if (plan.nextCheckInMs != null) this.timer = setTimeout(() => this.tick(), Math.max(1000, plan.nextCheckInMs));
  },

  /**
   * While the page's state comes from the livescore feed (the detail lags), refresh that feed for this
   * one league every LIVE_TICK_MS: the hub's live lane, narrowed to one league. Stops when the detail
   * catches up, the game ends, the page closes or the tab hides.
   */
  scheduleFeed() {
    clearTimeout(this.feedTimer);
    const game = this.game();
    if (!this.active || document.hidden || !game?.reconciledFromFeed || game.state !== "live") return;
    this.feedTimer = setTimeout(() => void this.refreshFeed(), LIVE_TICK_MS);
  },

  async refreshFeed() {
    const generation = this.generation;
    const fixture = findFixture(this.key);
    const sport = String(fixture?.sport || "").toLowerCase();
    if (!fixture?.leagueId) return;
    try {
      const response = await withDeadline(signal => sportsRepository.fetchFixtures({
        leagueIds: [String(fixture.leagueId)], teamIds: [], livescoreSports: LIVESCORE_SPORTS.has(sport) ? [sport] : []
      }, signal), DETAIL_DEADLINE_MS);
      if (!this.isCurrent(generation)) return;
      this.session.fixturesByLeague = { ...this.session.fixturesByLeague, ...response.fixtures };
      this.session.liveState = mergeLiveState(this.session.liveState, liveStateFromResponse(response));
      this.render();
    } catch (_) {
      // Keep the last score on screen; the next feed tick tries again.
    }
    if (this.isCurrent(generation)) this.scheduleFeed();
  },

  async load() {
    const generation = this.generation;
    this.lastFetchMs = Date.now();
    try {
      const result = await withDeadline(signal => sportsRepository.fetchGameDetail(this.eventId, this.leagueId, signal), DETAIL_DEADLINE_MS);
      if (!this.isCurrent(generation)) return;
      this.failures = 0;
      if (result.status === "ok") {
        this.detail = result.detail;
        this.status = "ready";
      } else {
        this.status = "unavailable";
      }
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.failures += 1;
      if (!this.detail) {
        this.status = "failed";
        this.errorMessage = error?.name === "LoadTimeoutError" ? "Game details took too long to load." : "Couldn't load game details.";
      }
    }
    this.render();
    this.scheduleFeed();
    // A failed first load waits for Retry (never a timer loop); a live page keeps its cadence with back-off.
    if (this.status === "ready") this.tick();
  },

  isCurrent(generation) {
    return this.active && generation === this.generation;
  },

  render() {
    if (!this.main) return;
    const nowMs = Date.now();
    const hidden = isScoreHidden(this.spoiler(), this.key);
    const state = this.gameState();
    const started = state === "live" || state === "final";
    const focusAction = document.activeElement?.closest?.("[data-sports-action]")?.dataset?.sportsAction;
    this.main.innerHTML = renderSportsGame({
      status: this.status,
      errorMessage: this.errorMessage,
      card: this.card(nowMs),
      detail: this.detail && hidden ? redactGameDetail(this.game(nowMs)) : this.game(nowMs),
      scoreHidden: hidden && started,
      revealable: hidden && started,
      revealedHere: this.session.revealed.has(this.key) && this.spoiler().scoresShown === false && started,
      updatedAtMs: this.lastFetchMs,
      nowMs
    });
    if (focusAction) this.main.querySelector(`[data-sports-action="${focusAction}"]`)?.focus({ preventScroll: true });
  },

  onClick(event) {
    const target = event.target.closest("[data-sports-action]");
    if (!target || !this.main?.contains(target) || target.disabled || target.getAttribute("aria-disabled") === "true") return;
    const action = target.dataset.sportsAction;
    if (action === "back") {
      if (!Router.backToPreviousNuvioRoute("sports").accepted) void Router.navigate("sports", {}, { replaceHistory: true });
    } else if (action === "retry") {
      this.status = "loading";
      this.failures = 0;
      this.render();
      void this.load();
    } else if (action === "reveal") {
      this.session.revealed.add(this.key);
      this.render();
    } else if (action === "hide-again") {
      this.session.revealed.delete(this.key);
      this.render();
    }
  },

  onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); void Router.back(); }
  },

  cleanup() {
    this.active = false;
    this.generation = (this.generation || 0) + 1;
    clearTimeout(this.timer);
    clearTimeout(this.feedTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.container) {
      this.container.onclick = null;
      this.container.removeEventListener("error", dropBrokenImage, true);
    }
    this.main = null;
    this.detail = null;
    ScreenUtils.hide(this.container);
  }
};
