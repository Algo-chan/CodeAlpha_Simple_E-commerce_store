/**
 * Money and text formatting.
 *
 * The rule under test: prices arrive as ETB minor units and are divided by 100
 * exactly once, at display time. Anything that lets a float into a price, or
 * that rounds at the wrong boundary, is a defect here rather than a cosmetic
 * one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from '../js/utils/format.js';

test('the store trades in ETB', () => {
  assert.equal(CURRENCY, 'ETB');
});

test('minor units render as a whole-birr price', () => {
  const rendered = formatMoney(470000);
  assert.match(rendered, /4,700/, `expected 4,700 in "${rendered}"`);
  assert.match(rendered, /ETB/, `expected the currency in "${rendered}"`);
});

test('an exact birr amount carries no trailing decimals', () => {
  assert.doesNotMatch(formatMoney(500000), /\.00/);
});

test('the precise formatter shows minor units where they matter', () => {
  assert.match(formatMoneyPrecise(470050), /4,700\.50/);
});

test('a missing price renders as a dash rather than NaN or ETB 0', () => {
  for (const value of [null, undefined, Number.NaN, Infinity, 'abc']) {
    assert.equal(formatMoney(value), '—', `for ${String(value)}`);
    assert.equal(formatMoneyPrecise(value), '—', `for ${String(value)}`);
  }
});

test('major and minor units round-trip', () => {
  assert.equal(majorToMinor(5000), 500000);
  assert.equal(minorToMajor(500000), 5000);
  assert.equal(majorToMinor(19.99), 1999, 'decimal input does not lose precision');
  assert.equal(minorToMajor(null), 0);
});

test('discount percentage rounds down and refuses a non-discount', () => {
  assert.equal(discountPercent(470000, 520000), 9);
  assert.equal(discountPercent(0, 520000), null, 'a free item has no discount to show');
  assert.equal(discountPercent(520000, 470000), null, 'compare-at below price is not a discount');
  assert.equal(discountPercent(500000, 500000), null, 'no change, no badge');
  assert.equal(discountPercent(470000, null), null);
});

test('numbers and counts are formatted and pluralised', () => {
  assert.match(formatNumber(1234567), /1,234,567/);
  assert.equal(formatCount(1, 'item'), '1 item');
  assert.equal(formatCount(0, 'item'), '0 items');
  assert.equal(formatCount(2, 'item'), '2 items');
  assert.equal(formatCount(2, 'entry', 'entries'), '2 entries');
});

test('relative time reads naturally in both directions', () => {
  const now = Date.now();
  assert.equal(formatRelative(new Date(now - 3 * 86400000)), '3 days ago');
  assert.equal(formatRelative(new Date(now - 2 * 3600000)), '2 hours ago');
  assert.equal(formatRelative(new Date(now - 90000)), '2 minutes ago');
  assert.equal(formatRelative(new Date(now + 2 * 86400000)), 'in 2 days');
  assert.equal(formatRelative(new Date(now - 5000)), 'just now');
});

test('an unparseable date returns an empty string, not "Invalid Date"', () => {
  assert.equal(formatRelative('not-a-date'), '');
  assert.equal(formatDate('not-a-date'), '');
});

test('dates render unambiguously', () => {
  const rendered = formatDate('2026-03-09T00:00:00.000Z');
  assert.match(rendered, /2026/);
  assert.doesNotMatch(rendered, /03\/09|3\/9/, 'ambiguous numeric dates are avoided');
});

test('compact counts abbreviate large numbers', () => {
  assert.match(formatCompact(1024), /1(\.0)?k/i);
  assert.match(formatCompact(1_500_000), /1(\.5)?m/i);
  assert.equal(formatCompact('nope'), '—');
});

test('truncate cuts on a word boundary and marks the cut', () => {
  const text = 'A considered cotton shirt with a soft collar and a relaxed cut';

  assert.equal(truncate(text, 200), text, 'short text is untouched');

  const clipped = truncate(text, 30);
  assert.match(clipped, /…$/, 'the cut is marked');
  const base = clipped.replace(/…$/, '');
  assert.ok(text.startsWith(base), 'what remains is a real prefix of the original');
  assert.equal(base, base.trimEnd(), 'it does not end on a stray space');
});

test('slugs become readable titles', () => {
  assert.equal(titleFromSlug('mens-clothing'), 'Mens clothing');
  assert.equal(titleFromSlug(''), '');
});

test('truncate survives null and undefined', () => {
  assert.equal(truncate(null), '');
  assert.equal(truncate(undefined), '');
});
