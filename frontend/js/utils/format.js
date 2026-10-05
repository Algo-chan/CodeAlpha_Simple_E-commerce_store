/**
 * Formatting.
 *
 * MONEY IS THE IMPORTANT ONE.
 *
 * The database stores money as BIGINT in minor units (ETB cents) - 470000
 * means 4,700.00 ETB, and it is never a float anywhere in the stack. Every
 * formatter here therefore takes minor units and divides by 100 exactly once,
 * at the display boundary.
 *
 * `formatMoney` uses Intl.NumberFormat, which rounds correctly and inserts the
 * thousands separators a price column needs. `formatMoneyPrecise` exists for
 * the places where a unit price genuinely has minor units worth showing
 * (a cart line's per-unit figure).
 */
import { config } from '../config.js';

/** ISO 4217 code. Matches the Phase 2 convention: the store trades in ETB. */
export const CURRENCY = 'ETB';

const moneyFormatter = new Intl.NumberFormat('en-ET', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const moneyPreciseFormatter = new Intl.NumberFormat('en-ET', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('en-ET');

/**
 * Formats minor units as a whole-currency price.
 * @param {number|null|undefined} minor - e.g. 470000 -> "ETB 4,700"
 * @returns {string}
 */
export function formatMoney(minor) {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '—';
  return moneyFormatter.format(Math.round(Number(minor)) / 100);
}

/**
 * Formats minor units with decimals. Use for unit prices inside a total.
 * @param {number|null|undefined} minor
 */
export function formatMoneyPrecise(minor) {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return '—';
  return moneyPreciseFormatter.format(Math.round(Number(minor)) / 100);
}

/**
 * Formats a value already expressed in major units (e.g. a price-range slider
 * bound that the shopper typed in whole birr). This is the one place we take
 * major units, and it converts to minor internally so the conversion stays in
 * a single function.
 * @param {number} major
 */
export function majorToMinor(major) {
  return Math.round(Number(major) * 100);
}

/** @param {number|null|undefined} minor */
export function minorToMajor(minor) {
  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return 0;
  return Math.round(Number(minor)) / 100;
}

/**
 * Percentage saved, rounded down. Null when there is nothing to compare, so the
 * caller can omit the badge rather than render "-0%".
 *
 * The arithmetic order is load-bearing and must stay identical to
 * `discountPercent` in `backend/src/services/money.js`.
 *
 *   ((was - now) * 100) / was     <- this, exact in integer minor units
 *   ((was - now) / was) * 100     <- the obvious spelling, and WRONG
 *
 * The second form divides first, so the result is a binary fraction that often
 * lands a hair below the true value. Rounding down then drops a whole percent:
 * 35,500 against 50,000 is 29% off, but the dividing-first spelling reports 28%.
 * The server and the client must never disagree about the saving on the same
 * product, so this multiplies first and the "was" price is the denominator —
 * "was 10,000, now 7,500" is 25% off, not 33%.
 *
 * @param {number|null} price        current price, minor units
 * @param {number|null} compareAtPrice "was" price, minor units
 * @returns {number|null} whole percent, or null when there is no real discount
 */
export function discountPercent(price, compareAtPrice) {
  if (price === null || price === undefined) return null;
  if (compareAtPrice === null || compareAtPrice === undefined) return null;
  // A "was" price at or below the sale price is bad data, not a 100% discount.
  if (compareAtPrice <= price) return null;
  if (price <= 0) return null;

  return Math.floor(((compareAtPrice - price) * 100) / compareAtPrice);
}

/** @param {number|null|undefined} value */
export function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return numberFormatter.format(Number(value));
}

/** Pluralising helper: `formatCount(1, 'item')` -> "1 item". */
export function formatCount(count, singular, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** Compact relative time: "3 days ago". Absolute dates use `formatDate`. */
const RELATIVE_UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * @param {string|Date} value
 * @returns {string}
 */
export function formatRelative(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = (date.getTime() - Date.now()) / 1000;
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, secondsPerUnit] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }
  return 'just now';
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** @param {string|Date} value */
export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateFormatter.format(date);
}

/**
 * Truncates on a word boundary.
 * @param {string} value
 * @param {number} [maxLength]
 */
export function truncate(value, maxLength = 120) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/** Turns a slug into a sentence: "mens-clothing" -> "Mens clothing". */
export function titleFromSlug(slug) {
  const text = String(slug ?? '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `1,024` -> `1.0k`, for compact counts. */
export function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    number
  );
}

/**
 * The free-delivery promise, with the threshold filled in.
 *
 * Four templates used to spell out "ETB 5,000" by hand, which is four places to
 * forget when the threshold changes — and the failure is silent, because the page
 * still renders and simply lies about the offer. The amount now comes from
 * `config.freeShippingThreshold`, the same value the cart's progress hint measures
 * against, so the promise and the arithmetic cannot disagree.
 *
 * @param {{ long?: boolean }} [options] `long` for the sentence form used in prose
 * @returns {string}
 */
export function freeDeliveryNotice({ long = false } = {}) {
  const amount = formatMoney(config.freeShippingThreshold);
  return long ? `Free delivery on orders over ${amount}.` : `Free delivery over ${amount}`;
}

export default {
  CURRENCY,
  formatMoney,
  formatMoneyPrecise,
  majorToMinor,
  minorToMajor,
  discountPercent,
  formatNumber,
  formatCount,
  formatRelative,
  formatDate,
  formatCompact,
  freeDeliveryNotice,
  truncate,
  titleFromSlug,
};
