/**
 * Body scroll lock.
 *
 * Reference counted, because overlays stack: the quick view can open on top of
 * the cart drawer, and closing one must not unlock scrolling for the other.
 *
 * `overflow: hidden` alone is not enough on iOS Safari, where the page can
 * still rubber-band. `position: fixed` with a remembered scroll offset is the
 * only reliable lock there, and compensating for the scrollbar width prevents
 * the layout shifting sideways on desktop.
 */

let lockCount = 0;
let savedScrollY = 0;

/** Width of the scrollbar, so hiding it does not reflow the page. */
function scrollbarWidth() {
  return globalThis.innerWidth - document.documentElement.clientWidth;
}

/**
 * Locks scrolling. Safe to call repeatedly.
 * @returns {() => void} unlock function (idempotent per call)
 */
export function lockScroll() {
  if (lockCount === 0) {
    savedScrollY = globalThis.scrollY ?? 0;
    const barWidth = scrollbarWidth();

    document.documentElement.style.setProperty('--scrollbar-width', `${barWidth}px`);
    document.body.dataset.scrollLocked = 'true';

    // iOS: freeze the body in place rather than relying on overflow alone.
    document.body.style.position = 'fixed';
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.insetInline = '0';
    document.body.style.overflowY = 'scroll';
  }

  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    unlockScroll();
  };
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return;

  delete document.body.dataset.scrollLocked;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.insetInline = '';
  document.body.style.overflowY = '';
  document.documentElement.style.removeProperty('--scrollbar-width');

  globalThis.scrollTo?.(0, savedScrollY);
}

/** True while any overlay holds the lock. */
export function isScrollLocked() {
  return lockCount > 0;
}

/** Test/debug helper: drops every outstanding lock. */
export function resetScrollLock() {
  lockCount = 0;
  unlockScroll();
}

export default { lockScroll, isScrollLocked, resetScrollLock };
