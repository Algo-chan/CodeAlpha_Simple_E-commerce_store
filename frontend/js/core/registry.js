/**
 * Component registry.
 *
 * A page imports the components it needs and renders them explicitly:
 *
 *   import { ProductCard } from '../components/product-card.js';
 *   const card = ProductCard({ product });
 *   container.append(card);
 *
 * Each component is a factory function `(props) => HTMLElement` that returns a
 * DOM node. Keeping the convention uniform means any component can be swapped,
 * reused or tested in isolation later - without a framework.
 *
 * Planned components (each in its own file):
 *   navbar, footer, product-card, product-gallery, search, filter-panel,
 *   cart-drawer, modal, toast, loading-skeleton, pagination, button, form fields
 */

/**
 * Registers a component factory under a name.
 * @param {string} name
 * @param {(props: object) => HTMLElement} factory
 */
export function register(name, factory) {
  if (typeof factory !== 'function') {
    throw new TypeError(`Component "${name}" must be registered with a factory function.`);
  }
  components.set(name, factory);
}

/** Renders a registered component by name. */
export function render(name, props = {}) {
  const factory = components.get(name);
  if (!factory) {
    throw new Error(`Component "${name}" is not registered.`);
  }
  return factory(props);
}

/** True when a component has been registered. */
export function has(name) {
  return components.has(name);
}

/** @type {Map<string, (props: object) => HTMLElement>} */
const components = new Map();

export default { register, render, has };
