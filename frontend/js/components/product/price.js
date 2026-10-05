/**
 * Price display.
 *
 * One component, because a price is rendered in six places (card, product page,
 * quick view, cart line, cart total, order summary) and each of them writing its
 * own markup is how a storefront ends up with a struck-through compare-at price
 * in one place and a missing one in another.
 *
 * Two rules the markup enforces:
 *
 *   1. A range shows "from". A card listing ETB 400 - ETB 900 that simply
 *      printed "ETB 400" would be a lie of omission, because the shopper can
 *      only buy the cheaper option in some sizes and not in others.
 *   2. The compare-at price is `<del>`, not a styled span. It is text that has
 *      been cancelled, and assistive tech should say so.
 *
 * All inputs are ETB minor units. Nothing here does arithmetic on them.
 */
import { el } from '../../core/dom.js';
import { formatMoney } from '../../utils/format.js';

/**
 * @typedef {object} PriceOptions
 * @property {number|null} price          price in minor units
 * @property {number|null} [compareAt]    compare-at price in minor units
 * @property {number|null} [to]           upper bound; renders a "from" range
 * @property {'sm'|'md'|'lg'} [size]
 * @property {boolean} [showFrom]
 * @property {string} [className]
 */

/**
 * @param {PriceOptions} options
 * @returns {HTMLElement|null} null when there is no price to show
 */
export function price({
  price: value,
  compareAt = null,
  to = null,
  size = 'md',
  showFrom = true,
  className = '',
} = {}) {
  const amount = Number(value);
  if (value === null || value === undefined || !Number.isFinite(amount)) return null;

  const upper = Number(to);
  const isRange = Number.isFinite(upper) && upper > amount;
  const wasOnSale = compareAt !== null && compareAt !== undefined && Number(compareAt) > amount;

  // Built as one list rather than spread across conditional `className` keys:
  // duplicate keys in an object literal mean the last one silently wins, which
  // would drop `--lg` whenever a price was also on sale.
  const classes = [
    'price',
    size === 'lg' ? 'price--lg' : null,
    wasOnSale ? 'price--on-sale' : null,
    className || null,
  ].filter(Boolean);

  const node = el('div.price', { className: classes.join(' ') });

  // "From" leads, because that is the word carrying the meaning.
  if (isRange && showFrom) {
    node.append(el('span.price__from', { text: 'From' }));
  }

  node.append(el('span.price__current', { text: formatMoney(amount) }));

  if (isRange) {
    node.append(el('span.price__from.price__from--range', { text: `– ${formatMoney(upper)}` }));
  }

  if (wasOnSale) {
    node.append(
      el('del.price__compare', {
        text: formatMoney(compareAt),
        // A bare strikethrough gives no clue what the number was. This is
        // announced as "was ETB 900" instead.
        'aria-label': `Was ${formatMoney(compareAt)}`,
      })
    );
  }

  return node;
}

/**
 * The free-shipping hint. Extracted here because it is a money-adjacent string
 * that must stay consistent between the cart drawer and the product page.
 * @param {number} remainingMinor
 * @returns {string}
 */
export function shippingHint(remainingMinor) {
  if (remainingMinor <= 0) return 'Free delivery applied';
  return `${formatMoney(remainingMinor)} away from free delivery`;
}

/**
 * The availability line for a variant.
 *
 * Shared rather than duplicated, because "Sold out" is the string that decides
 * whether a shopper believes they can buy something. Two surfaces wording it
 * differently is how a product looks purchasable in a modal and unavailable on
 * the page behind it.
 *
 * @param {object} variant
 * @param {number|null} available `null` for digital goods, which are not tracked
 * @returns {HTMLElement}
 */
/**
 * A stock line for the selected variant.
 *
 * `available` is passed separately because the callers already hold it; the
 * variant object is still the source of the low-stock decision.
 *
 * @param {object} variant
 * @param {number|null} available null when stock is untracked
 * @returns {HTMLElement}
 */
export function stockLine(variant, available) {
  if (!variant.is_purchasable) {
    return el('p.stock-line.stock-line--out', {}, [el('span.stock-line__dot'), 'Sold out']);
  }

  // Untracked stock is not unlimited stock: it means the catalogue does not count
  // it, so the honest statement is that it is available, not that there are many.
  if (available === null) {
    return el('p.stock-line.stock-line--in', {}, [
      el('span.stock-line__dot'),
      variant.digital ? 'Available immediately' : 'Available to order',
    ]);
  }

  // `is_low_stock` comes from the API, which owns the threshold. Comparing
  // `available` against a local copy of that number is how the stock line ends up
  // disagreeing with the product card's badge on the same product.
  if (variant.is_low_stock === true) {
    return el('p.stock-line.stock-line--low', {}, [
      el('span.stock-line__dot'),
      `Only ${available} left`,
    ]);
  }

  return el('p.stock-line.stock-line--in', {}, [el('span.stock-line__dot'), 'In stock']);
}

export default { price, shippingHint, stockLine };
