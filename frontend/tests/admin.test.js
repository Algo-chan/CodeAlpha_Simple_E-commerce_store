/**
 * Admin console — pure logic and the admin API wrapper.
 *
 * Two things are worth a fast Node test here:
 *
 *   helpers.js  the rules the UI reasons about before it offers a control: the
 *               order lifecycle, the status→tone map, hash routing, stock. None
 *               of it is a security boundary — the server re-decides everything —
 *               which is exactly why it can be tested without a browser.
 *
 *   api.js      the one place that knows each admin endpoint's URL and how to
 *               unwrap its response. A recording fake transport proves every
 *               path, verb and unwrap step without a network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_SECTIONS,
  ORDER_TRANSITIONS,
  ORDER_STATUSES,
  adjustmentSign,
  buildRoute,
  canTransition,
  describeAdjustment,
  formatAttributes,
  humanize,
  isLowStock,
  orderTransitions,
  parseRoute,
  priceRangeLabel,
  sectionTitle,
  signedQuantity,
  statusLabel,
  toneFor,
} from '../js/admin/helpers.js';
import { createAdminApi, adminApi } from '../js/admin/api.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A transport that records every call and answers with a canned payload.
 *
 * @param {{ respond?: Function, pageRespond?: Function }} [options]
 * @returns {object & { calls: object[] }}
 */
function makeClient({ respond = () => ({}), pageRespond = null } = {}) {
  const calls = [];

  function record(method) {
    return (path, payload) => {
      calls.push({ method, path, payload });
      return Promise.resolve(respond({ method, path, payload }));
    };
  }

  const client = {
    calls,
    get: record('get'),
    post: record('post'),
    patch: record('patch'),
    delete: record('delete'),
  };

  if (pageRespond) {
    client.getPage = (path, options) => {
      calls.push({ method: 'getPage', path, payload: options });
      return Promise.resolve(pageRespond({ path, options }));
    };
  }

  return client;
}

/* -------------------------------------------------------------------------- */
/* Order lifecycle                                                             */
/* -------------------------------------------------------------------------- */

test('the order lifecycle mirrors the server graph', () => {
  assert.deepEqual(ORDER_TRANSITIONS.PENDING, ['CONFIRMED', 'CANCELLED']);
  assert.deepEqual(ORDER_TRANSITIONS.SHIPPED, ['DELIVERED']);
  assert.deepEqual(ORDER_TRANSITIONS.DELIVERED, []);
  assert.deepEqual(ORDER_TRANSITIONS.CANCELLED, []);
  assert.deepEqual(ORDER_STATUSES, [
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
  ]);
});

test('orderTransitions returns a fresh array a caller cannot use to mutate the graph', () => {
  const copy = orderTransitions('PENDING');
  copy.push('DELIVERED');
  assert.deepEqual(orderTransitions('PENDING'), ['CONFIRMED', 'CANCELLED']);
});

test('orderTransitions of an unknown status is empty, not a crash', () => {
  assert.deepEqual(orderTransitions('TELEPORTED'), []);
});

test('canTransition allows only the legal edges', () => {
  assert.equal(canTransition('PENDING', 'CONFIRMED'), true);
  assert.equal(canTransition('PENDING', 'CANCELLED'), true);
  assert.equal(canTransition('PENDING', 'SHIPPED'), false);
  assert.equal(canTransition('DELIVERED', 'CANCELLED'), false);
});

/* -------------------------------------------------------------------------- */
/* Labels, tones, stock                                                        */
/* -------------------------------------------------------------------------- */

test('humanize turns enum values into read-able labels', () => {
  assert.equal(humanize('PENDING'), 'Pending');
  assert.equal(humanize('IN_TRANSIT'), 'In Transit');
  assert.equal(humanize(null), '—');
  assert.equal(humanize(undefined), '—');
  assert.equal(humanize(''), '—');
});

test('statusLabel is humanize by another name', () => {
  assert.equal(statusLabel('PROCESSING'), 'Processing');
});

test('toneFor maps known pairs and falls back to neutral for anything else', () => {
  assert.equal(toneFor('ORDER', 'DELIVERED'), 'success');
  assert.equal(toneFor('ORDER', 'PENDING'), 'warning');
  assert.equal(toneFor('PAYMENT', 'FAILED'), 'danger');
  assert.equal(toneFor('PRODUCT', 'ARCHIVED'), 'neutral');
  assert.equal(toneFor('ORDER', 'SOMETHING_NEW'), 'neutral');
  assert.equal(toneFor('UNKNOWN_DOMAIN', 'ACTIVE'), 'neutral');
});

test('isLowStock is availability at or below the reorder level', () => {
  assert.equal(isLowStock({ quantity: 5, reservedQuantity: 2, reorderLevel: 3 }), true);
  assert.equal(isLowStock({ quantity: 6, reservedQuantity: 2, reorderLevel: 3 }), false);
  assert.equal(isLowStock({ quantity: 0, reservedQuantity: 0, reorderLevel: 0 }), true);
});

test('signedQuantity prefixes additions and leaves removals alone', () => {
  assert.equal(signedQuantity(4), '+4');
  assert.equal(signedQuantity(-3), '-3');
  assert.equal(signedQuantity(0), '0');
  assert.equal(signedQuantity(null), '0');
});

test('adjustmentSign matches how each movement type affects stock', () => {
  assert.equal(adjustmentSign('RESTOCK'), 1);
  assert.equal(adjustmentSign('RETURN'), 1);
  assert.equal(adjustmentSign('DAMAGE'), -1);
  assert.equal(adjustmentSign('ADJUSTMENT'), 0);
  assert.equal(adjustmentSign('SALE'), 0);
});

test('describeAdjustment explains a movement for the operator', () => {
  assert.match(describeAdjustment('RESTOCK', 4), /4/);
  assert.match(describeAdjustment('DAMAGE', -4), /4/);
  assert.match(describeAdjustment('ADJUSTMENT', 1), /signed/i);
  assert.equal(describeAdjustment('SALE', 1), '');
});

test('formatAttributes flattens a variant attribute object', () => {
  assert.equal(formatAttributes({ color: 'Red', size: 'M' }), 'color: Red, size: M');
  assert.equal(formatAttributes({ color: 'Red', finish: '' }), 'color: Red');
  assert.equal(formatAttributes({}), '—');
  assert.equal(formatAttributes(null), '—');
  assert.equal(formatAttributes('not an object'), '—');
});

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

test('parseRoute reads a section and an id out of a hash', () => {
  assert.deepEqual(parseRoute('#/products/abc'), { section: 'products', id: 'abc' });
  assert.deepEqual(parseRoute('#/orders/ORD-1'), { section: 'orders', id: 'ORD-1' });
  assert.deepEqual(parseRoute('#/products'), { section: 'products', id: null });
  assert.deepEqual(parseRoute('#/products/'), { section: 'products', id: null });
});

test('parseRoute falls back to the dashboard for empty or unknown hashes', () => {
  assert.deepEqual(parseRoute(''), { section: 'dashboard', id: null });
  assert.deepEqual(parseRoute('#'), { section: 'dashboard', id: null });
  assert.deepEqual(parseRoute('#/'), { section: 'dashboard', id: null });
  assert.deepEqual(parseRoute('#/not-a-section/1'), { section: 'dashboard', id: null });
});

test('parseRoute decodes an id that needed encoding', () => {
  assert.deepEqual(parseRoute('#/products/a%20b'), { section: 'products', id: 'a b' });
});

test('buildRoute is the inverse of parseRoute', () => {
  assert.equal(buildRoute('products'), '#/products');
  assert.equal(buildRoute('products', 'a b'), '#/products/a%20b');
  assert.equal(buildRoute('orders', 'ORD-1'), '#/orders/ORD-1');
  assert.deepEqual(parseRoute(buildRoute('customers', 'c1')), { section: 'customers', id: 'c1' });
});

test('buildRoute refuses an unknown section', () => {
  assert.equal(buildRoute('not-a-section', '1'), '#/dashboard/1');
});

test('sectionTitle names a section and defaults to the dashboard', () => {
  assert.equal(sectionTitle('orders'), 'Orders');
  assert.equal(sectionTitle('audit'), 'Audit log');
  assert.equal(sectionTitle('nope'), 'Dashboard');
});

/* -------------------------------------------------------------------------- */
/* Prices and the sidebar model                                                */
/* -------------------------------------------------------------------------- */

test('priceRangeLabel shows a single price or a range', () => {
  const money = (n) => `ETB ${n}`;
  assert.equal(priceRangeLabel({ priceMin: 1000, priceMax: 1000 }, money), 'ETB 1000');
  assert.equal(priceRangeLabel({ priceMin: 1000, priceMax: 2000 }, money), 'ETB 1000 – ETB 2000');
  assert.equal(priceRangeLabel({ priceMin: null, priceMax: null }, money), '—');
});

test('the sidebar model lists every console section once', () => {
  const ids = ADMIN_SECTIONS.map((section) => section.id);
  assert.deepEqual(ids, [
    'dashboard',
    'products',
    'categories',
    'inventory',
    'orders',
    'customers',
    'reviews',
    'payments',
    'coupons',
    'audit',
  ]);
});

/* -------------------------------------------------------------------------- */
/* Admin API wrapper                                                           */
/* -------------------------------------------------------------------------- */

test('the default admin client exposes every section method', () => {
  for (const method of [
    'getDashboard',
    'listProducts',
    'getProduct',
    'createProduct',
    'updateProduct',
    'archiveProduct',
    'listVariants',
    'createVariant',
    'updateVariant',
    'deactivateVariant',
    'listImages',
    'createImage',
    'updateImage',
    'deleteImage',
    'listCategories',
    'getCategory',
    'createCategory',
    'updateCategory',
    'archiveCategory',
    'listInventory',
    'getLedger',
    'adjustInventory',
    'updateReorderLevel',
    'listOrders',
    'getOrder',
    'updateOrderStatus',
    'listCustomers',
    'getCustomer',
    'updateCustomerStatus',
    'listReviews',
    'getReview',
    'moderateReview',
    'listPayments',
    'getPayment',
    'listAuditLogs',
  ]) {
    assert.equal(typeof adminApi[method], 'function', `${method} should be a function`);
  }
});

test('getDashboard unwraps data.dashboard', async () => {
  const client = makeClient({ respond: () => ({ dashboard: { totalOrders: 3 } }) });
  const result = await createAdminApi(client).getDashboard();
  assert.deepEqual(result, { totalOrders: 3 });
  assert.equal(client.calls[0].method, 'get');
  assert.equal(client.calls[0].path, '/admin/dashboard');
});

test('a paginated list uses getPage and surfaces meta.pagination', async () => {
  const pagination = { page: 2, totalPages: 4, total: 61 };
  const client = makeClient({
    pageRespond: () => ({ data: { products: [{ id: 'p1' }] }, meta: { pagination } }),
  });
  const result = await createAdminApi(client).listProducts({ page: 2, search: 'oak' });

  assert.deepEqual(result.products, [{ id: 'p1' }]);
  assert.deepEqual(result.pagination, pagination);
  assert.equal(client.calls[0].method, 'getPage');
  assert.equal(client.calls[0].path, '/admin/products');
  assert.deepEqual(client.calls[0].payload, { query: { page: 2, search: 'oak' } });
});

test('a list falls back to get with null pagination when the client has no getPage', async () => {
  const client = makeClient({ respond: () => ({ products: [{ id: 'p1' }] }) });
  const result = await createAdminApi(client).listProducts();

  assert.deepEqual(result.products, [{ id: 'p1' }]);
  assert.equal(result.pagination, null);
  assert.equal(client.calls[0].method, 'get');
});

test('createProduct POSTs the body and unwraps the created product', async () => {
  const client = makeClient({
    respond: ({ payload }) => ({ product: { id: 'p1', ...payload } }),
  });
  const product = await createAdminApi(client).createProduct({ name: 'Oak Chair' });

  assert.deepEqual(product, { id: 'p1', name: 'Oak Chair' });
  assert.equal(client.calls[0].method, 'post');
  assert.equal(client.calls[0].path, '/admin/products');
  assert.deepEqual(client.calls[0].payload, { name: 'Oak Chair' });
});

test('product and variant mutations target the right resource', async () => {
  const client = makeClient({ respond: () => ({ product: {}, variants: [] }) });
  const api = createAdminApi(client);

  await api.archiveProduct('p1');
  assert.deepEqual(client.calls.at(-1), {
    method: 'post',
    path: '/admin/products/p1/archive',
    payload: undefined,
  });

  await api.updateVariant('v1', { price: 2000 });
  assert.equal(client.calls.at(-1).method, 'patch');
  assert.equal(client.calls.at(-1).path, '/admin/variants/v1');
  assert.deepEqual(client.calls.at(-1).payload, { price: 2000 });

  await api.deactivateVariant('v1');
  assert.equal(client.calls.at(-1).method, 'delete');
  assert.equal(client.calls.at(-1).path, '/admin/variants/v1');
});

test('category archive is a POST to the archive sub-resource', async () => {
  const client = makeClient({ respond: () => ({ category: { id: 'c1' } }) });
  await createAdminApi(client).archiveCategory('c1');
  assert.deepEqual(client.calls[0], {
    method: 'post',
    path: '/admin/categories/c1/archive',
    payload: undefined,
  });
});

test('inventory adjust unwraps the item and posts the movement', async () => {
  const client = makeClient({ respond: () => ({ item: { variantId: 'v1', quantity: 12 } }) });
  const item = await createAdminApi(client).adjustInventory('v1', {
    type: 'RESTOCK',
    quantity: 4,
  });

  assert.deepEqual(item, { variantId: 'v1', quantity: 12 });
  assert.equal(client.calls[0].path, '/admin/inventory/v1/adjust');
  assert.deepEqual(client.calls[0].payload, { type: 'RESTOCK', quantity: 4 });
});

test('the ledger returns the variant, its entries and pagination together', async () => {
  const page = { page: 1, totalPages: 1, total: 2 };
  const client = makeClient({
    pageRespond: () => ({
      data: { variant: { id: 'v1' }, entries: [{ quantity: 4 }, { quantity: -1 }] },
      meta: { pagination: page },
    }),
  });
  const ledger = await createAdminApi(client).getLedger('v1');

  assert.deepEqual(ledger.variant, { id: 'v1' });
  assert.equal(ledger.entries.length, 2);
  assert.deepEqual(ledger.pagination, page);
  assert.equal(client.calls[0].path, '/admin/inventory/v1/ledger');
});

test('a status change is a PATCH to the order status sub-resource', async () => {
  const client = makeClient({ respond: () => ({ order: { status: 'CONFIRMED' } }) });
  const order = await createAdminApi(client).updateOrderStatus('ORD-20260101-0001', {
    status: 'CONFIRMED',
  });

  assert.equal(order.status, 'CONFIRMED');
  assert.equal(client.calls[0].method, 'patch');
  assert.equal(client.calls[0].path, '/admin/orders/ORD-20260101-0001/status');
  assert.deepEqual(client.calls[0].payload, { status: 'CONFIRMED' });
});

test('customer suspension is a PATCH to the customer status sub-resource', async () => {
  const client = makeClient({ respond: () => ({ customer: { status: 'SUSPENDED' } }) });
  await createAdminApi(client).updateCustomerStatus('u1', { status: 'SUSPENDED' });
  assert.equal(client.calls[0].path, '/admin/customers/u1/status');
});

test('review moderation is a PATCH and unwraps the review', async () => {
  const client = makeClient({ respond: () => ({ review: { status: 'APPROVED' } }) });
  const review = await createAdminApi(client).moderateReview('r1', { status: 'APPROVED' });
  assert.equal(review.status, 'APPROVED');
  assert.equal(client.calls[0].path, '/admin/reviews/r1/status');
});

test('audit logs are paginated and unwrapped from data.logs', async () => {
  const client = makeClient({
    pageRespond: () => ({
      data: { logs: [{ action: 'PRODUCT_CREATED' }] },
      meta: { pagination: { page: 1, totalPages: 1, total: 1 } },
    }),
  });
  const result = await createAdminApi(client).listAuditLogs({ entityType: 'PRODUCT' });
  assert.deepEqual(result.logs, [{ action: 'PRODUCT_CREATED' }]);
  assert.equal(result.pagination.total, 1);
});
