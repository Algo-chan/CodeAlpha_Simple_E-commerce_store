/**
 * Frontend runtime configuration tests (Phase 12).
 *
 * The storefront must not hardcode a localhost API URL into a production
 * bundle. `js/config.js` derives a same-origin API base when it runs in a
 * browser on a non-localhost host, and falls back to localhost for the dev
 * server and for the Node test runner (which has no `window`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('without a browser window the API base defaults to localhost', async () => {
  const { config } = await import('../js/config.js');

  assert.equal(config.apiBaseUrl, 'http://localhost:4000/api/v1');
});

test('on a non-local production host the API base is same-origin', async () => {
  const original = globalThis.window;
  globalThis.window = {
    location: {
      protocol: 'https:',
      hostname: 'shop.example.com',
      origin: 'https://shop.example.com',
    },
  };

  try {
    // A query string busts the module cache so the module re-evaluates with the
    // fake window in place.
    const { config } = await import('../js/config.js?production');
    assert.equal(config.apiBaseUrl, 'https://shop.example.com/api/v1');
  } finally {
    globalThis.window = original;
  }
});

test('an injected __APP_CONFIG__ still wins over the derived default', async () => {
  const originalWindow = globalThis.window;
  const originalConfig = globalThis.__APP_CONFIG__;
  globalThis.window = {
    location: {
      protocol: 'https:',
      hostname: 'shop.example.com',
      origin: 'https://shop.example.com',
    },
  };
  globalThis.__APP_CONFIG__ = { apiBaseUrl: 'https://api.example.com/v1' };

  try {
    const { config } = await import('../js/config.js?injected');
    assert.equal(config.apiBaseUrl, 'https://api.example.com/v1');
  } finally {
    globalThis.window = originalWindow;
    if (originalConfig === undefined) delete globalThis.__APP_CONFIG__;
    else globalThis.__APP_CONFIG__ = originalConfig;
  }
});
