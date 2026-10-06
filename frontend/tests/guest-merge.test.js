/**
 * The guest-to-customer basket transition.
 *
 * The invariant under test: when a guest signs in, the basket they built has
 * either already survived (non-empty cart wins) or is restored from the
 * snapshot (empty cart), and the one-time record is always stood down either
 * way. The storage throw cases matter because a blocked localStorage must not
 * take the sign-in down with it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  snapshotGuestState,
  pendingGuestSync,
  hasPendingGuestSync,
  clearGuestSync,
  finalizeGuestTransition,
  GUEST_SYNC_KEY,
  GUEST_SYNC_VERSION,
} from '../js/state/guest-merge.js';

/** A Map-backed localStorage, the same shape the other persistence tests use. */
function memoStorage() {
  const written = new Map();
  globalThis.localStorage = {
    getItem: (key) => written.get(key) ?? null,
    setItem: (key, value) => written.set(key, value),
    removeItem: (key) => written.delete(key),
  };
  return written;
}

/** A minimally honest cart + wishlist pair the finalizer can drive. */
function stores(seed = { lines: [], ids: [] }) {
  const cart = {
    lines: [...seed.lines],
    selectLines: () => cart.lines,
    restoreLine(line) {
      cart.lines.push(line);
      return { ok: true };
    },
  };
  const wishlist = {
    ids: [...seed.ids],
    getState: () => ({ productIds: wishlist.ids }),
    add(id) {
      wishlist.ids.push(id);
      return true;
    },
  };
  return { cart, wishlist };
}

const LINE = { variantId: 'v-1', quantity: 2 };

test('snapshot stores lines and ids under a versioned, namespaced key', () => {
  memoStorage();

  const ok = snapshotGuestState({ lines: [LINE], productIds: ['p-1', 'p-2'] });

  assert.equal(ok, true);
  const raw = JSON.parse(globalThis.localStorage.getItem(`aie:${GUEST_SYNC_KEY}`));
  assert.equal(raw.__v, GUEST_SYNC_VERSION);
  assert.deepEqual(raw.data.productIds, ['p-1', 'p-2']);
  assert.deepEqual(raw.data.lines, [LINE]);
  assert.ok(hasPendingGuestSync());
});

test('snapshot is idempotent: the first write wins', () => {
  const written = memoStorage();
  snapshotGuestState({ lines: [LINE], productIds: ['p-1'] });
  const first = JSON.parse(written.get(`aie:${GUEST_SYNC_KEY}`)).data;

  const secondWrote = snapshotGuestState({ lines: [], productIds: ['p-2'] });
  const second = JSON.parse(written.get(`aie:${GUEST_SYNC_KEY}`)).data;

  assert.equal(secondWrote, false, 'a second sign-in must not clobber the pending basket');
  assert.deepEqual(second.productIds, first.productIds);
  assert.deepEqual(second.lines, first.lines);
});

test('clearGuestSync stands the record down', () => {
  memoStorage();
  snapshotGuestState({ lines: [LINE], productIds: ['p-1'] });

  clearGuestSync();

  assert.equal(hasPendingGuestSync(), false);
  assert.equal(pendingGuestSync(), null);
});

test('finalize with no pending snapshot is a no-op', () => {
  memoStorage();
  const { cart, wishlist } = stores();

  const result = finalizeGuestTransition({ cart, wishlist });

  assert.deepEqual(result, { cleared: false, restoredLines: 0, restoredSaved: 0 });
  assert.equal(cart.lines.length, 0);
  assert.equal(wishlist.ids.length, 0);
});

test('finalize restores the snapshot only into an empty basket', () => {
  memoStorage();
  snapshotGuestState({ lines: [LINE, { variantId: 'v-2', quantity: 1 }], productIds: ['p-1'] });
  const { cart, wishlist } = stores();

  const result = finalizeGuestTransition({ cart, wishlist });

  assert.deepEqual(result, { cleared: true, restoredLines: 2, restoredSaved: 1 });
  assert.equal(cart.lines.length, 2, 'every captured line is put back');
  assert.deepEqual(wishlist.ids, ['p-1']);
  assert.equal(hasPendingGuestSync(), false);
});

test('a non-empty cart wins: snapshot is dropped unmerged', () => {
  memoStorage();
  snapshotGuestState({ lines: [LINE], productIds: ['p-1'] });
  const existing = { variantId: 'v-9', quantity: 3 };
  const { cart, wishlist } = stores({ lines: [existing], ids: ['p-9'] });

  const result = finalizeGuestTransition({ cart, wishlist });

  assert.deepEqual(result, { cleared: true, restoredLines: 0, restoredSaved: 0 });
  assert.deepEqual(cart.lines, [existing], 'the live cart is untouched');
  assert.deepEqual(wishlist.ids, ['p-9']);
  assert.equal(hasPendingGuestSync(), false, 'the record is still stood down');
});

test('a blocked storage never breaks the transition', () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {
      throw new Error('denied');
    },
  };

  try {
    const wrote = snapshotGuestState({ lines: [LINE], productIds: ['p-1'] });
    assert.equal(wrote, false, 'a failed write reports itself instead of throwing');

    const { cart, wishlist } = stores();
    const result = finalizeGuestTransition({ cart, wishlist });
    assert.deepEqual(result, { cleared: false, restoredLines: 0, restoredSaved: 0 });
  } finally {
    delete globalThis.localStorage;
  }
});
