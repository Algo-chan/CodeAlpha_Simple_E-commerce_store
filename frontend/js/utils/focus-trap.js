/**
 * Focus trapping and focus restoration.
 *
 * Every overlay in the storefront (cart drawer, quick view, mobile nav, search,
 * filters, fullscreen gallery) uses this. It is deliberately generic so a new
 * overlay cannot accidentally ship without a trap.
 *
 * The trap is a document-level `keydown` listener rather than a per-element
 * one, so it also catches focus that has escaped the panel programmatically.
 */
import { getFocusable, focusSilently } from '../core/dom.js';

/**
 * Installed traps, oldest first. Panels mount as siblings on `body`, so the only
 * one allowed to act is the last one installed: without this a trap underneath
 * an open overlay pulls focus straight back out of it.
 * @type {HTMLElement[]}
 */
const installed = [];

/**
 * Traps Tab focus inside a container.
 *
 * @param {HTMLElement} container
 * @param {{ initialFocus?: HTMLElement, returnFocusTo?: HTMLElement }} [options]
 * @returns {() => void} release function
 */
export function trapFocus(container, { initialFocus, returnFocusTo } = {}) {
  const previouslyFocused =
    returnFocusTo ??
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  const onKeydown = (event) => {
    if (event.key !== 'Tab' || installed[installed.length - 1] !== container) return;

    const focusable = getFocusable(container);
    if (focusable.length === 0) {
      // Nothing to move to - keep focus on the panel itself.
      event.preventDefault();
      container.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      focusSilently(last);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusSilently(first);
    }
  };

  // A focus that lands outside the container (browser chrome, an extension, a
  // programmatic focus) is pulled back in.
  const onFocusIn = (event) => {
    if (installed[installed.length - 1] !== container) return;
    if (container.contains(event.target)) return;
    const focusable = getFocusable(container);
    focusSilently(focusable[0] ?? container);
  };

  installed.push(container);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocusIn, true);

  // Defer so the panel is laid out and its own transition has started.
  requestAnimationFrame(() => {
    if (installed[installed.length - 1] !== container) return;
    if (initialFocus && container.contains(initialFocus)) {
      focusSilently(initialFocus);
    } else {
      focusSilently(getFocusable(container)[0] ?? container);
    }
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = installed.indexOf(container);
    if (index !== -1) installed.splice(index, 1);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    if (previouslyFocused && document.contains(previouslyFocused)) {
      focusSilently(previouslyFocused);
    }
  };
}

/**
 * Moves focus to a heading or the panel itself.
 * Overlays should announce themselves through their label, so focusing the
 * panel (rather than the first control) avoids a screen reader reading the
 * whole form before the shopper has heard the title.
 *
 * @param {HTMLElement} container
 */
export function focusPanel(container) {
  if (!container.hasAttribute('tabindex') && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  focusSilently(container);
}

/** Announces a message in a polite live region without moving focus. */
export function announce(message) {
  const region = document.getElementById('a11y-live-polite');
  if (!region) return;
  // Clearing first guarantees the change is observed even for identical text.
  region.textContent = '';
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

export default { trapFocus, focusPanel, announce };
