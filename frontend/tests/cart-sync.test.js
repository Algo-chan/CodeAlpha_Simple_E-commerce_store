/**
 * Cart store ⇄ server sync (Phase 7).
 *
 * The cart becomes server-backed when the store is given a `client`. These
 * tests hold that contract to account:
 *
 *   - hydration adopts the server cart, ids and availability flags included;
 *   - every mutation enqueues exactly one request in tap order;
 *   - a failed mutation rolls the optimistic line back to the server's view
 *     and records the error instead of silently keeping fiction on screen;
 *   - the legacy no-client store stays purely local and never touches the fake
 *     network.
 *
 * The fake server speaks the real `/api/v1/cart` surface and applies the real
 * merge/clamp semantics (duplicate variants sum, quantities clamp), so the
 * store's optimism is tested against the shape the backend actually returns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCartStore, MAX_QUANTITY } from '../js/state/cart.js';

const VARIANT_A = '50000000-0000-4000-8000-000000000001';
const VARIANT_B = '50000000-0000-4000-8000-000000000002';

function serverItem({ id, variantId, quantity = 1, available = 10, reason = null } = {}) {
  return {
    id: id ?? `item-${variantId}`,
    variantId,
    productId: variantId.replace('50000000', '40000000'),
    slug: 'product',
    name: 'Product',
    variantName: 'Black',
    image: null,
    unitPrice: 100000,
    compareAtPrice: null,
    quantity,
    maxQuantity: Math.min(MAX_QUANTITY, available),
    available,
    unavailableReason: reason,
    lineTotal: 100000 * quantity,
  };
}

function cartView(items) {
  const buyable = items.filter((item) => !item.unavailableReason);
  return {
    id: 'cart-1',
    owner: 'guest',
    items,
    itemCount: items.length,
    count: buyable.reduce((total, item) => total + item.quantity, 0),
    subtotal: buyable.reduce((total, item) => total + item.lineTotal, 0),
  };
}

/**
 * A store wired the way app.js wires it: a client plus a catalogue
 * `resolveVariant` so every variant id resolves to something purchasable.
 */
function cartWith(server) {
  return createCartStore({
    client: server ?? null,
    resolveVariant: (variantId) => ({
      id: variantId,
      product_id: String(variantId).replace('50000000', '40000000'),
      product: { slug: 'product', name: 'Product', primary_image: null },
      attributes: { color: 'Black' },
      price_minor: 100000,
      is_active: true,
      is_purchasable: true,
      stock: { quantity: 10, reserved_quantity: 0, available: 10, is_tracked: true },
    }),
  });
}

/**
 * A scriptable fake of the real cart API. Requests are recorded, responses are
 * produced from a live in-memory cart so the store's adopted server state can
 * be examined honestly.
 */
function fakeServer(initialItems = [], { failPostItems = false } = {}) {
  const calls = [];
  let lines = initialItems.map((item) => ({ ...item }));
  let failed = false;

  /** The real backend repairs quantities on every read/write; model that. */
  function repair() {
    lines = lines.map((item) => {
      if (item.available == null || item.quantity <= item.available) return item;
      const quantity = Math.max(1, Math.min(item.available, item.maxQuantity));
      return { ...item, quantity, lineTotal: item.unitPrice * quantity };
    });
  }

  const client = {
    calls,
    /** Current server-side item list under test. */
    get items() {
      return lines;
    },

    async get(path) {
      calls.push({ method: 'get', path });
      if (path !== '/cart') throw new Error(`unexpected GET ${path}`);
      repair();
      return { cart: cartView(lines) };
    },

    async post(path, body) {
      calls.push({ method: 'post', path, body });
      if (path !== '/cart/items') throw new Error(`unexpected POST ${path}`);

      if (failPostItems && !failed) {
        failed = true;
        throw new Error('server refused the item');
      }

      repair();
      const variantId = String(body.variantId);
      const line = lines.find((item) => item.variantId === variantId);
      if (line) {
        line.quantity = Math.min(line.quantity + body.quantity, line.available);
        line.lineTotal = line.unitPrice * line.quantity;
      } else {
        lines.push(serverItem({ variantId, quantity: body.quantity }));
      }
      return { cart: cartView(lines) };
    },

    async patch(path, body) {
      calls.push({ method: 'patch', path, body });
      const itemId = path.split('/').pop();
      const line = lines.find((item) => item.id === itemId);
      if (!line) throw new Error(`no such item ${itemId}`);
      line.quantity = Math.min(body.quantity, line.available);
      line.lineTotal = line.unitPrice * line.quantity;
      return { cart: cartView(lines) };
    },

    async delete(path) {
      calls.push({ method: 'delete', path });
      if (path === '/cart') {
        lines = [];
        return { cart: cartView(lines) };
      }
      const itemId = path.split('/').pop();
      lines = lines.filter((item) => item.id !== itemId);
      return { cart: cartView(lines) };
    },
  };

  return client;
}

test('without a client the store stays purely local and never requests', async () => {
  const cart = createCartStore();
  const result = cart.hydrate();
  assert.equal(result instanceof Promise, true);

  const line = {
    variantId: VARIANT_A,
    productId: '40000000-0000-4000-8000-000000000001',
    slug: 'p',
    name: 'P',
    variantName: null,
    image: null,
    unitPrice: 100000,
    quantity: 1,
    maxQuantity: MAX_QUANTITY,
  };
  cart.setState({ lines: [line] });

  await cart.flush();
  assert.equal(cart.selectSyncStatus(), 'idle', 'sync metadata stays idle without a client');
  assert.equal(cart.getState().lines.length, 1);
});

test('hydrate adopts the server cart, including ids, availability and flags', async () => {
  const server = fakeServer([
    serverItem({ id: 'a', variantId: VARIANT_A, quantity: 2 }),
    serverItem({ id: 'b', variantId: VARIANT_B, reason: 'sold-out' }),
  ]);
  const cart = cartWith(server);

  await cart.hydrate();

  assert.equal(server.calls[0].path, '/cart');
  assert.equal(cart.selectSyncStatus(), 'ready');

  const lines = cart.getState().lines;
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 'a');
  assert.equal(lines[0].variantId, VARIANT_A);
  assert.equal(lines[0].quantity, 2);
  assert.equal(lines[0].maxQuantity, 10);

  const soldOut = lines[1];
  assert.equal(soldOut.id, 'b');
  assert.equal(soldOut.unavailableReason, 'sold-out', 'flags survive the mapping');
  assert.equal(cart.selectCount(), 2, 'only the buyable line counts');
  assert.equal(cart.selectSubtotal(), 100000 * 2);
});

test('adding a variant enqueues a POST and then adopts the server cart', async () => {
  const server = fakeServer();
  const cart = cartWith(server);

  cart.add(VARIANT_A, 2);
  await cart.flush();

  assert.deepEqual(server.calls[0], {
    method: 'post',
    path: '/cart/items',
    body: { variantId: VARIANT_A, quantity: 2 },
  });
  assert.equal(cart.selectSyncStatus(), 'ready');

  const [line] = cart.getState().lines;
  assert.equal(line.variantId, VARIANT_A);
  assert.equal(line.quantity, 2);
  assert.ok(line.id, 'the adopted line carries its server id');
});

test('each duplicate-add tap enqueues one POST; the server sums the line', async () => {
  const server = fakeServer();
  const cart = cartWith(server);

  cart.add(VARIANT_A);
  cart.add(VARIANT_A);
  await cart.flush();

  const posts = server.calls.filter((call) => call.method === 'post');
  assert.equal(posts.length, 2, 'one POST per tap');
  assert.equal(cart.getState().lines.length, 1, 'still one line locally');
  assert.equal(cart.getState().lines[0].quantity, 2, 'the quantity totals both taps');
  assert.equal(server.items[0].quantity, 2, 'the server cart holds the same total');
});

test('mutations reach the server in tap order (serial queue)', async () => {
  const server = fakeServer();
  const cart = cartWith(server);

  cart.add(VARIANT_A);
  cart.add(VARIANT_B, 3);
  await cart.flush();

  const posts = server.calls.filter((call) => call.method === 'post');
  assert.deepEqual(
    posts.map((call) => call.body),
    [
      { variantId: VARIANT_A, quantity: 1 },
      { variantId: VARIANT_B, quantity: 3 },
    ]
  );
});

test('setQuantity PATCHes the server line by its id', async () => {
  const server = fakeServer([serverItem({ id: 'a', variantId: VARIANT_A, quantity: 1 })]);
  const cart = cartWith(server);
  await cart.hydrate();

  cart.setQuantity(VARIANT_A, 4);
  await cart.flush();

  const patch = server.calls.find((call) => call.method === 'patch');
  assert.deepEqual(patch, { method: 'patch', path: '/cart/items/a', body: { quantity: 4 } });
  assert.equal(cart.getState().lines[0].quantity, 4);
});

test('remove DELETEs the server line using its cart-item id', async () => {
  const server = fakeServer([serverItem({ id: 'a', variantId: VARIANT_A })]);
  const cart = cartWith(server);
  await cart.hydrate();

  cart.remove(VARIANT_A);
  await cart.flush();

  assert.deepEqual(server.calls.at(-1), { method: 'delete', path: '/cart/items/a' });
  assert.equal(cart.selectIsEmpty(), true);
});

test('clear DELETEs the whole server cart', async () => {
  const server = fakeServer([
    serverItem({ id: 'a', variantId: VARIANT_A }),
    serverItem({ id: 'b', variantId: VARIANT_B }),
  ]);
  const cart = cartWith(server);
  await cart.hydrate();

  cart.clear();
  await cart.flush();

  assert.ok(server.calls.some((call) => call.method === 'delete' && call.path === '/cart'));
  assert.equal(cart.selectIsEmpty(), true);
});

test('restoreLine re-uploads the undone line by variant', async () => {
  const server = fakeServer([serverItem({ id: 'a', variantId: VARIANT_A, quantity: 2 })]);
  const cart = cartWith(server);
  await cart.hydrate();

  const [line] = cart.getState().lines;
  cart.remove(VARIANT_A);
  await cart.flush();

  cart.restoreLine(line);
  await cart.flush();

  const post = server.calls.at(-1);
  assert.equal(post.method, 'post');
  assert.equal(post.path, '/cart/items');
  assert.deepEqual(post.body, { variantId: VARIANT_A, quantity: 2 });
});

test('a failed add records the error and rolls back to the server view', async () => {
  const server = fakeServer([], { failPostItems: true });
  const cart = cartWith(server);

  cart.add(VARIANT_A, 2);
  await cart.flush();

  assert.equal(cart.selectSyncStatus(), 'error');
  assert.ok(cart.selectSyncError() instanceof Error);
  assert.equal(cart.getState().lines.length, 0, 'the optimistic line was rolled back');
  assert.ok(
    server.calls.some((call) => call.method === 'get' && call.path === '/cart'),
    'a follow-up read rebuilt the server truth'
  );
});

test('the server wins on clamping: adopted quantity reflects server caps', async () => {
  const server = fakeServer();
  const cart = cartWith(server);

  cart.add(VARIANT_A, 5);
  await cart.flush();

  // Push the server's own ceiling down underneath the line, as live stock
  // moving would, then re-read: the store adopts quantity 3, not 5.
  server.items[0].available = 3;
  server.items[0].maxQuantity = 3;
  cart.hydrate();
  await cart.flush();

  assert.equal(cart.getState().lines[0].quantity, 3, 'hydration honours a reduced ceiling');
});

test('quantity caps still use the store maximum when a line is unbounded', () => {
  const cart = createCartStore({ resolveVariant: () => ({ id: VARIANT_B }) });
  const line = {
    variantId: VARIANT_B,
    productId: '40000000-0000-4000-8000-000000000002',
    slug: 'p',
    name: 'P',
    variantName: null,
    image: null,
    unitPrice: 100000,
    quantity: MAX_QUANTITY,
    maxQuantity: MAX_QUANTITY,
  };
  cart.setState({ lines: [line] });
  assert.equal(cart.selectCount(), MAX_QUANTITY);
});
