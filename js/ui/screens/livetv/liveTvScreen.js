// Live TV: the synced IPTV playlists this browser can reach, said honestly per playlist.
// This file is the state holder: it runs the bounded loads and wires events. What a playlist
// can do, what to list, what to fetch and the words for each state all come from the pure
// modules in js/core/iptv; markup comes from liveTvView.js. Playback is handed to the player,
// which owns its own fallback when the browser refuses a stream.
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { getSidebarProfileState } from "../../components/sidebarNavigation.js";
import { bindDesktopNavigationEvents, renderDesktopNavigation } from "../../components/desktopNavigation.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { fetchPlaylistChannels, fetchSyncedPlaylists, fetchXtreamNowNext } from "../../../core/iptv/iptvRepository.js";
import { LiveDeadlines, runBoundedLoad } from "../../../core/iptv/boundedLoad.js";
import { PlaylistAccess, channelPlayback, classifyPlaylistAccess, summarizePlaylistStatus } from "../../../core/iptv/iptvSourceCapability.js";
import { liveContentId } from "../../../core/iptv/iptvPlaylists.js";
import { nowNext, planNowNextFetch } from "../../../core/iptv/liveGuide.js";
import { createLiveFavourites } from "../../../core/iptv/liveFavourites.js";
import { createLiveSelectionMemory } from "../../../core/iptv/liveSelectionMemory.js";
import {
  GroupId, buildGroupRail, filterChannels, nextWindow, resolveGroup, resolvePlaylist, rowNeighbour, withChannelNumbers
} from "../../../core/iptv/liveChannelBrowser.js";
import * as View from "./liveTvView.js";

const Phase = Object.freeze({
  SignedOut: "signed-out",
  Loading: "loading",
  Failed: "failed",
  NoPlaylists: "no-playlists",
  Ready: "ready"
});

export const LiveTvScreen = {
  async mount(_params = {}, context = {}) {
    this.dispose();
    const generation = this.generation = (this.generation || 0) + 1;
    this.container = document.getElementById("liveTv");
    ScreenUtils.show(this.container);
    this.profileId = ProfileManager.getActiveProfileId();
    this.sessionGeneration = AuthManager.getSessionGeneration();
    this.pageProtocol = String(globalThis.location?.protocol || "https:");
    this.favourites = createLiveFavourites({ profileId: this.profileId });
    this.memory = createLiveSelectionMemory({ profileId: this.profileId });
    this.screenAbort = new AbortController();
    this.phase = Phase.Loading;
    this.playlists = [];
    this.access = [];
    this.loads = [];
    this.guides = [];
    this.selected = -1;
    this.groupId = GroupId.All;
    this.rail = [];
    this.query = String(context.restoredState?.query || "");
    this.filtered = [];
    this.rendered = 0;
    this.visibleRows = new Set();
    const profile = await getSidebarProfileState().catch(() => null);
    if (generation !== this.generation) return;
    this.container.innerHTML = `
      <div class="live-tv-screen">
        ${renderDesktopNavigation({ selectedRoute: "liveTv", profile })}
        <main class="live-tv-main">
          <header class="live-tv-heading">
            <h1>Live TV</h1>
            <p>Channels from the playlists on your Tuvora account.</p>
          </header>
          <div class="live-tv-playlists" role="tablist" aria-label="Playlists" hidden></div>
          <div class="live-tv-body"></div>
        </main>
      </div>`;
    bindDesktopNavigationEvents(this.container);
    this.container.onclick = (event) => this.onClick(event);
    this.container.onkeydown = (event) => this.onListKeyDown(event);
    this.container.oninput = (event) => this.onInput(event);
    this.container.addEventListener("error", this.onImageError, true);
    this.onVisibility = () => this.onVisibilityChange();
    document.addEventListener("visibilitychange", this.onVisibility);
    // The router covers this screen with the player by making it inert: that is "not visible".
    this.inertObserver = new MutationObserver(() => this.onVisibilityChange());
    this.inertObserver.observe(this.container, { attributes: true, attributeFilter: ["inert"] });
    if (!AuthManager.isAuthenticated) {
      this.phase = Phase.SignedOut;
      this.render();
      return;
    }
    void this.loadPlaylists();
  },

  getRouteStateKey() { return "liveTv"; },
  captureRouteState() { return { query: this.query || "" }; },
  onImageError(event) { if (event.target.matches?.(".live-tv-logo img")) event.target.remove(); },

  isCurrent(generation) {
    return generation === this.generation
      && this.profileId === ProfileManager.getActiveProfileId()
      && this.sessionGeneration === AuthManager.getSessionGeneration();
  },

  isVisible() {
    return Boolean(this.container?.isConnected) && !this.container.inert && document.visibilityState === "visible";
  },

  // ---- loads (every one bounded: Loaded, Empty or Failed) ----

  async loadPlaylists() {
    const generation = this.generation;
    this.phase = Phase.Loading;
    this.render();
    const result = await runBoundedLoad(() => fetchSyncedPlaylists(), {
      deadlineMs: LiveDeadlines.Playlists,
      signal: this.screenAbort.signal
    });
    if (!this.isCurrent(generation) || this.screenAbort.signal.aborted) return;
    if (result.state === "failed") {
      this.phase = Phase.Failed;
    } else if (result.state === "empty") {
      this.phase = Phase.NoPlaylists;
    } else {
      this.phase = Phase.Ready;
      this.playlists = result.value;
      this.access = this.playlists.map((playlist) => classifyPlaylistAccess(playlist, this.pageProtocol));
      this.loads = this.playlists.map(() => null);
      this.guides = this.playlists.map(() => new Map());
      const id = resolvePlaylist(this.playlists, this.memory.pickPlaylist(this.playlists));
      this.selected = this.playlists.findIndex((playlist) => playlist.id === id);
    }
    this.render();
    if (this.phase === Phase.Ready) void this.loadChannels(this.selected);
  },

  async loadChannels(index, { force = false } = {}) {
    const playlist = this.playlists[index];
    if (!playlist || this.access[index].access === PlaylistAccess.AppOnly) return;
    if (this.loads[index] && !force) return;
    const generation = this.generation;
    this.loads[index] = { state: "loading" };
    this.guides[index] = new Map();
    this.renderTabs();
    if (index === this.selected) this.renderBody();
    const result = await runBoundedLoad((signal) => fetchPlaylistChannels(playlist, signal), {
      deadlineMs: LiveDeadlines.Channels,
      signal: this.screenAbort.signal
    });
    if (!this.isCurrent(generation) || this.screenAbort.signal.aborted) return;
    this.loads[index] = result.state === "loaded"
      ? {
        state: "loaded",
        secureShare: result.value.secureShare,
        guide: result.value.guide,
        groups: result.value.groups,
        channels: withChannelNumbers(result.value.channels)
      }
      : { state: result.state, failure: result.failure };
    this.renderTabs();
    if (index === this.selected) this.renderBody();
  },

  /** Pull-to-refresh and the like: re-ask for what is on screen, once, because the viewer asked. */
  refresh() {
    if (this.phase === Phase.SignedOut) return undefined;
    if (this.phase !== Phase.Ready) return this.loadPlaylists();
    return this.loadChannels(this.selected, { force: true });
  },

  // ---- render ----

  statusOf(index) {
    return summarizePlaylistStatus({ access: this.access[index], load: this.loads[index] });
  },

  render() {
    this.renderTabs();
    this.renderBody();
  },

  renderTabs() {
    const tabs = this.container?.querySelector(".live-tv-playlists");
    if (!tabs) return;
    const refocus = tabs.contains(document.activeElement);
    tabs.hidden = this.phase !== Phase.Ready;
    tabs.innerHTML = this.phase === Phase.Ready
      ? View.playlistTabs(this.playlists, this.playlists.map((_, index) => this.statusOf(index)), this.selected)
      : "";
    const selected = tabs.querySelector('[aria-selected="true"]');
    if (refocus) selected?.focus({ preventScroll: true });
    // Keep the open playlist's tab in view in the strip without moving the page.
    if (selected) {
      const overRight = selected.offsetLeft + selected.offsetWidth - (tabs.scrollLeft + tabs.clientWidth);
      const overLeft = tabs.scrollLeft - selected.offsetLeft;
      if (overLeft > 0) tabs.scrollLeft -= overLeft + 8;
      else if (overRight > 0) tabs.scrollLeft += Math.min(overRight + 8, selected.offsetLeft - tabs.scrollLeft);
    }
  },

  renderBody() {
    const body = this.container?.querySelector(".live-tv-body");
    if (!body) return;
    this.stopGuide();
    this.listObserver?.disconnect();
    this.filtered = [];
    this.rendered = 0;
    if (this.phase === Phase.SignedOut) { body.innerHTML = View.signedOutCard(); return; }
    if (this.phase === Phase.Loading) { body.innerHTML = View.skeleton("Loading your playlists…"); return; }
    if (this.phase === Phase.Failed) { body.innerHTML = View.playlistsFailedCard(); return; }
    if (this.phase === Phase.NoPlaylists) { body.innerHTML = View.noPlaylistsCard(); return; }
    const access = this.access[this.selected];
    const load = this.loads[this.selected];
    if (access.access === PlaylistAccess.AppOnly) { body.innerHTML = View.appOnlyCard(access.reason); return; }
    if (!load || load.state === "loading") { body.innerHTML = View.skeleton("Loading channels…"); return; }
    if (load.state === "failed") { body.innerHTML = View.failedCard(load.failure); return; }
    if (load.state === "empty") { body.innerHTML = View.emptyPlaylistCard(); return; }
    const playlist = this.playlists[this.selected];
    this.rail = this.buildRail();
    this.groupId = resolveGroup(this.rail, this.memory.groupId(playlist.id));
    body.innerHTML = `
      <div class="live-tv-browser">
        <nav class="live-tv-groups" aria-label="Channel groups"></nav>
        <section class="live-tv-channels" aria-label="Channels">
          <div class="live-tv-toolbar">
            <label class="live-tv-search">
              <span class="material-icons" aria-hidden="true">search</span>
              <input type="search" data-live-search placeholder="Search this playlist" aria-label="Search channels on this playlist"
                autocomplete="off" spellcheck="false" enterkeyhint="search" value="${View.escapeHtml(this.query)}" />
            </label>
            <p class="live-tv-count" role="status" aria-live="polite"></p>
          </div>
          ${View.notice(this.statusOf(this.selected))}
          <p class="live-tv-guide-failed" hidden>
            <span>The guide didn't load for some channels.</span>
            <button type="button" class="live-tv-button" data-live-action="retry-guide">Retry guide</button>
          </p>
          <div class="live-tv-list" role="list"></div>
          <div class="live-tv-sentinel" aria-hidden="true"></div>
        </section>
      </div>`;
    this.startObservers(load);
    this.renderList();
  },

  buildRail() {
    const load = this.loads[this.selected];
    return buildGroupRail({ groups: load.groups, channels: load.channels, isFavourite: (channel) => this.isFavourite(channel) });
  },

  isFavourite(channel) {
    return this.favourites.has(liveContentId(this.playlists[this.selected].id, channel.id));
  },

  renderGroups() {
    const groups = this.container.querySelector(".live-tv-groups");
    if (!groups) return;
    const focused = groups.contains(document.activeElement) ? document.activeElement.dataset.liveGroup : null;
    groups.innerHTML = View.groupRail(this.rail, this.groupId, Boolean(this.query.trim()));
    if (focused !== null) groups.querySelector(`[data-live-group="${focused}"]`)?.focus({ preventScroll: true });
  },

  renderList() {
    const load = this.loads[this.selected];
    const list = this.container.querySelector(".live-tv-list");
    if (!list || load?.state !== "loaded") return;
    const searching = Boolean(this.query.trim());
    this.filtered = filterChannels({
      channels: load.channels,
      groupId: this.groupId,
      query: this.query,
      isFavourite: (channel) => this.isFavourite(channel)
    });
    this.rendered = 0;
    this.visibleRows.clear();
    this.rowObserver?.disconnect();
    list.innerHTML = this.filtered.length ? "" : View.listEmpty({ searching, favourites: this.groupId === GroupId.Favourites });
    const total = this.filtered.length;
    this.container.querySelector(".live-tv-count").textContent = searching
      ? `${total} ${total === 1 ? "match" : "matches"} on this playlist`
      : `${total} ${total === 1 ? "channel" : "channels"}`;
    this.renderGroups();
    this.appendWindow();
  },

  appendWindow() {
    const list = this.container?.querySelector(".live-tv-list");
    const to = nextWindow({ rendered: this.rendered, total: this.filtered.length });
    if (!list || to <= this.rendered) return false;
    const guide = this.guides[this.selected];
    list.insertAdjacentHTML("beforeend", View.channelRows({
      channels: this.filtered,
      from: this.rendered,
      to,
      isFavourite: (channel) => this.isFavourite(channel),
      playbackOf: (channel) => channelPlayback(channel.url, this.pageProtocol),
      guideOf: (channel) => guide.get(channel.id),
      pageProtocol: this.pageProtocol,
      nowMs: Date.now()
    }));
    if (this.rowObserver) {
      for (let index = this.rendered; index < to; index += 1) {
        const row = list.querySelector(`[data-live-row="${index}"]`);
        if (row) this.rowObserver.observe(row);
      }
    }
    this.rendered = to;
    return true;
  },

  startObservers(load) {
    const sentinel = this.container.querySelector(".live-tv-sentinel");
    // Long lists are drawn a window at a time: the next window when the end comes near.
    this.listObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) this.appendWindow();
    }, { rootMargin: "800px 0px" });
    this.listObserver.observe(sentinel);
    this.rowObserver = null;
    if (load.guide !== "xtream-short-epg") return;
    this.guideAbort = new AbortController();
    this.guideInFlight = 0;
    this.rowObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const index = Number(entry.target.dataset.liveRow);
        if (entry.isIntersecting) this.visibleRows.add(index);
        else this.visibleRows.delete(index);
      });
      this.planGuide();
    }, { rootMargin: "200px 0px" });
  },

  // ---- guide: only rows on screen, only when missing or over, one wake-up, never a poll ----

  planGuide() {
    clearTimeout(this.guideWake);
    this.guideWake = null;
    const load = this.loads[this.selected];
    if (!this.rowObserver || load?.state !== "loaded" || !this.isVisible() || this.guideInFlight > 0) return;
    const playlist = this.playlists[this.selected];
    const cache = this.guides[this.selected];
    const byId = new Map();
    [...this.visibleRows].sort((a, b) => a - b).forEach((index) => {
      const channel = this.filtered[index];
      if (channel) byId.set(channel.id, channel);
    });
    const nowMs = Date.now();
    const plan = planNowNextFetch({ visibleIds: [...byId.keys()], cache, nowMs });
    const signal = this.guideAbort.signal;
    const generation = this.generation;
    plan.fetch.forEach((id) => {
      const channel = byId.get(id);
      cache.set(id, { state: "loading" });
      this.guideInFlight += 1;
      runBoundedLoad((inner) => fetchXtreamNowNext(playlist, channel, inner), {
        deadlineMs: LiveDeadlines.NowNext,
        signal,
        isEmptyValue: () => false
      }).then((result) => {
        if (generation !== this.generation || signal.aborted) {
          if (cache.get(id)?.state === "loading") cache.delete(id);
          return;
        }
        this.guideInFlight -= 1;
        cache.set(id, result.state === "loaded"
          ? { state: "loaded", programmes: result.value.programmes, validUntilMs: result.value.validUntilMs }
          : { state: "failed" });
        this.renderGuideFor(id);
        if (this.guideInFlight === 0) this.planGuide();
      });
    });
    if (!plan.fetch.length && plan.wakeAtMs !== null) {
      // One timer to the earliest programme end among the rows on screen. It re-plans once.
      this.guideWake = setTimeout(() => {
        this.refreshVisibleGuide();
        this.planGuide();
      }, Math.max(1000, plan.wakeAtMs - nowMs));
    }
  },

  renderGuideFor(channelId) {
    const cache = this.guides[this.selected];
    const index = this.filtered.findIndex((channel) => channel.id === channelId);
    const slot = index >= 0 ? this.container.querySelector(`[data-live-row="${index}"] [data-live-guide]`) : null;
    if (slot) slot.innerHTML = View.guideMarkup(cache.get(channelId), Date.now());
    const failed = this.container.querySelector(".live-tv-guide-failed");
    if (failed) failed.hidden = ![...cache.values()].some((entry) => entry.state === "failed");
  },

  refreshVisibleGuide() {
    const cache = this.guides[this.selected];
    this.visibleRows.forEach((index) => {
      const channel = this.filtered[index];
      const slot = channel && this.container.querySelector(`[data-live-row="${index}"] [data-live-guide]`);
      if (slot) slot.innerHTML = View.guideMarkup(cache.get(channel.id), Date.now());
    });
  },

  retryGuide() {
    const cache = this.guides[this.selected];
    [...cache].forEach(([id, entry]) => { if (entry.state === "failed") cache.delete(id); });
    const failed = this.container.querySelector(".live-tv-guide-failed");
    if (failed) failed.hidden = true;
    this.planGuide();
  },

  stopGuide() {
    clearTimeout(this.guideWake);
    this.guideWake = null;
    this.guideAbort?.abort();
    this.guideAbort = null;
    this.guideInFlight = 0;
    this.rowObserver?.disconnect();
    this.rowObserver = null;
    this.visibleRows?.clear();
    // A fetch cut short by leaving the playlist is not a failure: forget it so it is asked again.
    this.guides?.forEach((cache) => [...cache].forEach(([id, entry]) => { if (entry.state === "loading") cache.delete(id); }));
  },

  onVisibilityChange() {
    if (this.isVisible()) {
      this.refreshVisibleGuide();
      this.planGuide();
    } else {
      clearTimeout(this.guideWake);
      this.guideWake = null;
    }
  },

  // ---- events ----

  selectPlaylist(index) {
    if (index === this.selected || !this.playlists[index]) return;
    this.selected = index;
    this.query = "";
    this.memory.rememberPlaylist(this.playlists[index].id);
    this.render();
    void this.loadChannels(index);
  },

  selectGroup(railIndex) {
    const group = this.rail[railIndex];
    if (!group) return;
    this.groupId = group.id;
    this.memory.rememberGroup(this.playlists[this.selected].id, group.id);
    this.query = "";
    const search = this.container.querySelector("[data-live-search]");
    if (search) search.value = "";
    this.renderList();
    // Deep in a long list, the new group starts at its top; otherwise the page stays put.
    const channels = this.container.querySelector(".live-tv-channels");
    if (channels && channels.getBoundingClientRect().top < 0) channels.scrollIntoView({ block: "start" });
  },

  toggleFavourite(index, button) {
    const channel = this.filtered[index];
    if (!channel) return;
    const on = this.favourites.toggle(liveContentId(this.playlists[this.selected].id, channel.id));
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? `Remove ${channel.name} from favourites` : `Add ${channel.name} to favourites`);
    button.title = on ? "Remove from favourites" : "Add to favourites";
    button.innerHTML = `<span class="material-icons" aria-hidden="true">${on ? "star" : "star_border"}</span>`;
    // The row stays where it is (so a slip can be undone); only the counts move.
    this.rail = this.buildRail();
    this.renderGroups();
  },

  play(index) {
    const channel = this.filtered[index];
    const playlist = this.playlists[this.selected];
    if (!channel || !playlist) return;
    const guide = this.guides[this.selected].get(channel.id);
    const now = guide?.state === "loaded" ? nowNext(guide.programmes, Date.now()).now : null;
    void Router.navigate("player", {
      streamUrl: channel.url,
      itemId: liveContentId(playlist.id, channel.id),
      itemType: "channel",
      playerTitle: channel.name,
      playerSubtitle: now?.title || playlist.name,
      returnRoute: "liveTv"
    });
  },

  onClick(event) {
    const target = event.target.closest("button");
    if (!target || !this.container.querySelector(".live-tv-main")?.contains(target)) return;
    const data = target.dataset;
    if (data.livePlaylist !== undefined) this.selectPlaylist(Number(data.livePlaylist));
    else if (data.liveGroup !== undefined) this.selectGroup(Number(data.liveGroup));
    else if (data.liveFavourite !== undefined) this.toggleFavourite(Number(data.liveFavourite), target);
    else if (data.liveChannel !== undefined) this.play(Number(data.liveChannel));
    else if (data.liveAction === "sign-in") void Router.navigate("authSignIn");
    else if (data.liveAction === "reload-playlists") void this.loadPlaylists();
    else if (data.liveAction === "retry-channels") void this.loadChannels(this.selected, { force: true });
    else if (data.liveAction === "retry-guide") this.retryGuide();
  },

  onInput(event) {
    if (!event.target.matches?.("[data-live-search]")) return;
    this.query = event.target.value;
    this.renderList();
  },

  focusRow(index, selector) {
    while (index >= this.rendered && this.appendWindow());
    const node = this.container.querySelector(`[data-live-row="${index}"] ${selector}`);
    if (!node || node.disabled) return false;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "nearest" });
    return true;
  },

  // Up/Down walk the channel list row by row; anything else falls through to the app's
  // shared keyboard handling (Enter activates, Left/Right move between a row and its star).
  onListKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target.matches?.("[data-live-search]")) {
      if (event.key === "ArrowDown" && this.filtered.length && this.focusRow(0, ".live-tv-row-play")) {
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === "Escape" && this.query) {
        event.preventDefault();
        event.stopPropagation();
        target.value = "";
        this.query = "";
        this.renderList();
      }
      return;
    }
    const row = target.closest?.("[data-live-row]");
    if (!row) return;
    const selector = target.matches(".live-tv-star") ? ".live-tv-star" : ".live-tv-row-play";
    let index = Number(row.dataset.liveRow);
    const step = event.key;
    const sideways = step === "ArrowRight" ? ".live-tv-star" : step === "ArrowLeft" ? ".live-tv-row-play" : "";
    if (sideways) {
      // Within a row: Right reaches its star, Left returns to the channel.
      if (sideways !== selector && this.focusRow(index, sideways)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    // End goes to the last row drawn so far (which draws the next window), never 10k rows at once.
    const total = step === "End" ? this.rendered : this.filtered.length;
    // Skip rows that cannot take focus (a channel with no stream address).
    for (let guard = 0; guard < this.filtered.length; guard += 1) {
      index = rowNeighbour({ index, total, key: step });
      if (index < 0) return;
      if (this.focusRow(index, selector)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (step === "Home" || step === "End") return;
    }
  },

  onKeyDown(event) {
    if (event.key === "Escape") { event.preventDefault(); void Router.back(); }
  },

  dispose() {
    this.generation = (this.generation || 0) + 1;
    this.screenAbort?.abort();
    this.stopGuide?.();
    this.listObserver?.disconnect();
    this.listObserver = null;
    this.inertObserver?.disconnect();
    this.inertObserver = null;
    if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility);
    this.onVisibility = null;
    if (this.container) {
      this.container.onclick = null;
      this.container.onkeydown = null;
      this.container.oninput = null;
      this.container.removeEventListener("error", this.onImageError, true);
    }
    this.playlists = [];
    this.loads = [];
    this.guides = [];
    this.filtered = [];
  },

  cleanup() {
    this.dispose();
    ScreenUtils.hide(this.container);
  }
};

