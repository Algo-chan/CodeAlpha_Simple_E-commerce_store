/**
 * CSP regression tests for the storefront.
 *
 * The production Content-Security-Policy forbids inline scripts and inline event
 * handlers. The pages used to swap the deferred font stylesheet in with an
 * inline `onload` attribute, which the policy would block; that swap now lives
 * in `js/core/fonts.js`. These tests guard the two halves of that change: the
 * HTML must stay free of inline handlers, and the loader must actually flip the
 * media query.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeferredFonts } from '../js/core/fonts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');

const htmlFiles = fs.readdirSync(FRONTEND_DIR).filter((file) => file.endsWith('.html'));

test('the storefront has HTML pages to check', () => {
  assert.ok(htmlFiles.length >= 10, `expected several pages, found ${htmlFiles.length}`);
});

test('no page carries an inline event handler', () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${file} has an inline event handler`);
  }
});

test('no page carries an inline <script> block', () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, `${file} has an inline script`);
  }
});

test('the deferred font stylesheet is marked for the external loader', () => {
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8');
    const hasFontLink = /fonts\.googleapis\.com/.test(html);
    if (!hasFontLink) continue;

    assert.match(html, /data-font-stylesheet/, `${file} must mark the font link`);
    assert.match(html, /media="print"/, `${file} must load the font sheet non-blockingly`);
  }
});

test('both entry points apply the deferred fonts', () => {
  const entries = ['js/app.js', 'js/admin/index.js'];
  for (const entry of entries) {
    const source = fs.readFileSync(path.join(FRONTEND_DIR, entry), 'utf8');
    assert.match(source, /loadDeferredFonts/, `${entry} must load the deferred fonts`);
  }
});

test('loadDeferredFonts flips media once the stylesheet is available', () => {
  const listeners = [];
  const pending = {
    sheet: null,
    media: 'print',
    addEventListener(type, handler) {
      assert.equal(type, 'load');
      listeners.push(handler);
    },
  };
  const cached = { sheet: {}, media: 'print' };

  const original = globalThis.document;
  globalThis.document = { querySelectorAll: () => [pending, cached] };

  try {
    loadDeferredFonts();

    assert.equal(cached.media, 'all', 'an already-loaded sheet is applied immediately');
    assert.equal(pending.media, 'print', 'a pending sheet waits for its load event');
    assert.equal(listeners.length, 1);

    listeners[0]();
    assert.equal(pending.media, 'all', 'the load event applies the sheet');
  } finally {
    globalThis.document = original;
  }
});
