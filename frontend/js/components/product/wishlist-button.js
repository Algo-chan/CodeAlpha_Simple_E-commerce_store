/**
 * Wishlist toggle.
 *
 * A `<button aria-pressed>` rather than a checkbox: this is a toggle action on
 * a resource, not a form field that will be submitted, and `aria-pressed`
 * states the result without requiring the user to remember whether they pressed
 * it or what the next press would do.
 *
 * The accessible name changes with state ("Save X" / "Saved"), because the
 * pressed state alone does not tell a screen reader user what pressing it again
 * would do. The visible label is the icon only; the icon fill is the state.
 *
 * State lives in the wishlist store and the button subscribes to a selector, so
 * one product can be saved from a card, the product page and the wishlist panel
 * and all three update together.
 */
import { el, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';

/**
 * @param {object} options
 * @param {string} options.productId
 * @param {string} options.name          product name, for the accessible label
 * @param {object} options.wishlist      wishlist store
 * @param {Function} [options.onToggle]  called with (saved, productId)
 * @param {string} [options.className]
 * @returns {{ element: HTMLElement, destroy(): void, isSaved(): boolean }}
 */
export function wishlistButton({ productId, name, wishlist, onToggle, className = '' }) {
  const id = String(productId);

  const element = el('button.wishlist-button', {
    type: 'button',
    'aria-pressed': 'false',
    className,
  });

  // The heart is the same node throughout; swapping it would restart the pop
  // animation's timing on every state change.
  element.append(icon('heart', { className: 'wishlist-button__icon' }));

  function labelFor(saved) {
    return saved ? `Remove ${name} from saved items` : `Save ${name}`;
  }

  function render(saved) {
    element.setAttribute('aria-pressed', String(saved));
    element.setAttribute('aria-label', labelFor(saved));
    element.title = saved ? 'Saved' : 'Save for later';
    element.classList.toggle('is-active', saved);
  }

  render(wishlist.has(id));

  const cleanups = [
    // Selector subscriber: handed the selected value, so a change anywhere else
    // in the wishlist does not repaint every button on the page.
    wishlist.subscribe(
      (saved) => render(saved),
      { selector: wishlist.selectIsSaved(id) }
    ),

    on(element, 'click', () => {
      const saved = wishlist.toggle(id);
      // The store has already notified by the time this runs, so `render` is
      // not called here - it would only duplicate the work.
      onToggle?.(saved, id);
    }),
  ];

  return {
    element,
    isSaved: () => wishlist.has(id),
    destroy() {
      cleanups.forEach((fn) => fn());
    },
  };
}

/**
 * A row of product names for a wishlist button that must toggle many at once,
 * e.g. a "Save all" control. Kept separate so the single-product button stays
 * small enough to read.
 *
 * @param {object} options
 * @param {Array<{id:string,name:string}>} options.products
 * @param {object} options.wishlist
 * @returns {{ element: HTMLElement, isSaved(): boolean, destroy(): void }}
 */
export function wishlistBulkButton({ products, wishlist }) {
  const ids = products.map((product) => String(product.id));
  const savedCount = () => ids.filter((id) => wishlist.has(id)).length;
  const allSaved = () => savedCount() === ids.length;

  const element = el('button.wishlist-button.wishlist-button--bulk', {
    type: 'button',
    'aria-pressed': 'false',
  });

  function render() {
    const saved = allSaved();
    element.setAttribute('aria-pressed', String(saved));
    element.setAttribute(
      'aria-label',
      saved ? 'Remove all from saved items' : 'Save all these items'
    );
  }

  render();

  const cleanups = [
    wishlist.subscribe(render),
    on(element, 'click', () => {
      // Toggle based on the majority state, not on "is the first one saved" -
      // otherwise saving a mixed batch can never save everything.
      const target = savedCount() * 2 > ids.length;
      ids.forEach((id) => {
        if (wishlist.has(id) !== target) wishlist.toggle(id);
      });
    }),
  ];

  return {
    element,
    isSaved: allSaved,
    destroy: () => cleanups.forEach((fn) => fn()),
  };
}

export default { wishlistButton, wishlistBulkButton };