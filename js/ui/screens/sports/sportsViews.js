// Sports Centre views: view-model in, HTML string out. Pure: no DOM, no network, no timers.
// The screen owns state and one delegated handler keyed on data-sports-action
// (retry | refresh | toggle-scores | tab | select-day | open-game | follow-league | back | reveal | hide-again).
// Every string from data goes through escapeHtml; every image and link URL must be https.

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const text = value => String(value ?? "").trim();
const httpsUrl = value => (/^https:\/\/[^\s"'<>`]+$/i.test(text(value)) ? escapeHtml(text(value)) : "");
const list = value => (Array.isArray(value) ? value : []);
const icon = name => `<span class="material-icons" aria-hidden="true">${name}</span>`;
const hexColor = value => {
  const match = /^#?([0-9a-f]{6})$/i.exec(text(value));
  return match ? `#${match[1]}` : "";
};

const TABS = [["today", "Today"], ["calendar", "Calendar"], ["following", "Following"]];

// ---------- time ----------

const formatters = new Map();
function formatter(name, timeZone, options) {
  const key = `${name}|${timeZone || ""}`;
  if (!formatters.has(key)) {
    let made;
    try { made = new Intl.DateTimeFormat(undefined, { ...options, timeZone: timeZone || undefined }); }
    catch (_) { made = new Intl.DateTimeFormat(undefined, options); }
    formatters.set(key, made);
  }
  return formatters.get(key);
}
const dayKeyDate = day => new Date(`${day}T12:00:00Z`);
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(String(day ?? "")) && !Number.isNaN(dayKeyDate(day).getTime());
const shiftDay = (day, delta) => new Date(dayKeyDate(day).getTime() + delta * 86_400_000).toISOString().slice(0, 10);
const dayPart = (day, options) => formatter(JSON.stringify(options), "UTC", options).format(dayKeyDate(day));

function timeLabel(epochMs, timeZone) {
  return Number.isFinite(epochMs) ? formatter("time", timeZone, { hour: "numeric", minute: "2-digit" }).format(new Date(epochMs)) : "";
}

function dayLabel(day, today) {
  if (!validDay(day)) return "";
  if (validDay(today)) {
    if (day === today) return "Today";
    if (day === shiftDay(today, 1)) return "Tomorrow";
    if (day === shiftDay(today, -1)) return "Yesterday";
  }
  return dayPart(day, { weekday: "short", day: "numeric", month: "short" });
}

function agoLabel(updatedAtMs, nowMs) {
  if (!Number.isFinite(updatedAtMs) || !Number.isFinite(nowMs)) return "";
  const minutes = Math.floor(Math.max(0, nowMs - updatedAtMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

// ---------- shared pieces ----------

function initials(name) {
  const words = text(name).split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]].map(word => Array.from(word)[0]) : Array.from(words[0] || "").slice(0, 2);
  return letters.join("").toUpperCase();
}

// The initials show only when there is no <img> (none given, or the screen removed a broken one).
function crest(name, badge, size = "") {
  const url = httpsUrl(badge);
  return `<span class="sports-crest${size ? ` is-${size}` : ""}" data-initial="${escapeHtml(initials(name))}" aria-hidden="true">${
    url ? `<img src="${url}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
}

const progressLabel = progress => (/^\d+(\+\d+)?$/.test(text(progress)) ? `${text(progress)}'` : text(progress));
const finalLabel = sport => (text(sport).toLowerCase() === "soccer" ? "FT" : "Final");

function statePill(state, { sport, progress } = {}) {
  if (state === "live") {
    const minute = progressLabel(progress);
    return `<span class="sports-pill is-live"><span class="sports-live-dot" aria-hidden="true"></span>Live${minute ? ` <span class="sports-pill-progress">${escapeHtml(minute)}</span>` : ""}</span>`;
  }
  if (state === "final") return `<span class="sports-pill">${finalLabel(sport)}</span>`;
  if (state === "postponed") return '<span class="sports-pill is-off">Postponed</span>';
  return "";
}

function notice({ glyph, title, body, action = "", tone = "" }) {
  return `<div class="sports-notice${tone ? ` is-${tone}` : ""}">
    ${glyph ? icon(glyph) : ""}
    <h2>${escapeHtml(title)}</h2>
    ${body ? `<p>${escapeHtml(body)}</p>` : ""}
    ${action}
  </div>`;
}

const retryButton = '<button type="button" class="sports-button is-primary" data-sports-action="retry">Retry</button>';
const skeleton = (className, count = 1) => Array.from({ length: count }, () => `<span class="sports-skeleton ${className}"></span>`).join("");

// ---------- hub: cards ----------

function cardWhen(card, vm, showDay) {
  const time = card.dateOnly ? "All day" : timeLabel(card.kickoffMs, vm.timeZone);
  const day = showDay ? dayLabel(card.day, vm.hub?.today) : "";
  return { time, day };
}

function cardLabel(card, vm) {
  const { time, day } = cardWhen(card, vm, true);
  const parts = [];
  if (card.twoSided && !card.scoreHidden && (card.state === "live" || card.state === "final") && card.home.score != null && card.away.score != null) {
    parts.push(`${card.home.name} ${card.home.score}, ${card.away.name} ${card.away.score}`);
  } else {
    parts.push(card.title);
  }
  if (card.state === "live") parts.push(`live${card.progress ? ` ${progressLabel(card.progress)}` : ""}`);
  else if (card.state === "final") parts.push("final");
  else if (card.state === "postponed") parts.push("postponed");
  if (card.scoreHidden) parts.push("score hidden");
  if (card.state !== "live") parts.push([day, card.state === "upcoming" ? time : ""].filter(Boolean).join(" "));
  parts.push(card.league);
  return parts.filter(Boolean).join(", ");
}

function scoreCell(card, side) {
  if (card.scoreHidden || (card.state !== "live" && card.state !== "final")) return "";
  return `<span class="sports-card-score">${escapeHtml(card[side].score ?? "–")}</span>`;
}

function hiddenTag() {
  return `<span class="sports-hidden-tag">${icon("visibility_off")}Score hidden</span>`;
}

function renderCard(card, vm, { showDay = true, showLeague = true } = {}) {
  const { time, day } = cardWhen(card, vm, showDay);
  const meta = [showLeague ? card.league : "", card.round].filter(Boolean).join(" · ");
  const metaText = meta || (showLeague ? card.sport : "");
  const pill = statePill(card.state, card);
  const sideRow = side => `<span class="sports-card-team${card.leader === side ? " is-leader" : card.leader ? " is-trailing" : ""}">
      ${crest(card[side].name, card[side].badge)}<span class="sports-card-name">${escapeHtml(card[side].name)}</span>${scoreCell(card, side)}</span>`;
  const teams = card.twoSided
    ? `<span class="sports-card-teams">${sideRow("home")}${sideRow("away")}</span>`
    : `<span class="sports-card-teams"><span class="sports-card-event">${escapeHtml(card.title)}</span></span>`;
  let when = "";
  if (card.scoreHidden) when = `<span class="sports-card-when">${hiddenTag()}</span>`;
  else if (card.state === "upcoming") when = `<span class="sports-card-when"><span class="sports-card-time">${escapeHtml(time)}</span>${day ? `<span class="sports-card-day">${escapeHtml(day)}</span>` : ""}</span>`;
  const stamp = card.state !== "upcoming" && card.state !== "live" && day ? `<span class="sports-card-stamp">${escapeHtml(day)}</span>` : "";
  return `<button type="button" class="sports-card is-${escapeHtml(card.state)}" data-sports-action="open-game" data-key="${escapeHtml(card.key)}" data-league="${escapeHtml(card.leagueId)}" aria-label="${escapeHtml(cardLabel(card, vm))}">
    ${metaText || stamp || pill ? `<span class="sports-card-meta">
      <span class="sports-card-league">${showLeague ? crest(card.league, card.leagueBadge, "xs") : ""}<span>${escapeHtml(metaText)}</span></span>
      <span class="sports-card-status">${stamp}${pill}</span>
    </span>` : ""}
    <span class="sports-card-body">${teams}${when}</span>
  </button>`;
}

function renderHero(card, vm, kicker) {
  const { time, day } = cardWhen(card, vm, true);
  const started = card.state === "live" || card.state === "final";
  let centre;
  if (card.scoreHidden) centre = hiddenTag();
  else if (started && card.twoSided) {
    centre = `<span class="sports-hero-score"><span class="${card.leader === "away" ? "is-trailing" : ""}">${escapeHtml(card.home.score ?? "–")}</span><span class="sports-hero-dash" aria-hidden="true">–</span><span class="${card.leader === "home" ? "is-trailing" : ""}">${escapeHtml(card.away.score ?? "–")}</span></span>`;
  } else if (card.state === "upcoming") centre = `<span class="sports-hero-time">${escapeHtml(time)}</span>`;
  else centre = "";
  const sub = card.state === "live" ? statePill("live", card) : card.state === "upcoming" ? `<span class="sports-hero-day">${escapeHtml(day)}</span>` : statePill(card.state, card);
  const side = which => `<span class="sports-hero-side">${crest(card[which].name, card[which].badge, "lg")}<span class="sports-hero-name">${escapeHtml(card[which].name)}</span></span>`;
  const match = card.twoSided
    ? `<span class="sports-hero-match">${side("home")}<span class="sports-hero-centre">${centre}${sub}</span>${side("away")}</span>`
    : `<span class="sports-hero-match is-event"><span class="sports-hero-name">${escapeHtml(card.title)}</span><span class="sports-hero-centre">${centre}${sub}</span></span>`;
  const foot = [card.round, card.venue].filter(Boolean).join(" · ");
  return `<button type="button" class="sports-hero is-${escapeHtml(card.state)}" data-sports-action="open-game" data-key="${escapeHtml(card.key)}" data-league="${escapeHtml(card.leagueId)}" aria-label="${escapeHtml(`${kicker}: ${cardLabel(card, vm)}`)}">
    <span class="sports-hero-top">
      <span class="sports-hero-kicker">${escapeHtml(kicker)}</span>
      <span class="sports-card-league">${crest(card.league, card.leagueBadge, "xs")}<span>${escapeHtml(card.league || card.sport)}</span></span>
    </span>
    ${match}
    <span class="sports-hero-foot"><span>${escapeHtml(foot)}</span><span class="sports-hero-cta">Game details${icon("chevron_right")}</span></span>
  </button>`;
}

function section(title, count, body, id) {
  return `<section class="sports-section" aria-labelledby="${id}">
    <h2 class="sports-section-title" id="${id}">${escapeHtml(title)}${count ? `<span class="sports-section-count">${count}</span>` : ""}</h2>
    ${body}
  </section>`;
}

const cardGrid = (cards, vm, options) => `<div class="sports-grid">${cards.map(card => renderCard(card, vm, options)).join("")}</div>`;

// ---------- hub: tabs ----------

function renderToday(vm) {
  const live = list(vm.hub?.live);
  const next = list(vm.hub?.next);
  const results = list(vm.hub?.results);
  if (!live.length && !next.length && !results.length) {
    return notice({
      glyph: "event_available",
      title: "Nothing this week",
      body: "The leagues and clubs you follow have no games in the last or next seven days. The Calendar tab has the full schedule.",
      action: '<button type="button" class="sports-button" data-sports-action="tab" data-tab="calendar">Open Calendar</button>'
    });
  }
  const parts = [];
  if (live.length) {
    parts.push(section("Live now", live.length, `${renderHero(live[0], vm, "Featured game")}${live.length > 1 ? cardGrid(live.slice(1), vm) : ""}`, "sports-live-title"));
    if (next.length) parts.push(section("Coming up", 0, cardGrid(next, vm), "sports-next-title"));
  } else if (next.length) {
    parts.push(section("Coming up", 0, `${renderHero(next[0], vm, "Next up")}${next.length > 1 ? cardGrid(next.slice(1), vm) : ""}`, "sports-next-title"));
  }
  if (results.length) parts.push(section("Results", 0, cardGrid(results, vm), "sports-results-title"));
  return parts.join("");
}

function renderDayStrip(vm, days, today) {
  const byDay = new Map(days.map(entry => [entry.day, entry]));
  const keys = [...new Set([...byDay.keys(), today, vm.selectedDay].filter(validDay))].sort();
  const buttons = keys.map(day => {
    const entry = byDay.get(day);
    const count = list(entry?.cards).length;
    const liveCount = entry?.liveCount || 0;
    const selected = day === vm.selectedDay;
    const isToday = day === today;
    const label = [
      dayPart(day, { weekday: "long", day: "numeric", month: "long" }),
      isToday ? "today" : "",
      count ? `${count} ${count === 1 ? "game" : "games"}` : "no games",
      liveCount ? `${liveCount} live` : ""
    ].filter(Boolean).join(", ");
    return `<button type="button" class="sports-day${selected ? " is-selected" : ""}${isToday ? " is-today" : ""}${liveCount ? " has-live" : ""}${count ? "" : " is-empty"}"
      data-sports-action="select-day" data-day="${day}" aria-pressed="${selected}"${isToday ? ' aria-current="date"' : ""} aria-label="${escapeHtml(label)}">
      <span class="sports-day-week">${isToday ? "Today" : escapeHtml(dayPart(day, { weekday: "short" }))}</span>
      <span class="sports-day-num">${escapeHtml(dayPart(day, { day: "numeric" }))}</span>
      <span class="sports-day-month">${escapeHtml(dayPart(day, { month: "short" }))}</span>
      <span class="sports-day-count">${liveCount ? '<span class="sports-live-dot" aria-hidden="true"></span>' : ""}${count || ""}</span>
    </button>`;
  }).join("");
  return `<div class="sports-day-strip" role="group" aria-label="Days with games">${buttons}</div>`;
}

function renderCalendar(vm) {
  const days = list(vm.hub?.days);
  const today = vm.hub?.today;
  const cards = list(days.find(entry => entry.day === vm.selectedDay)?.cards);
  const heading = validDay(vm.selectedDay)
    ? `${vm.selectedDay === today ? "Today · " : ""}${dayPart(vm.selectedDay, { weekday: "long", day: "numeric", month: "long" })}` : "";
  const leagues = new Map();
  cards.forEach(card => {
    const key = card.leagueId || card.league;
    if (!leagues.has(key)) leagues.set(key, { name: card.league || card.sport, badge: card.leagueBadge, cards: [] });
    leagues.get(key).cards.push(card);
  });
  const groups = [...leagues.values()].map(group => `<section class="sports-league-group">
      <h3 class="sports-league-title">${crest(group.name, group.badge, "sm")}<span>${escapeHtml(group.name)}</span></h3>
      ${cardGrid(group.cards, vm, { showDay: false, showLeague: false })}
    </section>`).join("");
  return `${renderDayStrip(vm, days, today)}
    <section class="sports-section" aria-labelledby="sports-day-title">
      <h2 class="sports-section-title" id="sports-day-title">${escapeHtml(heading)}${cards.length ? `<span class="sports-section-count">${cards.length}</span>` : ""}</h2>
      ${cards.length ? groups : '<p class="sports-empty">No games on this day.</p>'}
    </section>`;
}

function leagueToggle(league, followed, canEdit, pendingId) {
  const id = text(league?.id);
  if (!id) return "";
  const pending = pendingId != null && String(pendingId) === id;
  return `<button type="button" class="sports-follow${followed ? " is-following" : ""}${pending ? " is-pending" : ""}" data-sports-action="follow-league" data-league="${escapeHtml(id)}" aria-pressed="${followed}"${pending ? ' aria-busy="true"' : ""}${canEdit && !pending ? "" : " disabled"}>
    ${crest(league.name, league.badge, "sm")}
    <span class="sports-follow-copy"><span class="sports-follow-name">${escapeHtml(league.name)}</span>${league.sport ? `<span class="sports-follow-sport">${escapeHtml(league.sport)}</span>` : ""}</span>
    <span class="sports-follow-state">${pending ? '<span class="sports-spinner" aria-hidden="true"></span><span>Saving…</span>' : `${icon(followed ? "check" : "add")}<span>${followed ? "Following" : "Follow"}</span>`}</span>
  </button>`;
}

function renderFollowing(vm) {
  const followedIds = vm.followedLeagueIds instanceof Set ? vm.followedLeagueIds : new Set(list(vm.followedLeagueIds).map(String));
  const isFollowed = league => followedIds.has(String(league?.id));
  const leagues = list(vm.leagues);
  const teams = list(vm.teams);
  const catalog = list(vm.catalog).filter(category => list(category?.leagues).length);
  const canEdit = Boolean(vm.canEditFollows);
  const lockNote = canEdit ? "" : `<p class="sports-lock-note">${icon("lock")}<span>${vm.signedIn
    ? "Following can't be changed right now. Your current leagues still update."
    : "Sign in to choose the leagues you follow."}</span></p>`;
  const mine = leagues.length
    ? `<div class="sports-follow-grid">${leagues.map(league => leagueToggle(league, true, canEdit, vm.pendingLeagueId)).join("")}</div>`
    : '<p class="sports-empty">You are not following any leagues yet. Pick some below.</p>';
  const clubs = teams.length ? section("Your clubs", teams.length, `<ul class="sports-club-list">${teams.map(team => `<li class="sports-club">
        ${crest(team.name, team.badge, "sm")}<span class="sports-follow-copy"><span class="sports-follow-name">${escapeHtml(team.name)}</span>${team.league ? `<span class="sports-follow-sport">${escapeHtml(team.league)}</span>` : ""}</span>
      </li>`).join("")}</ul>`, "sports-clubs-title") : "";
  const picker = catalog.length
    ? catalog.map((category, index) => `<section class="sports-league-group" aria-labelledby="sports-category-${index}">
        <h3 class="sports-league-title" id="sports-category-${index}"><span>${escapeHtml(category.name)}</span></h3>
        <div class="sports-follow-grid">${list(category.leagues).map(league => leagueToggle(league, isFollowed(league), canEdit, vm.pendingLeagueId)).join("")}</div>
      </section>`).join("")
    : '<p class="sports-empty">The league list is not available right now.</p>';
  return `${lockNote}
    ${section("Your leagues", leagues.length, mine, "sports-leagues-title")}
    ${clubs}
    ${section("All leagues", 0, picker, "sports-catalog-title")}`;
}

// ---------- hub ----------

function renderHubHeader(vm) {
  const ago = agoLabel(vm.updatedAtMs, vm.nowMs);
  let status = "";
  if (vm.status === "loading") status = "Loading games…";
  else if (vm.refreshError) status = `Couldn't refresh${ago ? `. Showing games from ${ago}` : ""}.`;
  else if (vm.refreshing) status = "Refreshing…";
  else if (ago && vm.status !== "failed") status = `Updated ${ago}`;
  const shown = vm.scoresShown !== false;
  return `<header class="sports-header">
    <div class="sports-heading">
      <h1>Sports</h1>
      <p class="sports-status${vm.refreshError ? " is-warning" : ""}" role="status">${escapeHtml(status)}</p>
    </div>
    <div class="sports-header-actions">
      <button type="button" class="sports-switch${shown ? " is-on" : ""}" role="switch" aria-checked="${shown}" aria-pressed="${shown}" data-sports-action="toggle-scores"
        title="${shown ? "Hide every score and result" : "Show scores and results"}">
        <span class="sports-switch-track" aria-hidden="true"><span class="sports-switch-thumb"></span></span>
        <span class="sports-switch-label">Scores <span class="sports-switch-state">${shown ? "shown" : "hidden"}</span></span>
      </button>
      <button type="button" class="sports-icon-button${vm.refreshing ? " is-busy" : ""}" data-sports-action="refresh" aria-label="Refresh" title="Refresh"${vm.refreshing ? ' aria-disabled="true"' : ""}>${icon("refresh")}</button>
    </div>
  </header>`;
}

function renderTabs(active) {
  return `<div class="sports-tabs" role="tablist" aria-label="Sports sections">${TABS.map(([id, label]) => `<button type="button" class="sports-tab" role="tab" id="sports-tab-${id}"
      aria-selected="${id === active}" aria-controls="sports-panel" data-sports-action="tab" data-tab="${id}">${label}</button>`).join("")}</div>`;
}

function renderHubSkeleton() {
  return `<div class="sports-loading" aria-hidden="true">
    ${skeleton("is-hero")}
    <div class="sports-grid">${skeleton("is-card", 6)}</div>
  </div>`;
}

export function renderSportsHub(vm = {}) {
  const tab = TABS.some(([id]) => id === vm.tab) ? vm.tab : "today";
  const header = renderHubHeader(vm);
  if (vm.status === "failed") {
    return `${header}${notice({
      glyph: "cloud_off",
      tone: "error",
      title: "Couldn't load sports",
      body: text(vm.errorMessage) || "Check your connection and try again.",
      action: retryButton
    })}`;
  }
  let body;
  if (vm.status === "loading" || !vm.hub && vm.status !== "noFollows") body = renderHubSkeleton();
  else if (tab === "following") body = renderFollowing(vm);
  else if (vm.status === "noFollows") {
    body = notice({
      glyph: "emoji_events",
      title: "Follow a league to get started",
      body: "Pick the leagues you care about and their live scores, fixtures and results show up here.",
      action: '<button type="button" class="sports-button is-primary" data-sports-action="tab" data-tab="following">Choose leagues</button>'
    });
  } else body = tab === "calendar" ? renderCalendar(vm) : renderToday(vm);
  return `${header}
    ${renderTabs(tab)}
    <div class="sports-panel${vm.scoresShown === false ? " is-scores-hidden" : ""}" id="sports-panel" role="tabpanel" aria-labelledby="sports-tab-${tab}"${vm.status === "loading" ? ' aria-busy="true"' : ""}>${body}</div>`;
}

// ---------- game page ----------

function sideFrom(side) {
  if (!side) return null;
  return {
    name: text(side.name),
    badge: side.badgeUrl ?? side.badge ?? null,
    score: side.score == null || text(side.score) === "" ? null : text(side.score),
    record: text(side.record) || null,
    rank: Number.isFinite(+side.rank) && +side.rank > 0 ? +side.rank : null,
    color: hexColor(side.color)
  };
}

/** One scoreboard model from the detail header, falling back to the hub card. */
function scoreboardModel(vm) {
  const { detail, card } = vm;
  const header = detail?.header;
  const state = text(detail?.state) || card?.state || "upcoming";
  const base = {
    state,
    sport: text(detail?.sport) || card?.sport || "",
    league: text(detail?.leagueName) || card?.league || "",
    leagueBadge: card?.leagueBadge || null,
    venue: text(detail?.venue) || card?.venue || null,
    round: card?.round || null,
    progress: card?.progress || null,
    kickoffMs: Number.isFinite(Date.parse(detail?.startsAt)) ? Date.parse(detail.startsAt) : card?.kickoffMs ?? null,
    dateOnly: Boolean(card?.dateOnly),
    day: card?.day || null
  };
  if (header?.kind === "teams" || header?.kind === "versus") {
    const a = sideFrom(header.kind === "teams" ? header.home : header.a);
    const b = sideFrom(header.kind === "teams" ? header.away : header.b);
    if (a?.name && b?.name) {
      // The detail payload can lack a crest the hub card already has.
      if (header.kind === "teams" && card?.twoSided) {
        a.badge = a.badge || card.home.badge;
        b.badge = b.badge || card.away.badge;
      }
      return { ...base, kind: "sides", a, b };
    }
  }
  if (header?.kind === "event" && text(header.name)) {
    return { ...base, kind: "event", title: text(header.name), session: text(header.session) || null, venue: text(header.venue) || base.venue };
  }
  if (card?.twoSided) return { ...base, kind: "sides", a: sideFrom(card.home), b: sideFrom(card.away) };
  if (card?.title) return { ...base, kind: "event", title: card.title, session: null };
  return null;
}

function renderScoreboard(vm, model) {
  const started = model.state === "live" || model.state === "final";
  const hidden = Boolean(vm.scoreHidden) && started;
  const live = vm.detail?.live || {};
  const clock = [live.periodLabel, live.clock].map(text).filter(Boolean).join(" · ") || progressLabel(model.progress);
  const time = model.dateOnly ? "All day" : timeLabel(model.kickoffMs, vm.timeZone);
  const dateText = Number.isFinite(model.kickoffMs)
    ? formatter("date", vm.timeZone, { weekday: "short", day: "numeric", month: "short" }).format(new Date(model.kickoffMs))
    : model.day ? dayLabel(model.day, null) : "";
  let leader = null;
  if (model.kind === "sides" && started && !hidden && model.a.score != null && model.b.score != null
    && Number.isFinite(+model.a.score) && Number.isFinite(+model.b.score) && +model.a.score !== +model.b.score) {
    leader = +model.a.score > +model.b.score ? "a" : "b";
  }
  const pill = model.state === "live"
    ? statePill("live", { progress: clock })
    : statePill(model.state, model);
  let centre;
  if (hidden) centre = hiddenTag();
  else if (started && model.kind === "sides") {
    centre = `<span class="sports-board-score"><span class="${leader === "b" ? "is-trailing" : ""}">${escapeHtml(model.a.score ?? "–")}</span><span class="sports-hero-dash" aria-hidden="true">–</span><span class="${leader === "a" ? "is-trailing" : ""}">${escapeHtml(model.b.score ?? "–")}</span></span>`;
  } else if (model.state === "upcoming" && time) centre = `<span class="sports-board-time">${escapeHtml(time)}</span>`;
  else centre = "";
  const liveDetail = model.state === "live" && !hidden && text(live.detail) ? `<span class="sports-board-detail">${escapeHtml(live.detail)}</span>` : "";
  const side = (which, label) => {
    const team = model[which];
    const sub = [team.rank ? `#${team.rank}` : "", hidden ? "" : team.record].filter(Boolean).join(" · ");
    return `<div class="sports-board-side${leader === which ? " is-leader" : ""}"${team.color ? ` style="--sports-team:${team.color}"` : ""}>
      ${crest(team.name, team.badge, "xl")}
      <span class="sports-board-name">${escapeHtml(team.name)}</span>
      ${sub ? `<span class="sports-board-sub">${escapeHtml(sub)}</span>` : ""}
      <span class="sports-visually-hidden">${label}</span>
    </div>`;
  };
  const centreBlock = `<div class="sports-board-centre">${centre}${pill}${model.state === "upcoming" || !started ? `<span class="sports-board-date">${escapeHtml(dateText)}</span>` : ""}${liveDetail}</div>`;
  const match = model.kind === "sides"
    ? `<div class="sports-board-match">${side("a", "")}${centreBlock}${side("b", "")}</div>`
    : `<div class="sports-board-match is-event"><div class="sports-board-event"><span class="sports-board-name">${escapeHtml(model.title)}</span>${model.session ? `<span class="sports-board-sub">${escapeHtml(model.session)}</span>` : ""}</div>${centreBlock}</div>`;
  const meta = [model.round, model.venue, started ? dateText : ""].filter(Boolean).map(escapeHtml).join(" · ");
  let reveal = "";
  if (hidden && vm.revealable) {
    reveal = `<div class="sports-board-reveal"><span>${escapeHtml(model.state === "live" ? "The score, stats and timeline are hidden." : "The result, stats and timeline are hidden.")}</span>
      <button type="button" class="sports-button" data-sports-action="reveal">${icon("visibility")}Show score</button></div>`;
  } else if (vm.revealedHere) {
    reveal = `<div class="sports-board-reveal"><span>Scores are hidden everywhere else.</span>
      <button type="button" class="sports-button" data-sports-action="hide-again">${icon("visibility_off")}Hide again</button></div>`;
  }
  const label = model.kind === "sides" ? `${model.a.name} v ${model.b.name}` : model.title;
  return `<section class="sports-board is-${escapeHtml(model.state)}" aria-label="${escapeHtml(label)}">
    <p class="sports-board-league">${crest(model.league, model.leagueBadge, "xs")}<span>${escapeHtml(model.league || model.sport)}</span></p>
    <h1 class="sports-visually-hidden">${escapeHtml(label)}</h1>
    ${match}
    ${meta ? `<p class="sports-board-meta">${meta}</p>` : ""}
    ${reveal}
  </section>`;
}

const block = (title, body, className = "") => `<section class="sports-block${className ? ` ${className}` : ""}"><h2 class="sports-block-title">${escapeHtml(title)}</h2>${body}</section>`;
const numeric = value => { const number = parseFloat(String(value ?? "").replace(/[%,]/g, "")); return Number.isFinite(number) ? number : null; };

function renderStats(data, names) {
  const rows = list(data.rows).filter(row => text(row?.label)).map(row => {
    const home = numeric(row.home);
    const away = numeric(row.away);
    const total = home != null && away != null && home >= 0 && away >= 0 ? home + away : 0;
    const share = total > 0 ? Math.round((home / total) * 100) : null;
    const unit = escapeHtml(text(row.unit));
    return `<li class="sports-stat">
      <span class="sports-stat-value">${escapeHtml(text(row.home))}${unit}</span>
      <span class="sports-stat-label">${escapeHtml(row.label)}</span>
      <span class="sports-stat-value is-away">${escapeHtml(text(row.away))}${unit}</span>
      ${share == null ? "" : `<span class="sports-stat-bars" aria-hidden="true"><span class="sports-stat-bar"><span style="width:${share}%"></span></span><span class="sports-stat-bar is-away"><span style="width:${100 - share}%"></span></span></span>`}
    </li>`;
  });
  if (!rows.length) return "";
  return block("Stats", `<p class="sports-block-sides"><span>${escapeHtml(names.home)}</span><span>${escapeHtml(names.away)}</span></p><ul class="sports-stats">${rows.join("")}</ul>`);
}

function timelineTone(item) {
  const kind = text(item.kind).toLowerCase();
  const words = text(item.text).toLowerCase();
  if (kind === "goal" || kind === "score") return "goal";
  if (kind === "card") return words.includes("red") ? "red" : "yellow";
  if (kind === "sub") return "sub";
  return "plain";
}

function renderTimeline(data, title) {
  const items = list(data.items).filter(item => text(item?.text)).map(item => {
    const side = item.side === "home" || item.side === "away" ? item.side : "none";
    const tone = timelineTone(item);
    return `<li class="sports-event is-${side} is-${tone}">
      <span class="sports-event-time">${escapeHtml([text(item.period), text(item.time)].filter(Boolean).join(" "))}</span>
      <span class="sports-event-mark" aria-hidden="true"></span>
      <span class="sports-event-text">${escapeHtml(item.text)}${text(item.score) ? ` <span class="sports-event-score">${escapeHtml(item.score)}</span>` : ""}</span>
    </li>`;
  });
  return items.length ? block(title, `<ol class="sports-timeline">${items.join("")}</ol>`) : "";
}

function renderLineup(data, names) {
  const sides = list(data.sides).filter(side => list(side?.players).length).map(side => {
    const players = list(side.players).filter(player => text(player?.name));
    const row = player => `<li class="sports-player"><span class="sports-player-number">${escapeHtml(text(player.number))}</span><span class="sports-player-name">${escapeHtml(player.name)}</span><span class="sports-player-pos">${escapeHtml(text(player.pos))}</span></li>`;
    const starters = players.filter(player => player.starter !== false);
    const subs = players.filter(player => player.starter === false);
    const name = text(side.team) || names[side.side] || "";
    return `<div class="sports-lineup-side">
      <h3>${escapeHtml(name)}${text(side.formation) ? ` <span class="sports-lineup-formation">${escapeHtml(side.formation)}</span>` : ""}</h3>
      <ul>${starters.map(row).join("")}</ul>
      ${subs.length ? `<h4>Substitutes</h4><ul>${subs.map(row).join("")}</ul>` : ""}
    </div>`;
  });
  return sides.length ? block("Lineups", `<div class="sports-lineup">${sides.join("")}</div>`, "is-wide") : "";
}

const FORM_WORDS = { W: "win", D: "draw", L: "loss" };
function formPills(results) {
  return list(results).map(result => text(result).toUpperCase().charAt(0)).filter(letter => FORM_WORDS[letter])
    .map(letter => `<span class="sports-form-pill is-${letter.toLowerCase()}" title="${FORM_WORDS[letter]}">${letter}<span class="sports-visually-hidden"> ${FORM_WORDS[letter]}</span></span>`).join("");
}

function renderForm(data, names) {
  const rows = ["home", "away"].map(side => {
    const pills = formPills(data[side]);
    return pills ? `<li class="sports-form-row"><span class="sports-form-team">${escapeHtml(names[side])}</span><span class="sports-form">${pills}</span></li>` : "";
  }).join("");
  return rows ? block("Recent form", `<ul class="sports-form-list">${rows}</ul>`) : "";
}

function renderStandings(data, names) {
  const mine = new Set([names.home, names.away].map(name => text(name).toLowerCase()).filter(Boolean));
  const rows = list(data.rows).filter(row => text(row?.name));
  if (!rows.length) return "";
  const hasGd = rows.some(row => text(row.gd));
  const body = rows.map(row => `<tr${mine.has(text(row.name).toLowerCase()) ? ' class="is-game-team"' : ""}>
      <td class="is-num">${escapeHtml(text(row.pos))}</td>
      <th scope="row"><span class="sports-table-team">${crest(row.name, row.badgeUrl, "xs")}<span>${escapeHtml(row.name)}</span></span></th>
      <td class="is-num">${escapeHtml(text(row.played))}</td>
      ${hasGd ? `<td class="is-num">${escapeHtml(text(row.gd))}</td>` : ""}
      <td class="is-num is-strong">${escapeHtml(text(row.points))}</td>
    </tr>`).join("");
  return block("Table", `<div class="sports-table-wrap"><table class="sports-table">
    <thead><tr><th scope="col" class="is-num"><abbr title="Position">#</abbr></th><th scope="col">Team</th><th scope="col" class="is-num"><abbr title="Played">P</abbr></th>${hasGd ? '<th scope="col" class="is-num"><abbr title="Goal difference">GD</abbr></th>' : ""}<th scope="col" class="is-num"><abbr title="Points">Pts</abbr></th></tr></thead>
    <tbody>${body}</tbody></table></div>`);
}

function genericTable(columns, rows, { rowLabels = null, highlight = () => false } = {}) {
  const head = `<tr>${rowLabels ? '<th scope="col"><span class="sports-visually-hidden">Team</span></th>' : ""}${list(columns).map(column => `<th scope="col" class="is-num">${escapeHtml(text(column))}</th>`).join("")}</tr>`;
  const body = rows.map((cells, index) => `<tr${highlight(index) ? ' class="is-game-team"' : ""}>${rowLabels ? `<th scope="row">${escapeHtml(text(rowLabels[index]))}</th>` : ""}${list(cells).map(cell => `<td class="is-num">${escapeHtml(text(cell))}</td>`).join("")}</tr>`).join("");
  return `<div class="sports-table-wrap"><table class="sports-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function renderLinescore(data, names) {
  const rows = list(data.rows).filter(row => list(row).length);
  if (!rows.length || !list(data.columns).length) return "";
  const labels = list(data.rowLabels).length === rows.length ? data.rowLabels : rows.length === 2 ? [names.home, names.away] : rows.map(() => "");
  return block("Score by period", genericTable(data.columns, rows, { rowLabels: labels }));
}

function renderStandingsTable(data) {
  const groups = list(data.groups).filter(group => list(group?.rows).length && list(group?.columns).length).map(group => {
    const rows = list(group.rows);
    return `${text(group.name) ? `<h3 class="sports-block-subtitle">${escapeHtml(group.name)}</h3>` : ""}${genericTable(group.columns, rows.map(row => row.cells), {
      rowLabels: rows.map(row => row.name),
      highlight: index => Boolean(rows[index].isGameTeam)
    })}`;
  });
  return groups.length ? block("Table", groups.join("")) : "";
}

function renderLeaders(data, names) {
  const items = list(data.items).filter(item => text(item?.athlete)).map(item => `<li class="sports-leader">
      <span class="sports-leader-copy"><span class="sports-leader-name">${escapeHtml(item.athlete)}</span><span class="sports-leader-category">${escapeHtml([text(item.category), names[item.side] || ""].filter(Boolean).join(" · "))}</span></span>
      <span class="sports-leader-value">${escapeHtml(text(item.value))}</span>
    </li>`);
  return items.length ? block("Leaders", `<ul class="sports-leaders">${items.join("")}</ul>`) : "";
}

function renderNext(data) {
  const items = list(data.items).filter(item => text(item?.text)).map(item => `<li class="sports-next-item"><span class="sports-next-when">${escapeHtml(text(item.when))}</span><span>${escapeHtml(item.text)}</span></li>`);
  return items.length ? block("Up next", `<ul class="sports-next">${items.join("")}</ul>`) : "";
}

function renderHighlights(data) {
  const url = httpsUrl(data.url);
  if (!url) return "";
  const thumbnail = httpsUrl(data.thumbnail);
  return block("Highlights", `<a class="sports-highlights" href="${url}" target="_blank" rel="noopener noreferrer">
    ${thumbnail ? `<span class="sports-highlights-art"><img src="${thumbnail}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>` : ""}
    <span class="sports-highlights-copy"><span>Watch the highlights</span><span class="sports-highlights-note">Opens in a new tab</span></span>
    ${icon("open_in_new")}
  </a>`);
}

function renderBlocks(detail, names) {
  return list(detail?.blocks).map(data => {
    switch (data?.type) {
      case "situation": return text(data.line) ? `<p class="sports-situation">${escapeHtml(data.line)}</p>` : "";
      case "linescore": return renderLinescore(data, names);
      case "stats": return renderStats(data, names);
      case "timeline": return renderTimeline(data, "Timeline");
      case "plays": return renderTimeline(data, "Plays");
      case "leaders": return renderLeaders(data, names);
      case "lineup": return renderLineup(data, names);
      case "form": return renderForm(data, names);
      case "standings": return renderStandings(data, names);
      case "standingsTable": return renderStandingsTable(data);
      case "next": return renderNext(data);
      case "highlights": return renderHighlights(data);
      default: return "";
    }
  }).filter(Boolean);
}

function renderGameSkeleton(withBoard) {
  return `<div class="sports-loading" aria-hidden="true">
    ${withBoard ? skeleton("is-board") : ""}
    <div class="sports-blocks">${skeleton("is-block", 3)}</div>
  </div>`;
}

export function renderSportsGame(vm = {}) {
  const model = scoreboardModel(vm);
  const ago = agoLabel(vm.updatedAtMs, vm.nowMs);
  let status = "";
  if (vm.status === "loading") status = "Loading game…";
  else if (vm.status === "ready" && ago) status = `Updated ${ago}`;
  const top = `<header class="sports-game-top">
    <button type="button" class="sports-button is-back" data-sports-action="back">${icon("arrow_back")}Sports</button>
    <p class="sports-status" role="status">${escapeHtml(status)}</p>
  </header>`;
  const board = model ? renderScoreboard(vm, model) : "";
  let body;
  if (vm.status === "loading") body = renderGameSkeleton(!model);
  else if (vm.status === "failed") {
    body = notice({
      glyph: "cloud_off",
      tone: "error",
      title: "Couldn't load this game",
      body: text(vm.errorMessage) || "Check your connection and try again.",
      action: retryButton
    });
  } else if (vm.status === "unavailable" || !vm.detail) {
    body = model
      ? '<p class="sports-game-note">Stats, lineups and the timeline are only available for games within two weeks of today.</p>'
      : notice({ glyph: "sports", title: "Game not found", body: "This game is no longer in the schedule." });
  } else {
    const names = model?.kind === "sides" ? { home: model.a.name, away: model.b.name } : { home: "Home", away: "Away" };
    const blocks = renderBlocks(vm.detail, names);
    const started = model?.state === "live" || model?.state === "final";
    if (blocks.length) body = `<div class="sports-blocks is-${escapeHtml(model?.state || "upcoming")}">${blocks.join("")}</div>`;
    else if (vm.scoreHidden && started) body = "";
    else body = '<p class="sports-game-note">No more detail for this game yet.</p>';
  }
  return `${top}${board}${body}`;
}
