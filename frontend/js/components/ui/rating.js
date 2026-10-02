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
 */
import { el, raw } from '../../core/dom.js';
import { formatNumber, formatCount } from '../../utils/format.js';

/** Fills the track to `rating` out of 5 using a clip width. */
function starsMarkup(rating, size) {
  const clamped = Math.max(0, Math.min(5, Number(rating) || 0));
  const percent = (clamped / 5) * 100;

  const star = (className) =>
    `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` +
    '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>' +
    '</svg>';

  return raw(
    `<span class="rating__stars" style="font-size:${size}" aria-hidden="true">` +
      `<span class="rating__track">${star('rating__star')}${star('rating__star')}${star('rating__star')}${star('rating__star')}${star('rating__star')}</span>` +
      `<span class="rating__fill" style="inline-size:${percent.toFixed(2)}%">` +
      `${star('rating__star')}${star('rating__star')}${star('rating__star')}${star('rating__star')}${star('rating__star')}` +
      '</span></span>'
  );
}

/**
 * @param {{ rating: number|null, count?: number, size?: string,
 *           showCount?: boolean, href?: string, className?: string }} options
 * @returns {HTMLElement}
 */
export function rating({ rating, count = 0, size = '0.875rem', showCount = true, href, className }) {
  const average = rating === null || rating === undefined ? null : Number(rating);

  // No reviews yet. Showing five empty stars would imply a zero score, which is
  // different information from "nobody has reviewed this".
  if (average === null || count === 0) {
    const node = el('div.rating.rating--empty', { ...(className ? { className } : {}) }, [
      el('span.rating__label', { text: 'No reviews yet' }),
    ]);
    return href ? el('a', { href, className: 'rating__link' }, [node]) : node;
  }

  const text = `${average.toFixed(1)} out of 5${showCount ? `, ${formatCount(count, 'review')}` : ''}`;

  const content = el('div.rating', { ...(className ? { className } : {}) }, [
    el('span.rating__visual', {}, []),
    el('span.rating__value', { text: average.toFixed(1) }),
    showCount ? el('span.rating__count', { text: `(${formatNumber(count)})` }) : null,
  ]);

  // The stars go inside the visual span so the row reads value - stars - count,
  // which is the order shoppers scan.
  content.querySelector('.rating__visual').append(starsMarkup(average, size));

  const node = el('span.rating__wrapper', { title: text }, [content]);
  return href ? el('a.rating__link', { href, 'aria-label': text }, [node]) : node;
}

export default { rating };