/**
 * Badges and pills.
 *
 * Small status markers. Every badge is either text or text plus an icon - never
 * colour alone, because colour is the one signal a colourblind shopper cannot
 * read and the one that disappears in a screenshot printed in black and white.
 *
 * Badge vocabulary lives in mock/view.js (`BADGE_LABELS`) so the meaning of a
 * badge key is defined once.
 */
import { el } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { badgeLabel } from '../../mock/view.js';

/** Icons per badge key. Absent means the badge is text only. */
const BADGE_ICONS = {
  'sold-out': 'x-circle',
  'low-stock': 'alert-triangle',
  digital: 'download',
  featured: 'star',
};

/**
 * @param {{ variant?: 'sale'|'status'|'neutral', tone?: 'info'|'success'|'warning'|'danger',
 *           size?: 'sm'|'md', label?: string, icon?: string }} [options]
 * @returns {HTMLElement}
 */
export function badge({ variant = 'status', tone = 'info', size = 'md', label = '', icon: iconName } = {}) {
  return el(`span.badge.badge--${variant}.badge--${tone}.badge--${size}`, {}, [
    iconName ? icon(iconName, { className: 'badge__icon' }) : null,
    label,
  ]);
}

/**
 * A product badge from its key, e.g. `sale-12` -> "12% off".
 * @param {string} key
 * @returns {HTMLElement}
 */
export function productBadge(key) {
  const isSale = /^sale-\d+$/.test(key);
  return badge({
    variant: isSale ? 'sale' : 'status',
    tone: toneForBadge(key),
    size: 'sm',
    label: badgeLabel(key),
    icon: BADGE_ICONS[key],
  });
}

/**
 * A stack of product badges, capped so a card never becomes unreadable.
 * @param {string[]} keys
 * @returns {HTMLElement}
 */
export function badgeStack(keys = []) {
  return el(
    'div.product-card__badges',
    { 'aria-label': keys.map(badgeLabel).join(', ') || undefined },
    keys.slice(0, 2).map(productBadge)
  );
}

function toneForBadge(key) {
  if (key === 'sold-out') return 'danger';
  if (key === 'low-stock') return 'warning';
  if (key === 'digital') return 'info';
  if (key === 'featured') return 'accent';
  return 'neutral';
}

export default { badge, productBadge, badgeStack };