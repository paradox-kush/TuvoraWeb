// Sports Centre hub. Thin: state + lifecycle here, decisions in js/core/sports, markup in sportsViews.
// Network work runs only while this screen is mounted AND the tab is visible, on the hubTick policy
// (full refresh <= every 15 min, live-only tick every 2 min, no request on an idle slate).
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { getSidebarProfileState } from "../../components/sidebarNavigation.js";
import { bindDesktopNavigationEvents, renderDesktopNavigation } from "../../components/desktopNavigation.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { sportsRepository } from "../../../data/repository/sportsRepository.js";
import { withDeadline } from "../../../core/sports/boundedLoad.js";
import { hubTick } from "../../../core/sports/sportsRefreshPolicy.js";
import { liveStateFromResponse, mergeLiveState } from "../../../core/sports/liveStatus.js";
import { LIVESCORE_SPORTS } from "../../../core/sports/sportsFixtures.js";
import { buildHub } from "../../../core/sports/sportsViewModel.js";
import { localDayOf } from "../../../core/sports/sportsCalendar.js";
import { sportsSessionFor } from "./sportsSession.js";
import { renderSportsHub } from "./sportsViews.js";

const FOLLOWS_DEADLINE_MS = 10_000;
const FIXTURES_DEADLINE_MS = 20_000;
const CATALOG_DEADLINE_MS = 10_000;
const WRITE_DEADLINE_MS = 10_000;
const CLOCK_RERENDER_MS = 30_000;
const TABS = new Set(["today", "calendar", "following"]);

const errorText = error => (error?.name === "LoadTimeoutError"
  ? "The sports service took too long to answer."
  : (navigator.onLine === false ? "You're offline." : "Couldn't reach the sports service."));

export const SportsScreen = {
  async mount(params = {}, context = {}) {
    const generation = this.generation = (this.generation || 0) + 1;
    this.container = document.getElementById("sports");
    ScreenUtils.show(this.container);
    this.signedIn = AuthManager.isAuthenticated;
    this.profileId = String(ProfileManager.getActiveProfileId() || "1");
    this.authGeneration = AuthManager.getSessionGeneration();
    this.session = sportsSessionFor(`${this.signedIn ? "acct" : "local"}:${this.profileId}:${this.authGeneration}`);
    const restored = context.restoredState || {};
    this.tab = TABS.has(restored.tab) ? restored.tab : TABS.has(params.tab) ? params.tab : "today";
    this.selectedDay = restored.selectedDay || localDayOf(Date.now());
    this.status = this.session.follows ? "ready" : "loading";
    this.errorMessage = null;
    this.refreshError = null;
    this.refreshing = false;
    this.pendingLeague = null;
    this.active = true;
    const profile = await getSidebarProfileState().catch(() => null);
    if (generation !== this.generation) return;
    this.container.innerHTML = `
      <div class="sports-screen">
        ${renderDesktopNavigation({ selectedRoute: "sports", profile })}
        <main class="sports-main" id="main-content"></main>
      </div>`;
    bindDesktopNavigationEvents(this.container);
    this.main = this.container.querySelector(".sports-main");
    this.container.onclick = event => this.onClick(event);
    this.container.addEventListener("error", dropBrokenImage, true);
    this.scrollDayIntoView = true;
    this.onVisibility = () => (document.hidden ? this.clearTimers() : this.tick());
    document.addEventListener("visibilitychange", this.onVisibility);
    this.render();
    void this.start(generation);
  },

  getRouteStateKey() { return "sports"; },
  captureRouteState() { return { tab: this.tab, selectedDay: this.selectedDay }; },

  isCurrent(generation) {
    return this.active && generation === this.generation
      && this.profileId === String(ProfileManager.getActiveProfileId() || "1")
      && this.authGeneration === AuthManager.getSessionGeneration();
  },

  async start(generation) {
    if (!this.session.catalog) this.session.catalog = sportsRepository.cachedCatalog();
    void withDeadline(signal => sportsRepository.refreshCatalog(signal), CATALOG_DEADLINE_MS)
      .then(catalog => { if (this.isCurrent(generation)) { this.session.catalog = catalog; this.render(); } })
      .catch(() => { /* the cached/bundled catalog stays; only the picker uses it */ });
    if (!this.session.follows) {
      try {
        this.session.follows = await withDeadline(() => sportsRepository.loadFollows({ profileId: this.profileId, signedIn: this.signedIn }), FOLLOWS_DEADLINE_MS);
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        this.status = "failed";
        this.errorMessage = `${errorText(error)} Your followed leagues couldn't be loaded.`;
        this.render();
        return;
      }
      if (!this.isCurrent(generation)) return;
    }
    this.status = this.followedLeagueIds().length || this.followedTeamIds().length ? (this.session.lastFullAtMs ? "ready" : "loading") : "noFollows";
    if (this.status === "noFollows" && this.tab === "today") this.tab = "following";
    this.render();
    this.tick();
  },

  followedLeagueIds() { return (this.session.follows?.leagues || []).map(row => String(row.league_id)); },
  followedTeamIds() { return (this.session.follows?.teams || []).map(row => String(row.team_id)); },

  leagueById(id) {
    for (const category of this.session.catalog?.categories || []) {
      const hit = (category.leagues || []).find(league => String(league.id) === String(id));
      if (hit) return hit;
    }
    const row = (this.session.follows?.leagues || []).find(r => String(r.league_id) === String(id));
    return row ? { id: String(row.league_id), name: row.name || "", badge: row.badge || null, sport: row.sport || "" } : null;
  },

  livescoreSports(leagueIds, teamIds) {
    const sports = [
      ...leagueIds.map(id => this.leagueById(id)?.sport),
      ...(this.session.follows?.teams || []).filter(t => teamIds.includes(String(t.team_id))).map(t => t.sport)
    ].map(s => String(s || "").toLowerCase()).filter(s => LIVESCORE_SPORTS.has(s));
    return [...new Set(sports)];
  },

  /** One policy-driven step; schedules the next. No-op when hidden, unmounted or nothing is followed. */
  tick(force = false) {
    this.clearTimers();
    if (!this.active || document.hidden || !this.session.follows || this.refreshing) return;
    const s = this.session;
    const decision = hubTick({
      leagueIds: this.followedLeagueIds(), teamIds: this.followedTeamIds(),
      fixturesByLeague: s.fixturesByLeague, fixturesByTeam: s.fixturesByTeam, nowMs: Date.now(),
      lastFullAtMs: force ? null : s.lastFullAtMs, lastLiveAtMs: s.lastLiveAtMs
    });
    if (decision.kind === "none") {
      this.render();
      this.schedule(decision.nextCheckInMs);
      return;
    }
    void this.fetch(decision.kind, decision.targets);
  },

  schedule(ms) {
    if (!this.active || document.hidden) return;
    if (ms != null) this.tickTimer = setTimeout(() => this.tick(), Math.max(1000, ms));
    this.clockTimer = setTimeout(() => { this.render(); this.clockTimer = null; }, CLOCK_RERENDER_MS);
  },

  clearTimers() {
    clearTimeout(this.tickTimer);
    clearTimeout(this.clockTimer);
    this.tickTimer = null;
    this.clockTimer = null;
  },

  async fetch(kind, targets) {
    const generation = this.generation;
    const s = this.session;
    this.refreshing = true;
    this.render();
    const request = {
      leagueIds: targets.leagueIds, teamIds: targets.teamIds,
      livescoreSports: this.livescoreSports(targets.leagueIds, targets.teamIds)
    };
    try {
      const response = await withDeadline(signal => sportsRepository.fetchFixtures(request, signal), FIXTURES_DEADLINE_MS);
      if (!this.isCurrent(generation)) return;
      const nowMs = Date.now();
      // Merge, so leagues a partial response skipped keep their fixtures.
      s.fixturesByLeague = { ...s.fixturesByLeague, ...response.fixtures };
      s.fixturesByTeam = { ...s.fixturesByTeam, ...response.teamFixtures };
      const live = liveStateFromResponse(response);
      if (kind === "full") { s.liveState = live; s.lastFullAtMs = nowMs; } else { s.liveState = mergeLiveState(s.liveState, live); }
      s.lastLiveAtMs = nowMs;
      this.status = "ready";
      this.refreshError = null;
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (s.lastFullAtMs) {
        this.refreshError = `${errorText(error)} Showing what was loaded ${minutesAgo(s.lastLiveAtMs || s.lastFullAtMs)}.`;
      } else {
        this.status = "failed";
        this.errorMessage = `${errorText(error)} Games couldn't be loaded.`;
      }
      // No retry loop: the user retries, or the next scheduled live/full tick tries again.
      s.lastLiveAtMs = Date.now();
    } finally {
      if (this.isCurrent(generation)) {
        this.refreshing = false;
        this.render();
        if (this.status !== "failed") this.schedule(hubTick({
          leagueIds: this.followedLeagueIds(), teamIds: this.followedTeamIds(),
          fixturesByLeague: s.fixturesByLeague, fixturesByTeam: s.fixturesByTeam, nowMs: Date.now(),
          lastFullAtMs: s.lastFullAtMs, lastLiveAtMs: s.lastLiveAtMs
        }).nextCheckInMs);
      }
    }
  },

  spoiler() {
    return { scoresShown: this.session.follows?.prefs?.scores_shown !== false, revealed: this.session.revealed };
  },

  viewModel() {
    const s = this.session;
    const nowMs = Date.now();
    const ready = this.status === "ready";
    const followedLeagueIds = new Set(this.followedLeagueIds());
    return {
      status: this.status,
      errorMessage: this.errorMessage,
      refreshing: this.refreshing,
      refreshError: this.refreshError,
      scoresShown: this.spoiler().scoresShown,
      signedIn: this.signedIn,
      tab: this.tab,
      hub: ready ? buildHub({
        leagueIds: [...followedLeagueIds], teamIds: this.followedTeamIds(),
        fixturesByLeague: s.fixturesByLeague, fixturesByTeam: s.fixturesByTeam
      }, { liveState: s.liveState, nowMs, spoiler: this.spoiler(), leagueById: id => this.leagueById(id) }) : null,
      selectedDay: this.selectedDay,
      leagues: [...followedLeagueIds].map(id => this.leagueById(id) || { id, name: `League ${id}`, badge: null, sport: "" }),
      teams: (s.follows?.teams || []).map(t => ({ id: String(t.team_id), name: t.name || "", badge: /^https:/.test(t.badge || "") ? t.badge : null, league: t.league || "" })),
      catalog: s.catalog?.categories || [],
      followedLeagueIds,
      pendingLeagueId: this.pendingLeague,
      canEditFollows: Boolean(s.follows),
      updatedAtMs: s.lastLiveAtMs || s.lastFullAtMs,
      nowMs,
      timeZone: undefined
    };
  },

  render() {
    if (!this.main) return;
    const active = document.activeElement;
    const focusSelector = active && this.main.contains(active) ? focusKeyOf(active) : null;
    const strip = this.main.querySelector(".sports-day-strip, [data-sports-strip]");
    const stripScroll = strip ? strip.scrollLeft : null;
    this.main.innerHTML = renderSportsHub(this.viewModel());
    const nextStrip = this.main.querySelector(".sports-day-strip, [data-sports-strip]");
    if (nextStrip && stripScroll != null && !this.scrollDayIntoView) nextStrip.scrollLeft = stripScroll;
    else if (nextStrip) {
      const selected = nextStrip.querySelector(".is-selected");
      if (selected) nextStrip.scrollLeft = selected.offsetLeft - (nextStrip.clientWidth - selected.offsetWidth) / 2;
    }
    this.scrollDayIntoView = false;
    if (focusSelector) this.main.querySelector(focusSelector)?.focus({ preventScroll: true });
  },

  async onClick(event) {
    const target = event.target.closest("[data-sports-action]");
    if (!target || !this.main?.contains(target) || target.disabled || target.getAttribute("aria-disabled") === "true") return;
    const action = target.dataset.sportsAction;
    if (action === "retry") {
      this.status = "loading";
      this.errorMessage = null;
      this.render();
      if (!this.session.follows) void this.start(this.generation); else this.tick(true);
    } else if (action === "refresh") {
      this.tick(true);
    } else if (action === "tab" && TABS.has(target.dataset.tab)) {
      this.tab = target.dataset.tab;
      this.scrollDayIntoView = true;
      this.render();
    } else if (action === "select-day" && target.dataset.day) {
      this.selectedDay = target.dataset.day;
      this.render();
    } else if (action === "open-game" && target.dataset.key) {
      void Router.navigate("sportsGame", { key: target.dataset.key, leagueId: target.dataset.league || "" });
    } else if (action === "toggle-scores") {
      await this.write(() => sportsRepository.setScoresShown({ profileId: this.profileId, signedIn: this.signedIn, shown: !this.spoiler().scoresShown }), "Couldn't change Hide scores.");
    } else if (action === "follow-league" && target.dataset.league) {
      const league = this.leagueById(target.dataset.league);
      if (!league) return;
      const followed = !this.followedLeagueIds().includes(String(league.id));
      this.pendingLeague = String(league.id);
      await this.write(() => sportsRepository.setLeagueFollowed({ profileId: this.profileId, signedIn: this.signedIn, league, followed }), "Couldn't update what you follow.");
      this.pendingLeague = null;
      if (followed && this.status === "noFollows") this.status = "loading";
      if (!this.followedLeagueIds().length && !this.followedTeamIds().length) this.status = "noFollows";
      this.render();
      this.tick(true);
    }
  },

  async write(work, failureText) {
    const generation = this.generation;
    this.render();
    try {
      const follows = await withDeadline(work, WRITE_DEADLINE_MS);
      if (!this.isCurrent(generation)) return;
      this.session.follows = follows;
      this.refreshError = null;
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.refreshError = `${failureText} ${errorText(error)}`;
    }
    this.render();
  },

  onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); void Router.back(); }
  },

  cleanup() {
    this.active = false;
    this.generation = (this.generation || 0) + 1;
    this.clearTimers();
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.container) {
      this.container.onclick = null;
      this.container.removeEventListener("error", dropBrokenImage, true);
    }
    this.main = null;
    ScreenUtils.hide(this.container);
  }
};

/** A crest that fails to load is removed; the view then shows the team's initials. */
export function dropBrokenImage(event) {
  if (event.target?.matches?.(".sports-main img")) event.target.remove();
}

function minutesAgo(ms) {
  const minutes = Math.round((Date.now() - (ms || Date.now())) / 60_000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

/** A selector that finds the same control after a re-render, so keyboard focus survives refreshes. */
function focusKeyOf(element) {
  const control = element.closest("[data-sports-action]");
  if (!control) return null;
  const parts = [`[data-sports-action="${control.dataset.sportsAction}"]`];
  ["tab", "day", "key", "league"].forEach(name => {
    if (control.dataset[name]) parts.push(`[data-${name}="${CSS.escape(control.dataset[name])}"]`);
  });
  return parts.join("");
}
