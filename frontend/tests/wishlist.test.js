/**
 * Wishlist state.
 *
 * Per Phase 2 a wishlist row targets a PRODUCT, not a variant: the shopper
 * saves the thing and picks a size later. So the store holds ids only, which is
 * what these tests hold it to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWishlistStore } from '../js/state/wishlist.js';
import { fixtureCatalogue } from '../js/mock/api.js';

const ID_A = '40000000-0000-4000-8000-000000000001';
const ID_B = '40000000-0000-4000-8000-000000000002';

test('a new wishlist is empty', () => {
  const wishlist = createWishlistStore();

  assert.equal(wishlist.selectIsEmpty(), true);
  assert.equal(wishlist.selectCount(), 0);
});

test('toggle saves then unsaves', () => {
  const wishlist = createWishlistStore();

  assert.equal(wishlist.toggle(ID_A), true, 'first toggle saves');
  assert.equal(wishlist.has(ID_A), true);

  assert.equal(wishlist.toggle(ID_A), false, 'second toggle unsaves');
  assert.equal(wishlist.has(ID_A), false);
});

test('the most recently saved product comes first', () => {
  const wishlist = createWishlistStore();

  wishlist.add(ID_A);
  wishlist.add(ID_B);

  assert.deepEqual(wishlist.getState().productIds, [ID_B, ID_A]);
});

test('add is idempotent and does not duplicate or reorder', () => {
  const wishlist = createWishlistStore();

  wishlist.add(ID_A);
  wishlist.add(ID_B);

  assert.equal(wishlist.add(ID_A), false, 'already saved');
  assert.deepEqual(wishlist.getState().productIds, [ID_B, ID_A]);
});

test('remove only affects the requested product', () => {
  const wishlist = createWishlistStore();

  wishlist.add(ID_A);
  wishlist.add(ID_B);
  wishlist.remove(ID_A);

  assert.deepEqual(wishlist.getState().productIds, [ID_B]);
});

test('an empty or missing id is ignored rather than stored', () => {
  const wishlist = createWishlistStore();

  for (const value of [null, undefined, '']) {
    assert.equal(wishlist.toggle(value), false);
    assert.equal(wishlist.add(value), false);
    wishlist.remove(value);
  }

  assert.equal(wishlist.selectIsEmpty(), true, 'nothing invalid was stored');
});

test('ids are normalised to strings so has() is honest', () => {
  const wishlist = createWishlistStore();

  wishlist.toggle(42);

  assert.equal(wishlist.has('42'), true, 'a number matches its string form');
  assert.equal(wishlist.has(42), true);
});

test('a UUID is never coerced through a number', () => {
  // The catalogue ids are UUIDs, which are far past Number.MAX_SAFE_INTEGER, so
  // a caller must never pass one through Number(). This pins the string path.
  const wishlist = createWishlistStore();
  wishlist.add(ID_A);

  assert.equal(wishlist.has(ID_A), true);
  assert.equal(wishlist.getState().productIds[0], ID_A, 'stored verbatim, not reformatted');
});

test('partition splits a product list into saved and unsaved', () => {
  const wishlist = createWishlistStore();
  const products = [{ id: ID_A }, { id: ID_B }];
  wishlist.add(ID_A);

  const { saved, unsaved } = wishlist.partition(products);

  assert.deepEqual(
    saved.map((p) => p.id),
    [ID_A]
  );
  assert.deepEqual(
    unsaved.map((p) => p.id),
    [ID_B]
  );
});

test('sortBySavedOrder drops products that are not saved', () => {
  const wishlist = createWishlistStore();
  wishlist.add(ID_A);
  wishlist.add(ID_B);

  const ordered = wishlist.sortBySavedOrder([{ id: ID_A }, { id: ID_B }, { id: 'other' }]);

  assert.deepEqual(
    ordered.map((p) => p.id),
    [ID_B, ID_A],
    'most recently saved first, unsaved dropped'
  );
});

test('a per-product selector lets one button repaint instead of the whole grid', () => {
  const wishlist = createWishlistStore();
  const isSavedA = wishlist.selectIsSaved(ID_A);
  const isSavedB = wishlist.selectIsSaved(ID_B);

  assert.equal(isSavedA(), false);
  assert.equal(isSavedB(), false);

  wishlist.add(ID_A);

  assert.equal(isSavedA(), true);
  assert.equal(isSavedB(), false);
});

test('a selector for a missing id is permanently false', () => {
  const wishlist = createWishlistStore();
  const isSaved = wishlist.selectIsSaved(null);

  wishlist.add(ID_A);

  assert.equal(isSaved(), false);
});

test('clear empties the list', () => {
  const wishlist = createWishlistStore();
  wishlist.add(ID_A);
  wishlist.clear();

  assert.equal(wishlist.selectIsEmpty(), true);
});

test('every saved id resolves to a real product in the catalogue', () => {
  const wishlist = createWishlistStore();
  const { products } = fixtureCatalogue();
  const known = new Set(products.map((product) => String(product.id)));

  for (const product of products.slice(0, 5)) wishlist.add(product.id);

  for (const id of wishlist.selectIds()) {
    assert.ok(known.has(String(id)), `saved id ${id} should exist in the catalogue`);
  }
});
