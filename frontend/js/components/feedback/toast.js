/**
 * Toasts.
 *
 * A live region with a polite queue. Three rules that matter:
 *
 *   1. NEVER MOVE FOCUS. A toast that steals focus yanks a shopper out of the
 *      quantity field they are typing in. The message is announced through the
 *      live region instead.
 *   2. NO IMPORTANT MESSAGES ONLY IN A TOAST. An error the shopper must act on
 *      belongs inline next to the thing that failed. Toasts confirm and inform.
 *   3. TIMED, BUT PAUSABLE. Hovering or focusing a toast stops the timer, so a
 *      message can be read at the pace it is written to be read.
 *
 * Toasts are rendered from the ui store's queue, so any module can raise one
 * without holding a reference to this component.
 */
import { el, delegate, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';

/** Wait this long before a toast may be dismissed, so it cannot be missed. */
const MIN_VISIBLE_MS = 2400;

export function createToastRegion({ store }) {
  const region = el('div.toast-region', {
    // `polite` rather than `assertive`: a confirmation should not interrupt.
    role: 'region',
    'aria-live': 'polite',
    'aria-label': 'Notifications',
  });

  /** @type {Map<number, { node: HTMLElement, timer: number|null, expiresAt: number }>} */
  const live = new Map();

  function render(toasts) {
    // Remove toasts the store no longer has.
    for (const [id, entry] of live) {
      if (!toasts.some((toast) => toast.id === id)) {
        clearTimeout(entry.timer);
        entry.node.remove();
        live.delete(id);
      }
    }

    for (const toast of toasts) {
      if (live.has(toast.id)) continue;

      const { node, timer } = buildToast(toast);
      region.append(node);
      live.set(toast.id, { node, timer, expiresAt: Date.now() + toast.duration });

      if (toast.duration > 0 && !prefersReducedMotion()) {
        live.get(toast.id).timer = setTimeout(() => store.dismissToast(toast.id), toast.duration);
      }
    }
  }

  function buildToast(toast) {
    const node = el(`div.toast.toast--${toast.tone}`, {
      dataset: { toastId: String(toast.id) },
      // A toast that auto-dismisses must not also be the only record of the
      // action, so it exposes an explicit close.
      role: toast.tone === 'error' ? 'alert' : 'status',
    });

    node.append(el('span.toast__icon', { 'aria-hidden': 'true' }, [icon(toast.icon)]));
    node.append(
      el('div.toast__content', {}, [
        el('p.toast__title', { text: toast.title }),
        toast.message ? el('p.toast__message', { text: toast.message }) : null,
      ])
    );

    if (toast.actionLabel) {
      node.append(
        el('button.toast__action', {
          type: 'button',
          text: toast.actionLabel,
          onClick: () => {
            toast.onAction?.();
            store.dismissToast(toast.id);
          },
        })
      );
    }

    node.append(
      el('button.toast__close', {
        type: 'button',
        'aria-label': 'Dismiss notification',
        onClick: () => store.dismissToast(toast.id),
      }, [icon('close')])
    );

    // Hovering or tabbing into a toast pauses its timer.
    const pause = () => {
      const entry = live.get(toast.id);
      if (!entry?.timer) return;
      clearTimeout(entry.timer);
      entry.timer = null;
    };
    const resume = () => {
      const entry = live.get(toast.id);
      if (!entry || entry.timer !== null || toast.duration <= 0) return;
      const remaining = Math.max(MIN_VISIBLE_MS, entry.expiresAt - Date.now());
      entry.timer = setTimeout(() => store.dismissToast(toast.id), remaining);
    };
    node.addEventListener('mouseenter', pause);
    node.addEventListener('focusin', pause);
    node.addEventListener('mouseleave', resume);
    node.addEventListener('focusout', resume);

    return { node, timer: null };
  }

  // One delegated listener instead of three per toast.
  const cleanups = [
    delegate(region, 'click', '.toast__close', (_event, matched) => {
      store.dismissToast(Number(matched.closest('[data-toast-id]')?.dataset.toastId));
    }),
    // Escape clears the queue, which is what shoppers expect from a toast stack.
    on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && live.size > 0) store.clearToasts();
    }),
  ];

  const unsubscribe = store.subscribe(({ toasts }) => render(toasts), {
    selector: (state) => state.toasts,
    immediate: true,
  });

  region.destroy = () => {
    unsubscribe();
    cleanups.forEach((fn) => fn());
    for (const entry of live.values()) clearTimeout(entry.timer);
    region.remove();
  };

  return region;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export default { createToastRegion };