/**
 * Cart drawer.
 *
 * A drawer rather than a page, because the overwhelmingly common reason to open
 * the cart is to confirm one thing - "did it go in?" - and a page load for that
 * is a needless context switch. The full cart page remains the right place for
 * comparing lines or editing an address, so the drawer links onward to it.
 *
 * Two decisions worth stating:
 *
 *   1. IT SUBSCRIBES, IT DOES NOT POLL. Every mutation goes through the cart
 *      store and the drawer redraws from it. That is what lets "add to cart"
 *      from a card three components away update this drawer without any of them
 *      knowing the other exists.
 *   2. LINES THAT CANNOT BE BOUGHT ARE KEPT AND FLAGGED. If the catalogue says
 *      a variant is gone, the line stays with the reason and an explicit remove
 *      control. Deleting it would make the basket change with no explanation.
 *
 * Checkout belongs to a later phase, so the primary action states that instead
 * of pretending to submit an order.
 */
import { el, clear } from '../../core/dom.js';
import { formatMoney } from '../../utils/format.js';
import { button } from '../ui/button.js';
import { createPanel } from '../feedback/overlay.js';
import { emptyCartState } from '../feedback/states.js';
import { cartLineItem, cartShippingProgress } from './cart-line.js';

/**
 * @param {object} options
 * @param {object} options.cart    cart store
 * @param {object} [options.toasts] ui store, for the undo confirmation
 * @param {Function} [options.onCheckout]
 * @returns {{ panel: object, open(options?): void, close(): void, destroy(): void }}
 */
export function createCartDrawer({ cart, toasts = null, onCheckout = null }) {
  const panel = createPanel({
    id: 'cart',
    variant: 'drawer',
    position: 'end',
    title: 'Your cart',
    headingLevel: 'h2',
    render: (context) => {
      const inner = el('div.cart-panel');

      function draw() {
        clear(inner);

        const lines = cart.selectLines();
        inner.append(cartShippingProgress(cart.selectShippingProgress(), lines.length > 0));

        if (cart.selectSyncStatus() === 'error') {
          inner.append(syncErrorBanner({ cart }));
        } else if (cart.selectSyncStatus() === 'syncing') {
          inner.append(syncNote());
        }

        if (lines.length === 0) {
          inner.append(emptyCartState());
          context.footer.replaceChildren(
            button({
              label: 'Continue shopping',
              href: '/collection.html',
              variant: 'secondary',
              block: true,
            }).element
          );
          return;
        }

        inner.append(lineList(lines));
        inner.append(summary());
        context.footer.replaceChildren(...footerActions());
      }

      // Drawn once immediately so opening the drawer never shows an empty frame.
      // The panel body is replaced wholesale on each change, which also means
      // every listener inside it is discarded with its node - nothing leaks and
      // nothing needs a teardown list.
      draw();

      context.onCleanup(
        // Redrawn whether or not the drawer is open. Guarding on `panel.isOpen`
        // would leave the drawer showing the basket as it was when it was last
        // opened, and the comment above promises that is never visible.
        cart.subscribe(draw)
      );

      return inner;
    },
  });

  return {
    panel,
    /** @param {{ trigger?: HTMLElement }} [options] */
    open: (options) => panel.open(options),
    close: () => panel.close(),
    toggle: (options) => (panel.isOpen ? panel.close() : panel.open(options)),
    destroy: () => panel.destroy(),
  };

  /* ---------------------------------------------------------------------- */

  function lineList(lines) {
    const list = el('ul.cart__lines', { role: 'list' });
    for (const line of lines) list.append(cartLineItem({ line, cart, toasts }));
    return list;
  }

  /** "The cart and the server are talking." — shown while a sync is in flight. */
  function syncNote() {
    return el('p.cart__note', { role: 'status', text: 'Syncing your cart…' });
  }

  /**
   * A sync failed. The basket shown is the optimistic one (or the last
   * confirmed one), and retry re-reads the authoritative server cart.
   */
  function syncErrorBanner({ cart }) {
    const retry = button({
      label: 'Retry',
      variant: 'ghost',
      size: 'sm',
      onClick: () => cart.hydrate(),
    }).element;

    return el('div.form-alert.form-alert--error', { role: 'alert' }, [
      el('div', {}, [el('p', { text: 'Your cart could not be saved to the server.' }), retry]),
    ]);
  }

  function summary() {
    const subtotal = cart.selectSubtotal();
    const progress = cart.selectShippingProgress();

    return el('div.cart__summary', {}, [
      el('dl', {}, [
        el('div.cart__row', {}, [
          el('dt', { text: 'Subtotal' }),
          el('dd', { text: formatMoney(subtotal) }),
        ]),
        // Stated as unknown rather than invented. A made-up delivery fee becomes
        // a support ticket the moment it disagrees with the real one.
        el('div.cart__row.cart__row--muted', {}, [
          el('dt', { text: 'Delivery' }),
          el('dd', { text: 'Calculated at checkout' }),
        ]),
        el('div.cart__row.cart__row--total', {}, [
          el('dt', { text: 'Total' }),
          el('dd', { text: formatMoney(subtotal) }),
        ]),
      ]),
      el('p.cart__note', { text: 'Taxes included. Nothing is charged on this page.' }),
      progress.qualifies
        ? el('p.cart__note', { text: 'This order qualifies for free delivery.' })
        : el('p.cart__note', { text: `Add ${formatMoney(progress.remaining)} for free delivery.` }),
    ]);
  }

  function footerActions() {
    const checkout = button({
      label: 'Checkout',
      variant: 'primary',
      block: true,
      disabled: cart.selectCount() === 0,
    }).element;

    if (onCheckout) {
      checkout.addEventListener('click', () => onCheckout());
    } else {
      // `aria-disabled` rather than `disabled`: a disabled button cannot be
      // focused, so a keyboard user would never discover why it is unavailable.
      // It stays operable and explains itself.
      checkout.setAttribute('aria-disabled', 'true');
      checkout.title = 'Checkout arrives in a later phase';
      const note = el('p.cart__note.cart__note--inline', {
        role: 'status',
        // Focusable so focus can move here after the swap: a `role="status"`
        // region that never receives focus is announced inconsistently, and the
        // shopper's focus would otherwise be lost with the replaced button.
        tabindex: '-1',
        text: 'Checkout is not available in this build yet.',
      });
      checkout.addEventListener('click', () => {
        checkout.replaceWith(note);
        note.focus();
      });
    }

    return [
      checkout,
      button({ label: 'View full cart', href: '/cart.html', variant: 'ghost', block: true })
        .element,
    ];
  }
}

export default { createCartDrawer };
