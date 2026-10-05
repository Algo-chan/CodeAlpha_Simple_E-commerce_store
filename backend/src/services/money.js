/**
 * Money helpers.
 *
 * ALL MONETARY ARITHMETIC IS INTEGER ARITHMETIC.
 *
 * Prices are stored and transported as integer minor units (ETB cents), the
 * same convention the database uses. Nothing in this file divides by 100, and
 * nothing accepts a float price: a discount percentage is the one place a
 * fraction is unavoidable, so it is computed in integers and rounded once, at a
 * documented point, rather than letting binary floating point decide what a
 * customer is charged.
 *
 * The formatter lives in the frontend (`utils/format.js`) because it needs
 * `Intl`. This module exists only to produce the numbers a view model carries.
 */

/**
 * Discount percentage, rounded to a whole percent.
 *
 * Rounded DOWN deliberately. A "23% off" badge on a 9% rounding artefact reads as
 * a rounding bug to anyone who checks, and rounding down can never overstate the
 * saving.
 *
 * The denominator is the COMPARE-AT price, not the sale price. "Was 10,000, now
 * 7,500" is a 25% discount; dividing by the sale price instead would report 33%,
 * which is the percentage the sale price represents relative to the original — a
 * number that is true but is not what anyone means by "off". It is the single most
 * commonly miscalculated figure in a shop, because the wrong version still produces
 * a plausible-looking integer.
 *
 * Returns `null`, not `0`, when there is nothing to advertise. `0` would be a real
 * zero-percent discount, and a badge is rendered from truthiness, so `null` keeps
 * "no discount" and "discounted by nothing" indistinguishable — which they are.
 *
 * @param {number|null} priceMinor       current price
 * @param {number|null} compareAtMinor   "was" price, must be above `priceMinor`
 * @returns {number|null} whole percent, or null when there is no real discount
 */
export function discountPercent(priceMinor, compareAtMinor) {
  if (priceMinor === null || priceMinor === undefined) return null;
  if (compareAtMinor === null || compareAtMinor === undefined) return null;
  // A "was" price at or below the sale price is bad data, not a 100% discount.
  if (compareAtMinor <= priceMinor) return null;
  if (priceMinor <= 0) return null;

  // Integer maths throughout: ((was - now) * 100) / was, truncated.
  const numerator = (compareAtMinor - priceMinor) * 100;
  return Math.floor(numerator / compareAtMinor);
}

/**
 * Line total. An integer multiply — no rounding step exists to get wrong.
 *
 * @param {number|null} unitPriceMinor
 * @param {number} quantity
 * @returns {number|null}
 */
export function lineTotalMinor(unitPriceMinor, quantity) {
  if (unitPriceMinor === null || unitPriceMinor === undefined) return null;
  const units = Number(quantity);
  if (!Number.isInteger(units) || units < 0) return null;
  return unitPriceMinor * units;
}

/**
 * Whether a price is a plausible minor-unit amount.
 *
 * Guards the public endpoints against a nonsense filter such as
 * `?minPrice=99999999999999999999`, which would otherwise become a `BIGINT`
 * comparison the database has to defend against.
 *
 * The ceiling matches `product_variants_price_sane` (1,000,000,000,000 minor
 * units = 10 billion ETB) from migration 007.
 */
export const MAX_PRICE_MINOR = 1_000_000_000_000;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidPriceMinor(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PRICE_MINOR;
}

export default { discountPercent, lineTotalMinor, isValidPriceMinor, MAX_PRICE_MINOR };
