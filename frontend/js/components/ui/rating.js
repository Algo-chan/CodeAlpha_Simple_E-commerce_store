/**
 * Star ratings.
 *
 * A filled overlay clipped to the average, so 3.7 out of 5 renders as 3.7 stars
 * instead of being rounded to 4 - rounding up reads as a lie on a product page.
 *
 * The visual stars are decorative. The rating is also exposed as text, because
 * "4.3 out of 5 from 12 reviews" is understood instantly while a row of partial
 * stars is not, and because screen readers announce neither clipping nor shapes
 * reliably.
 *
 * Class names match product-card.css: the track is `.rating__stars` and the
 * clipped overlay is `.rating__stars--fill`.
 */
import { el, raw } from '../../core/dom.js';

const STAR_PATH =
  'm12 3.5 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z';

function star({ filled }) {
  return (
    `<svg class="rating__star" viewBox="0 0 24 24" width="1em" height="1em" ` +
    `fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4" ` +
    `stroke-linejoin="round" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`
  );
}

function stars(filled, times) {
  return star({ filled }).repeat(times);
}

/**
 * Track of five outlined stars with a filled overlay clipped to the average.
 * @returns {Element} raw markup node
 */
function starsMarkup(average, size) {
  const clamped = Math.max(0, Math.min(5, Number(average) || 0));
  const percent = (clamped / 5) * 100;

  return raw(
    `<span class="rating__stars" style="font-size:${size}" aria-hidden="true">` +
      `${stars(false, 5)}` +
      `<span class="rating__stars--fill" style="inline-size:${percent.toFixed(2)}%">` +
      `${stars(true, 5)}</span></span>`
  );
}

/**
 * @param {object} options
 * @param {number|null} options.rating   0-5, or null when unrated
 * @param {number} [options.count]        number of reviews
 * @param {string} [options.size]         icon size, any CSS length
 * @param {boolean} [options.showCount]
 * @param {string} [options.href]         links the rating to its review section
 * @param {string} [options.className]
 * @returns {HTMLElement}
 */
export function rating({ rating: value, count = 0, size = '0.75rem', showCount = true, href, className }) {
  const average = value === null || value === undefined ? null : Number(value);
  const extra = className ? { className } : {};

  // No reviews yet. Five empty stars would assert a score of zero, which is a
  // different claim from "nobody has reviewed this".
  if (average === null || count === 0) {
    const node = el('span.rating.rating--empty', { role: 'img', 'aria-label': 'No reviews yet', ...extra }, [
      el('span.rating__value', { text: 'No reviews yet' }),
    ]);
    return href ? el('a.rating__link', { href }, [node]) : node;
  }

  const label = `${average.toFixed(1)} out of 5${showCount ? `, from ${count} reviews` : ''}`;

  // role="img" with a label: the visible value and count stay for sighted
  // users, the stars are aria-hidden, and assistive tech reads one sentence
  // instead of three fragments.
  const content = el('span.rating', { role: 'img', 'aria-label': label, ...extra }, [
    el('span.rating__value', { text: average.toFixed(1) }),
    starsMarkup(average, size),
    showCount ? el('span.rating__count', { text: `(${count})` }) : null,
  ]);

  return href ? el('a.rating__link', { href }, [content]) : content;
}

export default { rating };