/**
 * Frontend runtime configuration.
 *
 * The browser cannot read `.env`, so this file is the single place where the
 * API location lives. For multi-environment builds, either edit this file or
 * inject a `<script>window.__APP_CONFIG__ = {...}</script>` tag before
 * `js/main.js` is loaded (that object wins when present).
 */

/** @type {{ apiBaseUrl: string, requestTimeoutMs: number }} */
const defaults = {
  apiBaseUrl: 'http://localhost:4000/api/v1',
  requestTimeoutMs: 10000,
};

const injected = globalThis.__APP_CONFIG__ ?? {};

export const config = Object.freeze({
  ...defaults,
  ...injected,
});

export default config;
