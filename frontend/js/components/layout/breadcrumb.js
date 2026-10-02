/**
 * Breadcrumbs.
 *
 * Built as a real ordered list inside a labelled nav, with the current page
 * marked `aria-current="page"` and removed from the tab order. Removing it from
 * the tab order matters: the current page link has nowhere to go, and including
 * it puts a dead link in the keyboard path of every page.
 */
import { el } from '../../core/dom.js';

/**
 * @param {Array<{label: string, href?: string}>} items
 * @param {{ showHome?: boolean, homeLabel?: string, homeHref?: string }} [options]
 * @returns {HTMLElement|null} null for a single-item trail
 */
export function breadcrumb(items = [], options = {}) {
  const { showHome = true, homeLabel = 'Home', homeHref = '/' } = options;

  const trail = showHome ? [{ label: homeLabel, href: homeHref }, ...items] : [...items];

  // One item is just a page title, not a trail. Rendering it would be noise.
  if (trail.length < 2) return null;

  const list = el('ol.breadcrumb__list', {}, trail.map((item, position) => {
    const isLast = position === trail.length - 1;

    return el('li.breadcrumb__item', {}, [
      isLast
        ? el('span.breadcrumb__current', { 'aria-current': 'page', text: item.label })
        : el('a.breadcrumb__link', { href: item.href ?? '#', text: item.label }),
      isLast ? null : el('span.breadcrumb__separator', { 'aria-hidden': 'true', text: '/' }),
    ]);
  }));

  return el('nav.breadcrumb', { 'aria-label': 'Breadcrumb' }, [list]);
}

export default { breadcrumb };