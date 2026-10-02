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
import { icon } from '../../utils/icons.js';
import { formatMoney, formatMoneyPrecise } from '../../utils/format.js';
import { button } from '../ui/button.js';
import { stepper } from '../forms/stepper.js';
import { createPanel } from '../feedback/overlay.js';
import { emptyCartState } from '../feedback/states.js';
import { shippingHint } from '../product/price.js';

/** Why a line is flagged, in the shopper's words. */
const UNAVAILABLE_COPY = {
  missing: 'This product is no longer available',
  inactive: 'This option has been withdrawn',
  'sold-out': 'Sold out while it was in your cart',
};

/** How long the row takes to fade, before it is removed from the store. */
const REMOVE_MS = 180;

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
        inner.append(shippingProgress(cart.selectShippingProgress(), lines.length > 0));

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
        cart.subscribe(() => {
          if (panel.isOpen) draw();
        })
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
    for (const line of lines) list.append(cartLine(line));
    return list;
  }

  function cartLine(line) {
    const flagged = Boolean(line.unavailableReason);
    const href = `/product.html?slug=${encodeURIComponent(line.slug)}`;

    const remove = button({
      variant: 'quiet-danger',
      size: 'sm',
      iconOnly: true,
      icon: 'trash',
      label: `Remove ${line.name} from cart`,
      className: 'cart-line__remove',
    }).element;

    const root = el('li.cart-line', {
      className: flagged ? 'cart-line cart-line--flagged' : 'cart-line',
    });

    root.append(
      el('div.cart-line__top', {}, [
        el('a.cart-line__media', { href, tabindex: '-1', 'aria-hidden': 'true' }, [
          line.image
            ? el('img', { src: line.image, alt: '', width: 96, height: 120, loading: 'lazy' })
            : el('div.skeleton.skeleton--text', { style: 'block-size:100%' }),
        ]),
        el('div.cart-line__body', {}, [
          el('div.cart-line__top', {}, [
            el('a.cart-line__name', { href, text: line.name }),
            remove,
          ]),
          line.variantName
            ? el('p.cart-line__variant', {}, [
                el('span.cart-line__variant-dot', { 'aria-hidden': 'true' }),
                line.variantName,
              ])
            : null,
          flagged ? flagNote(line.unavailableReason) : null,
        ]),
      ]),

      el('div.cart-line__bottom', {}, [
        flagged
          ? el('span.cart-line__flag', {}, [icon('info'), UNAVAILABLE_COPY[line.unavailableReason]])
          : el('span.cart-line__unit', { text: `${formatMoneyPrecise(line.unitPrice)} each` }),
        flagged
          ? el('span.cart-line__total', { text: formatMoney(line.lineTotal) })
          : stepper({
              value: line.quantity,
              min: 1,
              max: line.maxQuantity,
              small: true,
              label: `Quantity for ${line.name}`,
              onChange: (next) => cart.setQuantity(line.variantId, next),
            }).element,
      ])
    );

    remove.addEventListener('click', () => {
      // Fade first, then mutate. Removing from the store immediately would make
      // the list jump, and the animation is the only evidence the tap landed.
      root.classList.add('is-removing');
      setTimeout(() => cart.remove(line.variantId), REMOVE_MS);

      toasts?.pushToast({
        title: `${line.name} removed`,
        tone: 'info',
        actionLabel: 'Undo',
        onAction: () => cart.restoreLine(line),
      });
    });

    return root;
  }

  function summary() {
    const subtotal = cart.selectSubtotal();
    const progress = cart.selectShippingProgress();

    return el('div.cart__summary', {}, [
      el('dl', {}, [
        el('div.cart__row', {}, [el('dt', { text: 'Subtotal' }), el('dd', { text: formatMoney(subtotal) })]),
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
      button({ label: 'View full cart', href: '/cart.html', variant: 'ghost', block: true }).element,
    ];
  }
}

function flagNote(reason) {
  return el('p.cart-line__sku', { text: UNAVAILABLE_COPY[reason] ?? 'No longer available' });
}

/**
 * The free-delivery nudge.
 *
 * `role="progressbar"` with the value in the attributes, because a shrinking
 * gap is exactly the kind of change that needs announcing - and it is only
 * re-rendered on real cart changes, so it is not announced on every keystroke.
 */
function shippingProgress(progress, visible) {
  const node = el('div.cart__progress', {
    ...(visible ? {} : { hidden: true }),
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(progress.percent),
    'aria-valuetext': shippingHint(progress.remaining),
  });

  node.append(
    el('p.cart__progress-text', {}, [
      progress.qualifies
        ? icon('truck', { className: 'cart__progress-icon' })
        : el('strong', { text: shippingHint(progress.remaining) }),
    ]),
    el('div.cart__progress-track', {}, [
      el('div.cart__progress-bar', { style: `inline-size:${progress.percent}%` }),
    ])
  );

  return node;
}

export default { createCartDrawer };