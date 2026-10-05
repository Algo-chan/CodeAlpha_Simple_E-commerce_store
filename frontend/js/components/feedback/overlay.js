/**
 * The overlay controller.
 *
 * One manager for every panel, drawer, modal and sheet in the storefront. It
 * owns the parts that are easy to get subtly wrong when each component does
 * them itself:
 *
 *   - INERTNESS. While an overlay is open, everything outside it gets `inert`
 *     and `aria-hidden`. Without this, a screen reader user can tab from the
 *     cart drawer straight into the page behind it.
 *   - SCROLL LOCK, COUNTED. Two overlays can be open at once, so the lock is
 *     reference counted rather than a boolean.
 *   - FOCUS. Trapped inside the panel, restored to the trigger on close, and
 *     Escape handled only for the topmost panel.
 *   - URL AND HISTORY. Opening a panel pushes history state so the browser Back
 *     button closes it, which shoppers expect and which costs nothing here.
 *
 * Panels are declarative: give `mount` a list of definitions and it wires them.
 */
import { el, qs, qsa, on, nextFrame } from '../../core/dom.js';
import { trapFocus, focusPanel } from '../../utils/focus-trap.js';
import { lockScroll } from '../../utils/scroll-lock.js';
import { button } from '../ui/button.js';

/** Panels that render as a centred dialog, a side drawer or a bottom sheet. */
export const PANEL_VARIANTS = Object.freeze(['modal', 'drawer', 'sheet']);

/** @type {Map<string, object>} every mounted panel, keyed by id */
const registry = new Map();

/**
 * Creates and registers a panel.
 *
 * @param {object} options
 * @param {string} options.id             stable id, also the history state key
 * @param {'modal'|'drawer'|'sheet'} [options.variant]
 * @param {string} [options.position]     for drawers: 'start' | 'end'
 * @param {string} options.title          announced name; required
 * @param {string} [options.subtitle]
 * @param {string} [options.headingLevel] 'h2' by default
 * @param {(context: PanelContext) => Node} options.render
 * @param {boolean} [options.dismissible]
 * @param {(isOpen: boolean) => void} [options.onToggle]
 * @returns {object} panel handle
 */
export function createPanel({
  id,
  variant = 'drawer',
  position = 'end',
  title,
  subtitle = null,
  headingLevel = 'h2',
  render,
  dismissible = true,
  isInitiallyOpen = false,
  onToggle,
}) {
  if (!title) throw new Error(`Panel "${id}" needs a title: it is the accessible name.`);

  if (registry.has(id)) return registry.get(id);

  const state = { isOpen: false, releaseFocus: null, releaseScroll: null, cleanups: [] };

  /* --- DOM ------------------------------------------------------------------ */

  const body = el('div.overlay__body');
  const subtitleNode = subtitle ? el('p.overlay__subtitle', { text: subtitle }) : null;

  const panel = el(
    'div.overlay__panel',
    {
      id: `${id}-panel`,
      className: buildPanelClass(variant, position),
      // Every variant is a dialog. A drawer and a sheet are dialogs that happen
      // to be anchored to an edge; giving them `role="region"` would drop the
      // modal semantics the rest of this component depends on.
      role: 'dialog',
      // `aria-modal` is a promise, not a decoration: it tells assistive tech the
      // rest of the page is unavailable. It is only valid while open, so it is
      // added on open and removed on close.
      'aria-labelledby': `${id}-title`,
      tabindex: '-1',
    },
    [
      // A grip is decorative; the panel is opened and closed with buttons.
      variant === 'sheet' ? el('div.overlay__grip', { 'aria-hidden': 'true' }) : null,
      el('div.overlay__header', {}, [
        el('div.overlay__heading', {}, [
          el(`${headingLevel}.overlay__title`, { id: `${id}-title`, text: title }),
          subtitleNode,
        ]),
        dismissible
          ? button({
              variant: 'ghost',
              size: 'sm',
              icon: 'close',
              iconOnly: true,
              label: `Close ${title.toLowerCase()}`,
              className: 'overlay__close',
              onClick: () => api.close(),
            }).element
          : null,
      ]),
      body,
      el('div.overlay__footer', { 'data-overlay-footer': '' }),
    ]
  );

  const scrim = el('div.overlay__scrim', {
    onclick: dismissible ? () => api.close() : null,
    'aria-hidden': 'true',
  });

  const root = el(
    'div.overlay',
    {
      id: `${id}-overlay`,
      className: `overlay--${variant}`,
      // Hidden, not `display:none`, so the panel can animate in without a
      // second layout pass. `hidden` is removed on open.
      hidden: true,
      'data-overlay': id,
    },
    [scrim, panel]
  );

  /* --- Context handed to the render function --------------------------------- */

  const context = {
    id,
    panel,
    body,
    footer: qs('[data-overlay-footer]', panel),
    close: () => api.close(),
    /**
     * Registers teardown work. Accepts a function or an array of them, because
     * a component registering four listeners should not need four calls - and
     * passing an array is the natural way to write that.
     */
    onCleanup: (fn) => state.cleanups.push(...[fn].flat()),
  };

  const content = render(context);
  if (content) body.append(content);

  document.body.append(root);

  /* --- Wiring ---------------------------------------------------------------- */

  // Escape and scrim click are handled centrally so stacked panels behave.
  state.cleanups.push(
    on(document, 'keydown', (event) => {
      if (event.key !== 'Escape' || !state.isOpen) return;
      // Only the topmost panel reacts, otherwise one Escape closes everything.
      // "Topmost" is the last one in DOM order: panels are appended as they are
      // created, so document order is not the order they were opened in, and the
      // first match is whichever panel happened to be created first.
      const openPanels = qsa('.overlay:not([hidden])', document);
      if (openPanels[openPanels.length - 1] !== root) return;
      if (dismissible) {
        event.preventDefault();
        api.close();
      }
    })
  );

  state.cleanups.push(
    on(globalThis, 'popstate', (_event) => {
      // Back closed this panel, so mirror it in our own state.
      if (state.isOpen && !isTargetOfHistoryState(id)) api.close({ fromHistory: true });
    })
  );

  /* --- API ------------------------------------------------------------------- */

  const api = {
    id,
    element: root,
    panel,
    body,
    footer: context.footer,

    get isOpen() {
      return state.isOpen;
    },

    /**
     * @param {{ trigger?: HTMLElement }} [options] `trigger` is where focus
     *        returns to; defaults to whatever was focused when the panel opened
     */
    open({ trigger } = {}) {
      if (state.isOpen) return api;

      state.isOpen = true;
      root.hidden = false;
      root.setAttribute('aria-hidden', 'false');
      panel.setAttribute('aria-modal', 'true');
      onToggle?.(true);

      // Inert everything outside before moving focus, so no focus event lands
      // on a page element that is about to become inert.
      syncInertness();

      state.releaseScroll = lockScroll();
      pushHistoryState(id);

      requestAnimationFrame(() => {
        root.classList.add('is-open');
        state.releaseFocus = trapFocus(panel, {
          // Focusing the panel rather than the first control means the title is
          // announced before a long form.
          initialFocus: qs('[data-autofocus]', panel) ?? undefined,
          returnFocusTo: trigger,
        });
        focusPanel(panel);
      });

      return api;
    },

    close({ fromHistory = false } = {}) {
      if (!state.isOpen) return api;

      state.isOpen = false;
      root.classList.remove('is-open');
      panel.removeAttribute('aria-modal');
      onToggle?.(false);

      const finish = () => {
        root.hidden = true;
        root.setAttribute('aria-hidden', 'true');
        // Recomputed rather than toggled: another panel may still be open, and
        // this one may have been the reason an underlying panel was inert.
        syncInertness();

        state.releaseScroll?.();
        state.releaseScroll = null;
      };

      state.releaseFocus?.();
      state.releaseFocus = null;

      // Guarded on purpose: in tests, or on a fresh load, there may be no
      // history entry to pop, and calling back() anyway would navigate the
      // page out from under the panel.
      if (!fromHistory && isTargetOfHistoryState(id)) globalThis.history?.back();

      nextFrame().then(finish);
      return api;
    },

    toggle(options) {
      return state.isOpen ? api.close() : api.open(options);
    },

    /** Replaces the panel body. Used when the content depends on state. */
    setContent(node) {
      body.replaceChildren(node);
    },

    destroy() {
      state.cleanups.forEach((fn) => fn());
      api.close();
      root.remove();
      registry.delete(id);
    },
  };

  registry.set(id, api);
  if (isInitiallyOpen) api.open();

  return api;
}

/** @param {string} id */
export function getPanel(id) {
  return registry.get(id) ?? null;
}

/** Closes every open panel, topmost first. */
export function closeAllPanels() {
  Array.from(document.querySelectorAll('.overlay:not([hidden])'))
    .reverse()
    .forEach((root) => registry.get(root.dataset.overlay)?.close());
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

function buildPanelClass(variant, position) {
  const base = 'overlay__panel';
  if (variant === 'drawer') return `${base} ${base}--drawer-${position}`;
  return `${base} ${base}--${variant}`;
}

/**
 * Recomputes which parts of the page are inert, from the set of currently open
 * panels rather than from a counter.
 *
 * A counter or a paired enable/disable cannot express the stacked case: with the
 * cart drawer open and the quick view on top of it, the drawer's own root is
 * inert, so un-inerting "the background" on close either skips the drawer (leaving
 * it unusable) or clears the page while a panel is still on screen. Deriving the
 * answer from the DOM each time makes both cases fall out for free.
 *
 * `inert` is the correct tool and is supported in every current browser. The
 * `aria-hidden` fallback covers older engines - and the is-open guard matters,
 * because aria-hidden on a node containing the focus is an ARIA violation that
 * throws focus to the body and loses the shopper's place.
 */
function syncInertness() {
  const open = qsa('.overlay:not([hidden])', document);

  if (open.length === 0) delete document.body.dataset.overlayOpen;
  else document.body.dataset.overlayOpen = 'true';

  for (const sibling of document.body.children) {
    if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue;

    if (open.includes(sibling)) {
      sibling.removeAttribute('inert');
      sibling.removeAttribute('aria-hidden');
    } else {
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
  }
}

function pushHistoryState(id) {
  try {
    globalThis.history?.pushState({ overlay: id }, '');
  } catch {
    // Some sandboxed contexts disallow pushState. Losing Back-button support
    // is acceptable; breaking the panel is not.
  }
}

function isTargetOfHistoryState(id) {
  try {
    return globalThis.history?.state?.overlay === id;
  } catch {
    return false;
  }
}

export default { createPanel, getPanel, closeAllPanels, PANEL_VARIANTS };
