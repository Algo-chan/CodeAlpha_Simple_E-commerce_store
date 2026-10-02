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
 * @param {number|null} price
 * @param {number|null} compareAtPrice
 * @returns {number|null}
 */
export function discountPercent(price, compareAtPrice) {
  if (!compareAtPrice || !price || compareAtPrice <= price) return null;
  return Math.floor(((compareAtPrice - price) / compareAtPrice) * 100);
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
  truncate,
  titleFromSlug,
};