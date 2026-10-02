/**
 * Shared cart line and free-delivery meter.
 *
 * These live outside `cart-drawer.js` because two surfaces render the same
 * basket: the drawer and the cart page. A line that says "sold out while it was
 * in your cart" in one place and silently disappears in the other would be worse
 * than either behaviour, so both surfaces render from here.
 *
 * Neither function keeps a teardown list. Callers redraw their body wholesale on
 * every change, which discards these nodes - and with them every listener inside
 * them - so there is nothing to clean up.
 */
import { el, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatMoney, formatMoneyPrecise } from '../../utils/format.js';
import { button } from '../ui/button.js';
import { stepper } from '../forms/stepper.js';
import { shippingHint } from '../product/price.js';

/** Why a line is flagged, in the shopper's words. */
export const UNAVAILABLE_COPY = {
  missing: 'This product is no longer available',
  inactive: 'This option has been withdrawn',
  'sold-out': 'Sold out while it was in your cart',
};

/** How long the row takes to fade, before it is removed from the store. */
const REMOVE_MS = 180;

/**
 * One row of the basket.
 *
 * @param {object} options
 * @param {object} options.line    a `selectLines()` entry
 * @param {object} options.cart    cart store, mutated in place
 * @param {object} [options.toasts] ui store, for the undo confirmation
 * @param {string} [options.className] extra class for page-level styling
 * @returns {HTMLElement}
 */
export function cartLineItem({ line, cart, toasts = null, className = '' }) {
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
    className: ['cart-line', flagged ? 'cart-line--flagged' : null, className || null]
      .filter(Boolean)
      .join(' '),
  });

  root.append(
    el('div.cart-line__top', {}, [
      // `aria-hidden` plus `tabindex="-1"`: the product name is already a link
      // in the same row, so a second link to the same product would announce
      // twice and add a redundant tab stop.
      el('a.cart-line__media', { href, tabindex: '-1', 'aria-hidden': 'true' }, [
        line.image
          ? el('img', { src: line.image, alt: '', width: 96, height: 120, loading: 'lazy' })
          : el('div.skeleton', { style: 'block-size:100%' }),
      ]),
      el('div.cart-line__body', {}, [
        el('div.cart-line__top', {}, [el('a.cart-line__name', { href, text: line.name }), remove]),
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

  on(remove, 'click', () => {
    // Fade first, then mutate. Removing from the store immediately would make the
    // list jump, and the animation is the only evidence the tap landed.
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

function flagNote(reason) {
  return el('p.cart-line__sku', { text: UNAVAILABLE_COPY[reason] ?? 'No longer available' });
}

/**
 * The free-delivery nudge.
 *
 * `role="progressbar"` with the value in the attributes, because a shrinking gap
 * is exactly the kind of change that needs announcing - and it is only re-rendered
 * on real cart changes, so it is not announced on every keystroke.
 *
 * @param {{ percent:number, remaining:number, qualifies:boolean }} progress
 * @param {boolean} visible  hidden entirely when the basket is empty
 * @returns {HTMLElement}
 */
export function cartShippingProgress(progress, visible) {
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
