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
  freeDeliveryNotice,
  truncate,
  titleFromSlug,
} from '../js/utils/format.js';
import { config } from '../js/config.js';
import { FREE_SHIPPING_THRESHOLD_MINOR } from '../js/state/cart.js';

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
  assert.equal(discountPercent(null, 520000), null);
});

test('discount percentage multiplies before dividing, so it matches the server', () => {
  // These pairs are the ones where dividing first loses a percent to floating
  // point: (was - now) / was lands just under the true value and rounding down
  // drops a whole percent. The backend (`services/money.js`) computes them as
  // 29, 57 and 28; a card reading 28% while the detail page reads 29% is the bug
  // this test exists to prevent.
  assert.equal(discountPercent(35500, 50000), 29, '35,500 from 50,000 is 29% off, not 28%');
  assert.equal(discountPercent(42000, 100000), 58, '42,000 from 100,000 is 58% off, not 57%');
  assert.equal(discountPercent(71000, 100000), 29, '71,000 from 100,000 is 29% off, not 28%');

  // The denominator is the "was" price. Dividing by the sale price instead
  // reports what the sale price represents relative to the original — a true
  // number that is not what anyone means by "off".
  assert.equal(discountPercent(75000, 100000), 25, 'the saving is measured against the was-price');
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
  // 90 seconds, NOT 90000ms: that lands exactly on 1.5 minutes, and
  // `Math.round(-1.5)` is -1 in JavaScript. Whether the elapsed fraction of a
  // millisecond pushes it to 1.5001 or leaves it at 1.5000 decides whether this
  // asserts "2 minutes ago" or "1 minute ago", so the test passed roughly one run
  // in ten and failed the rest. Nothing to do with the code under test.
  assert.equal(formatRelative(new Date(now - 100000)), '2 minutes ago');
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

test('the free-delivery copy quotes the threshold the cart measures against', () => {
  // Four templates used to hardcode "ETB 5,000". The hazard is not the sentence,
  // it is that a template's copy and the cart's arithmetic are separate literals,
  // so lowering the threshold leaves the promise on the page describing an offer
  // that no longer exists. Both must now come from one value.
  const short = freeDeliveryNotice();
  const long = freeDeliveryNotice({ long: true });

  const amount = formatMoney(FREE_SHIPPING_THRESHOLD_MINOR);
  assert.ok(short.includes(amount), `the short copy should quote ${amount}, got "${short}"`);
  assert.ok(long.includes(amount), `the long copy should quote ${amount}, got "${long}"`);
  assert.ok(long.endsWith('.'), 'the sentence form is punctuated');
  assert.ok(!short.endsWith('.'), 'the label form is not');

  // The cart's exported threshold is the configured one, not a private literal.
  assert.equal(FREE_SHIPPING_THRESHOLD_MINOR, config.freeShippingThreshold);
});
