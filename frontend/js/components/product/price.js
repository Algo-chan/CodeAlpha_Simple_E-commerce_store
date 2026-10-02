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
  const wasOnSale =
    compareAt !== null && compareAt !== undefined && Number(compareAt) > amount;

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
    node.append(
      el('span.price__from.price__from--range', { text: `– ${formatMoney(upper)}` })
    );
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

export default { price, shippingHint };