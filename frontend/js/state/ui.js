/**
 * Transient UI state: the overlay stack and the toast queue.
 *
 * THE OVERLAY STACK IS A STACK, NOT A SET. Two overlays can be open at once -
 * the quick view sits on top of the cart drawer, and on mobile the search
 * overlay can sit on top of the navigation drawer. Because order matters
 * (Escape closes the topmost, the scroll lock is reference counted, focus
 * returns to the element that opened the topmost), a stack is the only correct
 * structure. A naive `isCartOpen && !isSearchOpen` model gets this wrong.
 */
import { createStore } from './store.js';

/** @type {Readonly<Record<string, {tone:string, icon:string, duration:number}>>} */
export const TOAST_TONES = Object.freeze({
  success: { tone: 'success', icon: 'check-circle', duration: 3200 },
  error: { tone: 'error', icon: 'alert-circle', duration: 5200 },
  warning: { tone: 'warning', icon: 'alert-triangle', duration: 4600 },
  info: { tone: 'info', icon: 'info', duration: 3600 },
});

/** Max toasts on screen; older ones are dropped rather than stacking forever. */
const MAX_TOASTS = 3;

const initialState = {
  /**
   * Bottom-most first.
   * @type {Array<{id:string, label:string, isDismissible:boolean}>}
   */
  overlays: [],
  /** @type {Array<{id:number, tone:string, icon:string, title:string,
   *                 message:string|null, actionLabel:string|null, duration:number}>} */
  toasts: [],
};

let toastId = 0;

export function createUiStore() {
  const store = createStore(initialState, { name: 'ui' });

  /* --- Overlays ------------------------------------------------------------- */

  /**
   * Pushes an overlay onto the stack.
   * @param {{ id:string, label:string, isDismissible?:boolean }} overlay
   */
  function openOverlay(overlay) {
    const { overlays } = store.getState();
    if (overlays.some((item) => item.id === overlay.id)) return;
    store.setState({
      overlays: [...overlays, { isDismissible: true, ...overlay }],
    });
  }

  /**
   * @param {string} id
   * @param {{ topmostOnly?: boolean }} [options] remove only the top overlay,
   *        which is what a dismiss button inside a stacked overlay should do
   */
  function closeOverlay(id, { topmostOnly = false } = {}) {
    const { overlays } = store.getState();
    if (!overlays.some((item) => item.id === id)) return;

    if (topmostOnly && overlays.at(-1)?.id !== id) return;

    store.setState({ overlays: overlays.filter((item) => item.id !== id) });
  }

  function closeAllOverlays() {
    store.setState({ overlays: [] });
  }

  /** @param {string} id */
  function isOverlayOpen(id) {
    return store.getState().overlays.some((item) => item.id === id);
  }

  /**
   * The overlay that owns Escape and focus right now.
   * @returns {object|null}
   */
  function topOverlay() {
    return store.getState().overlays.at(-1) ?? null;
  }

  /* --- Toasts --------------------------------------------------------------- */

  /**
   * Queues a toast. Repeated identical titles collapse into a counter, so
   * tapping "add to cart" ten times does not bury the page in notices.
   *
   * @param {{ title:string, message?:string, tone?:keyof TOAST_TONES,
   *           actionLabel?:string, onAction?:Function, duration?:number }} options
   * @returns {number} toast id
   */
  function pushToast({ title, message = null, tone = 'info', actionLabel = null, onAction = null, duration }) {
    const config = TOAST_TONES[tone] ?? TOAST_TONES.info;
    const resolvedDuration = duration ?? config.duration;

    const toast = {
      id: (toastId += 1),
      tone: config.tone,
      icon: config.icon,
      title: String(title ?? ''),
      message: message ? String(message) : null,
      actionLabel,
      onAction,
      duration: resolvedDuration,
    };

    store.setState((prev) => {
      const duplicate = prev.toasts.find((item) => item.title === toast.title && !item.message);
      if (duplicate) {
        return {
          toasts: prev.toasts.map((item) =>
            item.id === duplicate.id
              ? { ...item, count: (item.count ?? 1) + 1, tone: toast.tone, icon: toast.icon }
              : item
          ),
        };
      }

      // Keep the newest at the end; evict from the front when over the limit.
      const next = [...prev.toasts, toast];
      return { toasts: next.slice(Math.max(0, next.length - MAX_TOASTS)) };
    });

    return toast.id;
  }

  /** @param {number} id */
  function dismissToast(id) {
    store.setState((prev) => ({ toasts: prev.toasts.filter((toast) => toast.id !== id) }));
  }

  function clearToasts() {
    store.setState({ toasts: [] });
  }

  const selectToasts = store.select(({ toasts }) => toasts);
  const selectOverlayIds = store.select(({ overlays }) => overlays.map((item) => item.id));

  return {
    ...store,
    openOverlay,
    closeOverlay,
    closeAllOverlays,
    isOverlayOpen,
    topOverlay,
    pushToast,
    dismissToast,
    clearToasts,
    selectToasts,
    selectOverlayIds,
  };
}

export default { createUiStore, TOAST_TONES };