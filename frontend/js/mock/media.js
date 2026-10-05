/**
 * Procedural product media.
 *
 * WHY THIS EXISTS. Phase 3 has no upload pipeline and must not depend on an
 * external placeholder service: those URLs are slow, they change, they break
 * offline, and they put someone else's typography all over a design system
 * this codebase is trying to define. So every image is generated here as an
 * inline SVG data URI.
 *
 * WHAT MAKES IT WORK AS A DESIGN. The output is not a grey box with a label.
 * Each product gets a deterministic composition derived from its own id -
 * hue, pattern, framing - so:
 *   - a card grid looks varied and considered rather than repetitive;
 *   - the same product always renders identically, so images never flicker on
 *     re-render (the hash is seeded by slug, not by render order);
 *   - the palette comes from the design tokens, so swapping the theme swaps
 *     the imagery.
 *
 * REPLACING IT. `mediaFor()` is the only seam. When the API serves real image
 * URLs, the view model takes `image_url` and these functions stop being called.
 */

/** Palette aligned with styles/tokens.css - bone, clay, ink, sage, sand. */
export const MEDIA_PALETTE = Object.freeze({
  bone: '#f4f1ea',
  paper: '#fbfaf7',
  ink: '#1f1d1a',
  clay: '#c2703d',
  sage: '#7d8c72',
  sand: '#d9c7a7',
  slate: '#5b6470',
  clayDeep: '#8f4f2a',
});

/** Deterministic 32-bit string hash (FNV-1a). Same input, same output, always. */
function hash(value) {
  let result = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** A small seeded PRNG so one product's composition is internally consistent. */
function createRandom(seed) {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

/**
 * @typedef {object} MediaSpec
 * @property {number} width
 * @property {number} height
 * @property {string} seed      any stable string; usually the product slug
 * @property {string} [label]   small caption drawn into the image
 * @property {string} [angle]   'Front' | 'Side' | 'Back' | 'Detail' | ...
 * @property {number} [variant] gallery index, so image 2 differs from image 1
 */

/**
 * Memoised. The same (seed, angle, variant) is requested many times - every
 * re-render of a grid, every cart line - and string concatenation plus base64
 * encoding is not free.
 * @type {Map<string, string>}
 */
const cache = new Map();

/**
 * Generates a product image as a data URI.
 *
 * @param {MediaSpec} spec
 * @returns {string} `data:image/svg+xml,...`
 */
export function mediaFor(spec) {
  const { width = 800, height = 800, seed, label = '', angle = '', variant = 0 } = spec;

  const cacheKey = `${seed}|${angle}|${variant}|${width}x${height}|${label}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const random = createRandom(hash(`${seed}:${angle}:${variant}`));
  const svg = composeSvg({ width, height, random, label, angle, seed });
  const uri = toDataUri(svg);

  cache.set(cacheKey, uri);
  return uri;
}

/**
 * The full gallery for a product, primary image first.
 * @param {string} slug
 * @param {string[]} angles
 * @param {{ width?: number, height?: number }} [size]
 * @returns {Array<{ url:string, alt:string, angle:string, sort_order:number, is_primary:boolean }>}
 */
export function mediaSet(slug, angles, { width = 800, height = 800 } = {}) {
  return angles.map((angle, index) => ({
    url: mediaFor({ seed: slug, angle, variant: index, width, height, label: slug }),
    alt: `${humaniseSlug(slug)} — ${angle.toLowerCase()} view`,
    angle,
    // snake_case to match the rest of the view model. These were camelCase,
    // which meant consumers had to know which of the two conventions an image
    // object followed - and the API's JSONB image rows are snake_case.
    sort_order: index,
    is_primary: index === 0,
  }));
}

/**
 * A smaller variant of the same composition, for thumbnails and cart lines.
 * Rendering at the size it will be displayed avoids shipping 800px squares into
 * a 64px cart thumbnail.
 * @param {string} slug
 * @param {{ angle?: string, variant?: number, size?: number }} [options]
 */
export function thumbnailFor(slug, { angle = 'Front', variant = 0, size = 200 } = {}) {
  return mediaFor({ seed: slug, angle, variant, width: size, height: size });
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds the SVG. Four pattern families are selected by the seed, so the grid
 * has rhythm without any two adjacent products looking random.
 */
function composeSvg({ width, height, random, label, angle, seed }) {
  const palettes = [
    [MEDIA_PALETTE.paper, MEDIA_PALETTE.sand, MEDIA_PALETTE.ink],
    [MEDIA_PALETTE.bone, MEDIA_PALETTE.sage, MEDIA_PALETTE.paper],
    [MEDIA_PALETTE.bone, MEDIA_PALETTE.clay, MEDIA_PALETTE.paper],
    [MEDIA_PALETTE.paper, MEDIA_PALETTE.slate, MEDIA_PALETTE.bone],
  ];

  const [background, accent, ink] = palettes[Math.floor(random() * palettes.length)];
  const family = Math.floor(random() * 4);
  const centreX = width / 2 + (random() - 0.5) * width * 0.08;
  const centreY = height * 0.52 + (random() - 0.5) * height * 0.04;

  const shapes = [
    arcField(centreX, centreY, width, height, accent, random),
    stripeField(width, height, accent, random),
    blockGrid(width, height, accent, random),
    orbitField(centreX, centreY, width, height, accent, random),
  ][family];

  // A soft ground shadow keeps the subject from floating; it is a gradient-free
  // ellipse at low opacity, which the brief's "no gradients" rule allows.
  const shadow = `<ellipse cx="${centreX}" cy="${height * 0.82}" rx="${width * 0.28}" ry="${height * 0.035}" fill="${ink}" opacity="0.08"/>`;

  const caption = label
    ? `<text x="${width * 0.06}" y="${height * 0.93}" font-family="Georgia, 'Times New Roman', serif" font-size="${Math.round(width * 0.038)}" fill="${ink}" opacity="0.55">${escapeXml(label)}</text>`
    : '';

  const angleBadge = angle
    ? `<text x="${width * 0.94}" y="${height * 0.11}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(width * 0.032)}" letter-spacing="${width * 0.006}" fill="${ink}" opacity="0.4">${escapeXml(angle.toUpperCase())}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(`${humaniseSlug(seed)} ${angle || 'product image'}`)}">
  <rect width="${width}" height="${height}" fill="${background}"/>
  ${shapes}
  ${shadow}
  ${caption}
  ${angleBadge}
</svg>`;
}

function arcField(centreX, centreY, width, height, accent, random) {
  const parts = [];
  const count = 3 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = width * (0.18 + index * 0.13 + random() * 0.04);
    parts.push(
      `<circle cx="${centreX.toFixed(1)}" cy="${centreY.toFixed(1)}" r="${radius.toFixed(1)}" fill="none" stroke="${accent}" stroke-width="${(width * 0.006).toFixed(2)}" opacity="${(0.5 - index * 0.07).toFixed(2)}"/>`
    );
  }
  parts.push(
    `<circle cx="${centreX.toFixed(1)}" cy="${centreY.toFixed(1)}" r="${(width * 0.14).toFixed(1)}" fill="${accent}" opacity="0.9"/>`
  );
  return parts.join('');
}

function stripeField(width, height, accent, random) {
  const parts = [];
  const gap = height / (7 + Math.floor(random() * 5));
  const tilt = (random() - 0.5) * 14;
  for (let index = 0; index < 12; index += 1) {
    const y = index * gap;
    const thickness = gap * (0.18 + random() * 0.3);
    parts.push(
      `<rect x="${(-width * 0.1).toFixed(1)}" y="${y.toFixed(1)}" width="${(width * 1.2).toFixed(1)}" height="${thickness.toFixed(1)}" fill="${accent}" opacity="${(0.25 + random() * 0.35).toFixed(2)}" transform="rotate(${tilt.toFixed(1)} ${width / 2} ${height / 2})"/>`
    );
  }
  return parts.join('');
}

function blockGrid(width, height, accent, random) {
  const parts = [];
  const columns = 3 + Math.floor(random() * 3);
  const rows = 3 + Math.floor(random() * 3);
  const cellWidth = width / columns;
  const cellHeight = height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (random() < 0.42) continue;
      parts.push(
        `<rect x="${(column * cellWidth).toFixed(1)}" y="${(row * cellHeight).toFixed(1)}" width="${(cellWidth * 0.92).toFixed(1)}" height="${(cellHeight * 0.92).toFixed(1)}" fill="${accent}" opacity="${(0.2 + random() * 0.5).toFixed(2)}" rx="${(cellWidth * 0.04).toFixed(1)}"/>`
      );
    }
  }
  return parts.join('');
}

function orbitField(centreX, centreY, width, height, accent, random) {
  const parts = [];
  const count = 5 + Math.floor(random() * 4);
  for (let index = 0; index < count; index += 1) {
    const radius = width * (0.12 + random() * 0.3);
    const angle = random() * Math.PI * 2;
    const x = centreX + Math.cos(angle) * radius;
    const y = centreY + Math.sin(angle) * radius;
    const size = width * (0.03 + random() * 0.07);
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="${accent}" opacity="${(0.35 + random() * 0.5).toFixed(2)}"/>`
    );
  }
  parts.push(
    `<rect x="${(centreX - width * 0.1).toFixed(1)}" y="${(centreY - height * 0.1).toFixed(1)}" width="${(width * 0.2).toFixed(1)}" height="${(height * 0.2).toFixed(1)}" fill="${accent}" opacity="0.85" rx="${(width * 0.02).toFixed(1)}"/>`
  );
  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * UTF-8 safe base64.
 *
 * TextEncoder then a manual byte string avoids the deprecated `unescape()`, and
 * avoids the classic bug where `btoa()` throws on any non-Latin1 character - a
 * product name with an accent would otherwise blank the image.
 */
function toDataUri(svg) {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function humaniseSlug(slug) {
  const text = String(slug ?? '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A neutral fallback for a product with no imagery at all. Deliberately calm:
 * it appears next to real products, so it must not shout.
 * @param {string} [label]
 */
export function placeholderFor(label = 'No image') {
  return mediaFor({ seed: `placeholder-${label}`, label, width: 600, height: 600 });
}

export default { mediaFor, mediaSet, thumbnailFor, placeholderFor, MEDIA_PALETTE };
