/**
 * Wishlist store ⇄ server sync (Phase 7).
 *
 * The saved list is local-only for guests and server-backed for signed-in
 * shoppers. These tests hold that contract to account:
 *
 *   - a guest never phones home: no client calls, no merge, sync stays idle;
 *   - a signed-in shopper's reads adopt the server list and saves/removes
 *     enqueue exactly one request each;
 *   - `mergeToServer` folds the local list into the customer list after
 *     sign-in and returns the merge summary.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWishlistStore } from '../js/state/wishlist.js';

const ID_A = '40000000-0000-4000-8000-000000000001';
const ID_B = '40000000-0000-4000-8000-000000000002';

function serverItem(productId, index) {
  return {
    productId,
    slug: `slug-${index}`,
    name: `Product ${index}`,
    image: null,
    priceMinor: 100000,
    savedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
  };
}

function wishlistView(items, extra = {}) {
  return { id: 'wishlist-1', name: 'My Wishlist', items, count: items.length, ...extra };
}

/** Records calls and serves a live in-memory customer list. */
function fakeServer(initialItems = [], { failPost = false } = {}) {
  const calls = [];
  let items = initialItems.map((item) => ({ ...item }));
  let failed = false;

  const client = {
    calls,
    get items() {
      return items;
    },

    async get(path) {
      calls.push({ method: 'get', path });
      if (path !== '/wishlist') throw new Error(`unexpected GET ${path}`);
      return { wishlist: wishlistView(items) };
    },

    async post(path, body) {
      calls.push({ method: 'post', path, body });
      if (path === '/wishlist/merge') {
        const incoming = [...new Set(body.productIds.map(String))];
        const existing = new Set(items.map((item) => item.productId));
        let added = 0;
        for (const productId of incoming) {
          if (existing.has(productId)) continue;
          items.unshift(serverItem(productId, items.length + added + 1));
          added += 1;
        }
        return { wishlist: wishlistView(items, { added, skipped: 0 }) };
      }
      if (path !== '/wishlist/items') throw new Error(`unexpected POST ${path}`);
      if (failPost && !failed) {
        failed = true;
        throw new Error('server rejected the save');
      }
      if (!items.some((item) => item.productId === body.productId)) {
        items.unshift(serverItem(body.productId, items.length + 1));
      }
      return { wishlist: wishlistView(items) };
    },

    async delete(path) {
      const productId = decodeURIComponent(path.split('/').pop());
      calls.push({ method: 'delete', path, productId });
      if (!path.startsWith('/wishlist/items/')) throw new Error(`unexpected DELETE ${path}`);
      items = items.filter((item) => item.productId !== productId);
      return { wishlist: wishlistView(items) };
    },
  };

  return client;
}

test('a guest store stays purely local: no requests, no merge, sync idle', async () => {
  const server = fakeServer();
  const wishlist = createWishlistStore({
    client: server,
    isAuthenticated: () => false,
  });

  wishlist.add(ID_A);
  const merged = await wishlist.mergeToServer();
  await wishlist.flush();

  assert.equal(merged, null, 'a guest has no server list to merge into');
  assert.equal(server.calls.length, 0, 'guests never call the wishlist API');
  assert.equal(wishlist.selectSyncStatus(), 'idle');
  assert.equal(wishlist.has(ID_A), true);
});

test('hydrate adopts a signed-in shopper server list', async () => {
  const server = fakeServer([serverItem(ID_A, 1), serverItem(ID_B, 2)]);
  const wishlist = createWishlistStore({
    client: server,
    isAuthenticated: () => true,
  });

  await wishlist.hydrate();

  assert.equal(server.calls[0].method, 'get');
  assert.equal(wishlist.selectSyncStatus(), 'ready');
  assert.deepEqual(wishlist.getState().productIds, [ID_A, ID_B], 'server order is the saved order');
  assert.equal(wishlist.selectCount(), 2);
});

test('saving and removing enqueue one request each and adopt the server list', async () => {
  const server = fakeServer([serverItem(ID_A, 1)]);
  const wishlist = createWishlistStore({
    client: server,
    isAuthenticated: () => true,
  });
  await wishlist.hydrate();

  wishlist.add(ID_B);
  await wishlist.flush();
  assert.deepEqual(server.calls.at(-1), {
    method: 'post',
    path: '/wishlist/items',
    body: { productId: ID_B },
  });
  assert.equal(wishlist.has(ID_B), true, 'adopted from the server');

  wishlist.toggle(ID_A);
  await wishlist.flush();
  assert.equal(server.calls.at(-1).method, 'delete');
  assert.equal(server.calls.at(-1).productId, ID_A);
  assert.equal(wishlist.has(ID_A), false);
});

test('mergeToServer folds the local list in and reports how many were added', async () => {
  const server = fakeServer([serverItem(ID_A, 1)]);
  // The shopper is a guest until the moment of sign-in, exactly like the app.
  let signedIn = false;
  const wishlist = createWishlistStore({
    client: server,
    isAuthenticated: () => signedIn,
  });

  // Guest saved this locally before sign-in; the guest never phones home, so
  // this id exists only in the browser. Then the shopper signs in.
  wishlist.add(ID_B);
  assert.equal(server.calls.length, 0, 'the guest save stayed local');
  signedIn = true;

  const view = await wishlist.mergeToServer();

  assert.equal(server.calls.at(-1).path, '/wishlist/merge');
  assert.deepEqual(server.calls.at(-1).body, { productIds: [ID_B] });
  assert.equal(view.added, 1);
  assert.equal(wishlist.has(ID_B), true);
  // ID_A was already on the server; ID_B was the only newcomer.
  assert.equal(server.calls.length, 1, 'merge is a single round-trip');
});

test('a failed save records the error but keeps the local item', async () => {
  const server = fakeServer([], { failPost: true });
  const wishlist = createWishlistStore({
    client: server,
    isAuthenticated: () => true,
  });

  wishlist.add(ID_A);
  await wishlist.flush();

  assert.equal(wishlist.selectSyncStatus(), 'error');
  assert.ok(wishlist.selectSyncError() instanceof Error);
  assert.equal(wishlist.has(ID_A), true, 'no rollback on a failed wishlist save');
});
