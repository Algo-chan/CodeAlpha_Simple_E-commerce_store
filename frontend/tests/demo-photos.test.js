/**
 * Demo photograph integrity.
 *
 * The catalogue fixtures name their photos by angle (`photos: ['front', ...]`)
 * and `mock/media.js` turns that into `/assets/images/products/<slug>/<angle>.webp`
 * plus a `-thumb` rendition. Nothing in the browser complains when one of those
 * files is missing - the card simply renders a broken image icon - so the file
 * names are only as trustworthy as a test that walks the manifest and checks the
 * disk.
 *
 * These also pin the two properties the components rely on: a distinct URL per
 * angle (the gallery must change something when you switch frame) and a
 * thumbnail that is its own, smaller request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureCatalogue } from '../js/mock/api.js';
import { PHOTO_BASE } from '../js/mock/media.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '..');

const catalogue = fixtureCatalogue();

/** `/assets/images/products/x/front.webp` -> the file on disk. */
function resolveAsset(url) {
  assert.ok(url.startsWith(PHOTO_BASE), `unexpected asset base in "${url}"`);
  return path.join(FRONTEND_DIR, url.replace(/^\//, ''));
}

test('every product ships at least three photos', () => {
  for (const product of catalogue.products) {
    assert.ok(product.images.length >= 3, `${product.slug} should have 3+ photos`);
  }
});

test('every referenced photo exists on disk as a non-trivial WebP', () => {
  for (const product of catalogue.products) {
    for (const image of product.images) {
      for (const url of [image.url, image.thumb_url]) {
        const file = resolveAsset(url);
        assert.ok(fs.existsSync(file), `${product.slug}: missing ${url}`);
        assert.ok(fs.statSync(file).size > 1024, `${product.slug}: suspiciously small ${url}`);
      }
      assert.match(image.url, /\.webp$/, `${product.slug}: photos should be WebP`);
    }
  }
});

test('a thumbnail is a separate, smaller file than its full image', () => {
  for (const product of catalogue.products) {
    for (const image of product.images) {
      assert.notEqual(image.thumb_url, image.url, `${product.slug}: thumbnail is its own request`);

      const full = fs.statSync(resolveAsset(image.url)).size;
      const thumb = fs.statSync(resolveAsset(image.thumb_url)).size;
      assert.ok(
        thumb < full,
        `${product.slug}: ${image.thumb_url} should be smaller than its image`
      );
    }
  }
});

test('every photo angle resolves to a label and one primary image', () => {
  for (const product of catalogue.products) {
    for (const image of product.images) {
      assert.ok(image.angle, `${product.slug}: an angle label drives the gallery caption`);
      assert.ok(image.alt, `${product.slug}: alt text is required`);
    }
    assert.equal(
      product.images.filter((image) => image.is_primary).length,
      1,
      `${product.slug}: exactly one primary image`
    );
  }
});
