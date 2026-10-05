/**
 * Frontend runtime configuration.
 *
 * The browser cannot read `.env`, so this file is the single place where the
 * API location and the storefront's identity live. For multi-environment
 * builds, inject a `<script>window.__APP_CONFIG__ = {...}</script>` tag before
 * `js/app.js` is loaded; that object wins over the defaults below.
 *
 * BRANDING IS DELIBERATELY UNFINISHED. `store.name`, `store.tagline` and
 * `store.logo` are placeholders. They exist as named configuration precisely so
 * that settling on a real name is a one-line change in one file rather than a
 * sweep through every template - see docs/frontend-design-system.md.
 */

/**
 * @typedef {object} StoreBranding
 * @property {string} name        wordmark text
 * @property {string} tagline     one line, used in the hero and the meta tags
 * @property {string} logo        inline SVG markup for the header mark
 * @property {string} logoLabel   accessible name for the logo
 * @property {string} [description] longer description for structured data
 */

/** @type {{ apiBaseUrl: string, requestTimeoutMs: number, mockLatencyMs: number,
 *           mockJitterMs: number, currency: string, locale: string,
 *           store: StoreBranding, freeShippingThreshold: number }} */
const defaults = {
  // --- Backend ---------------------------------------------------------------
  apiBaseUrl: 'http://localhost:4000/api/v1',
  requestTimeoutMs: 10000,

  // --- Mock service ----------------------------------------------------------
  // Phase 3 only. Set both to 0 for instant rendering in tests.
  mockLatencyMs: 260,
  mockJitterMs: 90,

  // --- Locale ----------------------------------------------------------------
  // Phase 2 stores ETB minor units; formatting lives in utils/format.js.
  currency: 'ETB',
  locale: 'en-ET',

  // --- Storefront identity ---------------------------------------------------
  store: {
    name: 'Aster & Oak',
    tagline: 'Well-made things for everyday use',
    logo: '',
    logoLabel: 'Aster & Oak — home',
    description:
      'Considered clothing, footwear and homeware, selected for how it holds up ' +
      'to daily use. Delivered across Addis Ababa.',
  },

  /**
   * Order value, in ETB minor units, at or above which delivery is free.
   *
   * This is the only place the amount is written down. It was previously stated
   * here AND recomputed from a literal in `state/cart.js` AND spelled out in prose
   * in four templates ("Free delivery over ETB 5,000"), so lowering it to 4,000
   * would have left the announcement bar, the mobile menu, the home page feature
   * row and the product page all promising the old figure. Copy that mentions the
   * number is now generated from this value by `freeDeliveryNotice`.
   */
  freeShippingThreshold: 500000,
};

const injected = globalThis.__APP_CONFIG__ ?? {};

/**
 * Shallow-merged one level deep, so a partial `store` override keeps the
 * untouched brand fields. A plain spread would drop `tagline` entirely if only
 * `name` were injected, leaving a header with no tagline rather than the
 * default one.
 */
function merge(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...(base[key] ?? {}), ...value };
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export const config = Object.freeze(merge(defaults, injected));

export default config;
