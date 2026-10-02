/**
 * Page headers.
 *
 * One component for the eyebrow / title / lede triple that appears at the top of
 * every page, because the alternative - hand-writing the same three elements per
 * page - is how pages end up with an h2 as their first heading, which breaks the
 * heading outline for anyone navigating by heading.
 *
 * Exactly one `level: 'h1'` exists per document, and it is the first thing in
 * the main region.
 */
import { el } from '../../core/dom.js';

/**
 * @param {string} text
 * @param {{ eyebrow?: string|null, lede?: string|null, level?: 'h1'|'h2' }} [options]
 * @returns {HTMLElement}
 */
export function pageTitle(text, { eyebrow = null, lede = null, level = 'h1' } = {}) {
  return el('div.page-header__text', {}, [
    eyebrow ? el('p.page-header__eyebrow', { text: eyebrow }) : null,
    el(`${level}.page-header__title`, { text }),
    lede ? el('p.page-header__lede', { text: lede }) : null,
  ]);
}

/**
 * A section heading with an optional action on the right - "All products" with
 * a "View all" link. Uses h2 so it sits correctly under the page h1.
 */
export function sectionHeading(text, { eyebrow = null, action = null, level = 'h2', id = null } = {}) {
  return el('div.section-heading', {}, [
    el('div.section-heading__text', {}, [
      eyebrow ? el('p.section-heading__eyebrow', { text: eyebrow }) : null,
      el(`${level}.section-heading__title`, { ...(id ? { id } : {}), text }),
    ]),
    action,
  ]);
}

export default { pageTitle, sectionHeading };