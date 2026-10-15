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

/**
 * Default API location.
 *
 * In development the storefront runs on its own dev server (:5173) and the API
 * on :4000, so an absolute localhost URL is correct. In production the backend
 * serves the storefront itself, so the API is same-origin: deriving the URL from
 * `window.location` means a deploy needs no rebuild or hardcoded host. A split
 * deployment (static CDN + a separate API host) overrides `apiBaseUrl` through
 * `window.__APP_CONFIG__` exactly as before.
 *
 * `window` is absent when this module is imported by the Node test runner, so
 * the guarded fallback keeps the tests on the localhost default.
 */
function defaultApiBaseUrl() {
  if (typeof window === 'undefined' || !window.location) return 'http://localhost:4000/api/v1';

  const { protocol, hostname, origin } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  const isHttp = protocol === 'http:' || protocol === 'https:';

  // Same-origin API for any non-local HTTP(S) origin (i.e. production).
  return !isLocalhost && isHttp ? `${origin}/api/v1` : 'http://localhost:4000/api/v1';
}

/**
 * Whether the storefront should read the catalogue from the in-browser fixtures
 * (`js/mock/api.js`) instead of the API.
 *
 * Production is always `false`: the storefront reads the live catalogue. A
 * developer working on the shell without a backend running — or reviewing the
 * loading, empty and error states the fixtures can inject — opens the site with
 * `?catalogue=mock`. `window.__APP_CONFIG__` overrides it either way, so a
 * deployment can force fixtures without a code change.
 *
 * `window` is absent under the Node test runner, where the answer is always
 * `false` and the fixtures are imported directly by the tests that want them.
 *
 * @returns {boolean}
 */
function defaultUseMockCatalogue() {
  if (typeof window === 'undefined' || !window.location) return false;

  try {
    return new URLSearchParams(window.location.search).get('catalogue') === 'mock';
  } catch {
    return false;
  }
}

/** @type {{ apiBaseUrl: string, requestTimeoutMs: number, useMockCatalogue: boolean,
 *           mockLatencyMs: number, mockJitterMs: number, currency: string, locale: string,
 *           store: StoreBranding, freeShippingThreshold: number }} */
const defaults = {
  // --- Backend ---------------------------------------------------------------
  apiBaseUrl: defaultApiBaseUrl(),
  requestTimeoutMs: 10000,

  /**
   * `false` (production): read the catalogue from `/api/v1`.
   * `true`: read it from the in-browser fixtures (`?catalogue=mock`).
   */
  useMockCatalogue: defaultUseMockCatalogue(),

  // --- Mock service ----------------------------------------------------------
  // Only used when `useMockCatalogue` is on. Set both to 0 for instant rendering.
  mockLatencyMs: 260,
  mockJitterMs: 90,

  // --- Locale ----------------------------------------------------------------
  // Phase 2 stores ETB minor units; formatting lives in utils/format.js.
  currency: 'ETB',
  locale: 'en-ET',

  // --- Storefront identity ---------------------------------------------------
  store: {
    name: 'Roman Store',
    tagline: 'Well-made things for everyday use',
    logo: '',
    logoLabel: 'Roman Store — home',
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
