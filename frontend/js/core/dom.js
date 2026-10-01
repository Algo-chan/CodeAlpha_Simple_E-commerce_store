/**
 * Tiny DOM helpers.
 * Deliberately minimal: enough to build components without a framework,
 * without hiding how the DOM works.
 */

/**
 * Creates an element.
 * @param {string} tag - e.g. `'div'` or `'button.btn.btn--primary'`
 * @param {object} [props] - `className`, `text`, `html`, `dataset`, attributes...
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const [tagName, ...classes] = tag.split('.');
  const node = document.createElement(tagName || 'div');

  if (classes.length > 0) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;

    if (key === 'className') {
      node.className = [node.className, value].filter(Boolean).join(' ');
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }

  append(node, children);
  return node;
}

/** Appends children (strings become text nodes, so no HTML injection risk). */
export function append(parent, children = []) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Removes every child of a node. */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/** `document.querySelector` scoped to a root. */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/** `document.querySelectorAll` as a real array. */
export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * Loads an HTML partial into a container (used for Navbar / Footer so markup
 * lives in one place instead of being duplicated in every page).
 * @param {string} url - path inside `/partials`
 * @param {HTMLElement} target
 */
export async function loadPartial(url, target) {
  const response = await fetch(url, { headers: { Accept: 'text/html' } });
  if (!response.ok) {
    throw new Error(`Could not load partial "${url}" (${response.status})`);
  }
  target.innerHTML = await response.text();
  return target;
}

/**
 * Adds a listener and returns a function that removes it.
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export default { el, append, clear, qs, qsa, loadPartial, on };
