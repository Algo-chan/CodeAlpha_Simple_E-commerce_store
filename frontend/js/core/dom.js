/**
 * DOM helpers.
 *
 * Two ways to build nodes in this codebase, and the difference matters:
 *
 *   `el()`  - creates a node. Used by components.
 *   `html`  - a tagged template that returns a DocumentFragment. Used for
 *             larger static subtrees where element-by-element construction
 *             would be unreadable.
 *
 * `html` is NOT a general-purpose HTML injector. It escapes every interpolated
 * value by default (including arrays), so it is safe for product names, review
 * text and anything else that eventually comes from a user. To opt into raw
 * markup you must say so explicitly with the `raw()` helper, which exists
 * solely for trusted, build-time constants such as the icon sprite.
 */

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Creates an element.
 *
 * The tag may carry classes using the `tag.class.class` shorthand. Props:
 *   className   extra classes
 *   text        textContent (safe)
 *   dataset     data-* attributes
 *   html        raw innerHTML (trusted content only - prefer children)
 *   on<Event>   addEventListener handler, e.g. onClick
 *   ref         callback invoked with the node once it exists
 *   anything else becomes an attribute (false/null/undefined are skipped)
 *
 * @param {string} tag
 * @param {object} [props]
 * @param {Array<Node|string|null|undefined|false>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const [tagName, ...classes] = tag.split('.');
  const node = document.createElement(tagName || 'div');

  if (classes.length > 0) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'className') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(node);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }

  append(node, children);
  return node;
}

/**
 * Appends children; strings become text nodes, so there is no injection path.
 *
 * Trusted markup from `raw()` / `html` arrives as a DocumentFragment or a
 * RAW-tagged wrapper and is inserted as nodes. Handling it here - rather than in
 * every call site - is what stops `raw()` from silently rendering the string
 * "[object Object]" when it is passed to `el` directly, which is exactly how a
 * helper like the star rating would quietly render nothing.
 */
export function append(parent, children = []) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false || child === '') continue;

    if (child instanceof Node) {
      parent.append(child);
    } else if (typeof child === 'object' && RAW in child) {
      parent.append(fragmentFromMarkup(child[RAW]));
    } else {
      parent.append(document.createTextNode(String(child)));
    }
  }
  return parent;
}

/** Removes every child. */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/* -------------------------------------------------------------------------- */
/* Safe templating                                                             */
/* -------------------------------------------------------------------------- */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a value for safe interpolation into markup. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/**
 * Marks a string as pre-escaped, trusted markup.
 * Only ever use with build-time constants (icons, static fragments).
 *
 * The result is not a node: `append` recognises the RAW tag and parses it, so
 * the same value can be used inside an `html` template and inside `el` children.
 *
 * `toString` returns the markup, because that is what a helper concatenating
 * trusted markup expects; without it the value stringifies to "[object Object]"
 * while looking perfectly usable.
 * @param {string} value
 */
export function raw(value) {
  const markup = String(value ?? '');
  return { [RAW]: markup, toString: () => markup };
}

const RAW = Symbol('raw');

/**
 * Tagged template that escapes interpolations by default.
 *
 *   html`<p>${product.name}</p>`                 // escaped
 *   html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`
 *   html`<div>${raw(icon('cart'))}</div>`        // trusted
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {DocumentFragment}
 */
export function html(strings, ...values) {
  let markup = '';
  for (let index = 0; index < strings.length; index += 1) {
    markup += strings[index];
    if (index < values.length) markup += interpolate(values[index]);
  }
  return fragmentFromMarkup(markup);
}

function interpolate(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(interpolate).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  // A nested `html` template arrives as a fragment, and a fragment stringifies to
  // "[object DocumentFragment]" - so the nesting shown in the docs above rendered
  // that text instead of the list. Serialising it back is safe: the fragment came
  // out of `html`, so everything in it is already escaped.
  if (value instanceof DocumentFragment) return value.innerHTML;
  return escapeHtml(value);
}

/** Parses a markup string into a fragment. */
export function fragmentFromMarkup(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content;
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** `querySelector`, null-safe. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** `querySelectorAll` as a real array. */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Adds a listener and returns its remover.
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  const listener = handler;
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

/**
 * Event delegation: one listener on a container instead of N on children.
 * This is what keeps the product grid and filter panel cheap - adding 24 cards
 * costs one listener, not 24.
 *
 * @param {HTMLElement} root
 * @param {string} type
 * @param {string} selector
 * @param {(event: Event, matched: HTMLElement) => void} handler
 * @returns {() => void}
 */
export function delegate(root, type, selector, handler) {
  const listener = (event) => {
    const matched = event.target instanceof Element ? event.target.closest(selector) : null;
    if (matched && root.contains(matched)) handler(event, matched);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Resolves after the next paint. Used to measure after layout. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/* -------------------------------------------------------------------------- */
/* Environment                                                                 */
/* -------------------------------------------------------------------------- */

/** True when the user asked the OS to reduce motion. Read live, not cached. */
export function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** True on a device whose primary input is touch. */
export function isTouchDevice() {
  return globalThis.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;
}

/** Current viewport width. */
export function viewportWidth() {
  return globalThis.innerWidth ?? 1024;
}

/**
 * Above this width the desktop navigation is used and drawers become panels.
 * Mirrors the `--breakpoint-lg` token (64em) and the `64em` media queries.
 */
export const DESKTOP_BREAKPOINT_EM = 64;

/** @param {number} [em] */
export function isDesktop(em = DESKTOP_BREAKPOINT_EM) {
  if (!globalThis.matchMedia) return viewportWidth() >= em * 16;
  return globalThis.matchMedia(`(min-width: ${em}em)`).matches;
}

/** Reacts to a media query change. Returns a cleanup function. */
export function watchMedia(query, handler) {
  if (!globalThis.matchMedia) return () => {};
  const list = globalThis.matchMedia(query);
  const listener = (event) => handler(event.matches);
  list.addEventListener('change', listener);
  return () => list.removeEventListener('change', listener);
}

/* -------------------------------------------------------------------------- */
/* Focus                                                                       */
/* -------------------------------------------------------------------------- */

/** Elements that can receive focus, in DOM order. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** @returns {HTMLElement[]} */
export function getFocusable(root) {
  return qsa(FOCUSABLE_SELECTOR, root).filter(
    (node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true'
  );
}

/** Moves focus without scrolling the page under the user. */
export function focusSilently(node) {
  if (!node) return;
  node.focus({ preventScroll: true });
}

/** Moves focus and scrolls it into view (used when restoring after a close). */
export function focus(node) {
  if (!node) return;
  node.focus({ preventScroll: false });
}

/** Moves focus to the first focusable node, or the container itself. */
export function focusFirst(root) {
  const [first] = getFocusable(root);
  (first ?? root).focus({ preventScroll: true });
}

export default {
  el,
  append,
  clear,
  html,
  raw,
  escapeHtml,
  fragmentFromMarkup,
  qs,
  qsa,
  on,
  delegate,
  nextFrame,
  prefersReducedMotion,
  isTouchDevice,
  viewportWidth,
  isDesktop,
  watchMedia,
  getFocusable,
  focus,
  focusSilently,
  focusFirst,
};
