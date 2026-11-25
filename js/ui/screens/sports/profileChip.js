// The nav's profile chip must never hold up a Sports screen. Signed in, getSidebarProfileState()
// waits on profiles + the avatar catalog, which can sit behind Home's request storm for ~40 s.
// So: paint now with the fallback chip, fill the real one if it arrives before the deadline.
import { withDeadline } from "../../../core/sports/boundedLoad.js";

export const PROFILE_CHIP_DEADLINE_MS = 8_000;

export function paintThenFillProfile({ paint, loadProfile, fill, isCurrent, deadlineMs = PROFILE_CHIP_DEADLINE_MS }) {
  paint(null);
  return withDeadline(() => loadProfile(), deadlineMs)
    .then(profile => { if (profile && isCurrent()) fill(profile); })
    .catch(() => { /* the fallback chip stays */ });
}

/** Swap the painted nav for one with the real profile chip, keeping the rest of the screen as it is. */
export function replaceNavigation(container, html, bind) {
  const current = container?.querySelector(".desktop-navigation");
  if (!current || typeof document === "undefined") return;
  const template = document.createElement("template");
  template.innerHTML = html;
  const next = template.content.querySelector(".desktop-navigation");
  if (!next) return;
  const hadFocus = current.contains(document.activeElement) ? document.activeElement.dataset?.desktopRoute : null;
  current.replaceWith(next);
  bind(container);
  if (hadFocus) next.querySelector(`[data-desktop-route="${hadFocus}"]`)?.focus({ preventScroll: true });
}
