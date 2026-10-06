/**
 * Icons.
 *
 * Inline SVG rather than an icon font or a sprite file:
 *   - one less request, and no FOUT for the single most important visual
 *     element on a card (the wishlist heart);
 *   - `currentColor` means every icon inherits its context colour, so hover and
 *     disabled states need no separate asset;
 *   - each icon is a plain geometric path authored here, so there is no
 *     third-party licence to track and nothing to clone from a competitor.
 *
 * All icons share a 24x24 viewBox and a 1.6px stroke, so they optically match
 * each other at any size.
 */
import { raw } from '../core/dom.js';

const PATHS = {
  /* --- Navigation --------------------------------------------------------- */
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.6-4.6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'arrow-right': '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  'arrow-left': '<path d="M20 12H5"/><path d="m11 6-6 6 6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  'arrow-down': '<path d="M12 4v15"/><path d="m6 13 6 6 6-6"/>',
  sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',

  /* --- Commerce ----------------------------------------------------------- */
  cart: '<path d="M5 8h14l-1.2 11.1A1 1 0 0 1 16.8 20H7.2a1 1 0 0 1-1-1.1z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  heart:
    '<path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6c0 4.8-7.5 9.4-7.5 9.4z"/>',
  'heart-off':
    '<path d="M8.5 5.3A4.1 4.1 0 0 1 12 4a4.1 4.1 0 0 1 7.1 3.1c0 1.4-.6 2.8-1.4 4"/><path d="M6.6 7.1A4 4 0 0 0 4.5 10.6C4.5 15.4 12 20 12 20s2-1.2 4-3"/>',
  tag: '<path d="M20.6 12.4 11.6 21.4a1.8 1.8 0 0 1-2.6 0L2.4 14.8a1.8 1.8 0 0 1-.5-1.3V3.4a1 1 0 0 1 1-1h10.1a1.8 1.8 0 0 1 1.3.5l6.3 6.3a1.8 1.8 0 0 1 0 2.6z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21v-1a6.5 6.5 0 0 1 13 0v1"/>',
  gift: '<path d="M3 11h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M2.5 7h19v4h-19z"/><path d="M12 7v14"/><path d="M12 7S10.5 3 8.5 3a2 2 0 0 0 0 4M12 7s1.5-4 3.5-4a2 2 0 0 1 0 4"/>',
  ticket:
    '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M12 6v2M12 11v2M12 16v2"/>',

  /* --- Product ------------------------------------------------------------ */
  package:
    '<path d="M20.5 8.5 12 4 3.5 8.5v7L12 20l8.5-4.5z"/><path d="M3.5 8.5 12 13l8.5-4.5M12 13v7"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.6-4.6M8.5 11h5M11 8.5v5"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.6-4.6M8.5 11h5"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 3.5 3.5L16 12l4 4"/>',
  'image-off':
    '<path d="M20.5 12v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-2"/><path d="m3 3 18 18"/><path d="M3 4.5A2 2 0 0 1 5 3h13"/><path d="m8.5 8.5 1 1M4 17l4.5-4.5 3 3"/>',
  ruler: '<path d="m3 15 12-12 6 6-12 12z"/><path d="m7 11 2 2M10 8l2 2M13 5l2 2"/>',

  /* --- Actions ------------------------------------------------------------ */
  filter: '<path d="M3 6h18M6 12h12M10 18h4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  trash:
    '<path d="M4 6h16"/><path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6"/><path d="m18.5 6-.8 13.1a1.9 1.9 0 0 1-1.9 1.8H8.2a1.9 1.9 0 0 1-1.9-1.8L5.5 6"/><path d="M10 10.5v6M14 10.5v6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 19h16"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14-4.5L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14 4.5L20 15"/><path d="M20 19v-4h-4"/>',
  'log-out':
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pencil: '<path d="m4 20 4-.5L19.5 8a2.1 2.1 0 0 0-3-3L5 16.5z"/><path d="m14.5 6.5 3 3"/>',

  /* --- Status ------------------------------------------------------------- */
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.6 2.6L16 9.5"/>',
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/>',
  'alert-triangle':
    '<path d="M10.3 4 3 17a1.6 1.6 0 0 0 1.4 2.4h15.2A1.6 1.6 0 0 0 21 17L13.7 4a1.6 1.6 0 0 0-2.8 0z"/><path d="M12 9.5v4M12 16.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.3 2"/>',

  /* --- Fulfilment --------------------------------------------------------- */
  truck:
    '<path d="M2 6.5h10v10H2z"/><path d="M12 9.5h4.5l3 3.2v3.8h-7.5z"/><circle cx="6" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/>',
  shield: '<path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="4.5" y="10" width="15" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  banknote:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',

  /* --- Contact ------------------------------------------------------------ */
  phone:
    '<path d="M6.5 3h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4z"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 6.5 9 6.5 9-6.5"/>',
  'map-pin':
    '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  headset:
    '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="12" width="4" height="6" rx="1.5"/><rect x="17.5" y="12" width="4" height="6" rx="1.5"/><path d="M19.5 18v.5a2.5 2.5 0 0 1-2.5 2.5H13"/>',
};

/** Names of icons that read better filled than stroked. */
const FILLED = new Set(['star', 'heart']);

const VIEW_BOX = '0 0 24 24';
const STROKE_WIDTH = 1.6;

/**
 * Icon names, for documentation and for tests that assert an icon exists.
 * @returns {string[]}
 */
export function iconNames() {
  return Object.keys(PATHS);
}

/**
 * Builds an SVG icon element.
 *
 * @param {string} name
 * @param {{ size?: number|string, className?: string, title?: string,
 *           filled?: boolean, strokeWidth?: number }} [options]
 * @returns {SVGElement}
 * @throws {Error} for an unknown icon, so a typo fails loudly in development
 *         instead of silently rendering nothing.
 */
export function icon(name, options = {}) {
  const path = PATHS[name];
  if (!path) throw new Error(`Unknown icon "${name}". Known icons: ${iconNames().join(', ')}`);

  const { size, className, title, filled, strokeWidth = STROKE_WIDTH } = options;
  const isFilled = filled ?? FILLED.has(name);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', VIEW_BOX);
  svg.setAttribute('fill', isFilled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', isFilled ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');

  if (size) {
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
  } else {
    // Intrinsic sizing so `currentColor` and CSS width/height both apply.
    svg.style.inlineSize = '1em';
    svg.style.blockSize = '1em';
  }

  if (className) svg.setAttribute('class', className);

  // A title makes the icon meaningful to assistive tech. Without one the icon
  // is hidden, because decorative duplication of adjacent text is noise.
  if (title) {
    svg.setAttribute('role', 'img');
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    node.textContent = title;
    svg.append(node);
  }

  svg.innerHTML = path;
  return svg;
}

/**
 * Icon markup as a string, for use inside `html` templates via `raw()`.
 * The name is validated the same way `icon()` validates it.
 *
 * @param {string} name
 * @param {{ size?: number|string, className?: string, filled?: boolean }} [options]
 * @returns {{ toString(): string }} wrap with `raw()`
 */
export function iconMarkup(name, options = {}) {
  if (!PATHS[name]) {
    throw new Error(`Unknown icon "${name}". Known icons: ${iconNames().join(', ')}`);
  }

  const { size, className, filled } = options;
  const isFilled = filled ?? FILLED.has(name);

  const attributes = [
    `viewBox="${VIEW_BOX}"`,
    `fill="${isFilled ? 'currentColor' : 'none'}"`,
    `stroke="${isFilled ? 'none' : 'currentColor'}"`,
    `stroke-width="${STROKE_WIDTH}"`,
    'stroke-linecap="round"',
    'stroke-linejoin="round"',
    'aria-hidden="true"',
  ];

  if (size) attributes.push(`width="${size}" height="${size}"`);
  if (className) attributes.push(`class="${className}"`);

  return raw(`<svg ${attributes.join(' ')}>${PATHS[name]}</svg>`);
}

/**
 * Star rating markup: an outlined track with a filled overlay clipped to the
 * average, so a 3.7 average renders as 3.7 stars rather than being rounded.
 *
 * @param {number} rating 0-5
 * @param {{ size?: string, className?: string }} [options]
 */
export function starRatingMarkup(rating, options = {}) {
  const { size = '0.85rem', className = '' } = options;
  const stars = iconMarkup('star', { filled: true }).toString();
  const width = `${(Math.max(0, Math.min(5, rating)) / 5) * 100}%`;

  return raw(
    (
      `<span class="rating__stars ${className}" style="font-size:${size}">` +
      `<span class="rating__stars--fill" style="inline-size:${width}">★★★★★</span>` +
      `</span>`
    ).replace(/★/g, stars)
  );
}

export default { icon, iconMarkup, starRatingMarkup, iconNames };
