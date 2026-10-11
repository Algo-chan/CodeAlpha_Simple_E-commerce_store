/**
 * Online payment API tests (Phase 9).
 *
 * Exercises the whole money path against PGlite: ONLINE checkout, intent
 * creation, signature-verified webhooks, and the rule that an order is only
 * confirmed by a *verified* payment — never by a frontend claiming to have won.
 *
 * The security surface this file cares about:
 *   - a webhook must be signed over the exact raw bytes sent;
 *   - the gateway's reference, amount and currency must match OUR rows;
 *   - replaying a notification is a no-op (idempotency), never a double-settle;
 *   - COD stays exactly as it was and cannot be turned into an online payment;
 *   - stale PENDING intents expire instead of pinning an order forever.
 *
 * Refund execution is intentionally NOT tested as working: the architecture is
 * declared and the provider reports it disabled.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigratedDb } from './helpers/database.js';
import { createApp } from '../src/app.js';
import env from '../src/config/env.js';
import { signPayload } from '../src/payments/signature.js';
import {
  calculateDeliveryFee,
  estimateDelivery,
  getDeliveryOptions,
  formatEta,
} from '../src/services/delivery.service.js';
import * as paymentService from '../src/services/payment.service.js';

const SESSION = 'ecom_session';
const ORIGIN = 'http://localhost:5173';
const WEBHOOK_SECRET = env.PAYMENT_WEBHOOK_SECRET;

let db;
let app;
let seq = 0;
let emailSeq = 0;

test.before(async () => {
  db = await createMigratedDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

test.after(async () => {
  await db?.close();
});

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                          */
/* -------------------------------------------------------------------------- */

function nextId() {
  seq += 1;
  return `30000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
}

async function makeVariant({
  price = 100000,
  stock = 5,
  attributes = { color: 'Black', size: '42' },
} = {}) {
  const variantId = nextId();
  const productId = nextId();
  await db.query(
    `INSERT INTO products (id, name, slug, product_type, status)
     VALUES ($1, $2, $3, 'PHYSICAL', 'ACTIVE')`,
    [productId, `Payment Fixture ${seq}`, `payment-fixture-${seq}`]
  );
  await db.query(
    `INSERT INTO product_variants (id, product_id, sku, price, attributes, is_active)
     VALUES ($1, $2, $3, $4, $5::JSONB, true)`,
    [variantId, productId, `SKU-PAY-${seq}`, price, JSON.stringify(attributes)]
  );
  await db.query(
    `INSERT INTO inventory (variant_id, quantity, reserved_quantity)
     VALUES ($1, $2, 0)`,
    [variantId, stock]
  );
  return { variantId, productId };
}

function specificCookie(res, name) {
  const headers = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(headers) ? headers : [headers];
  const entry = list.find((cookie) => cookie.startsWith(`${name}=`));
  if (!entry) return null;
  return { raw: entry, value: entry.slice(entry.indexOf('=') + 1).split(';')[0] };
}

async function register(email) {
  const res = await request(app).post('/api/v1/auth/register').send({
    name: 'Payment Tester',
    email,
    phone: '0911223344',
    password: 'StrongPass1!',
    passwordConfirmation: 'StrongPass1!',
  });
  assert.equal(res.status, 201, `register should succeed (${email}): ${res.body?.error?.message}`);
  return specificCookie(res, SESSION);
}

async function createShopper(tag = 'payer') {
  emailSeq += 1;
  const session = await register(`${tag}-${emailSeq}@example.com`);
  return { session };
}

function authedAdd(session, variantId, quantity = 1) {
  return request(app)
    .post('/api/v1/cart/items')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ variantId, quantity });
}

function authedCheckout(session, body) {
  return request(app)
    .post('/api/v1/checkout')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send(body);
}

const ADDRESS = { city: 'Addis Ababa', area: 'Bole', street: 'Bole Road 1' };

/**
 * Shops one item and places an ONLINE order for the shopper, then initialises
 * the payment intent. Returns the order number and the init response.
 */
async function placeOnlineOrder(totalQuantity = 1) {
  const { session } = await createShopper('payer');
  const { variantId } = await makeVariant({ price: 100000, stock: 20 });
  const added = await authedAdd(session, variantId, totalQuantity);
  assert.equal(added.status, 200, `add failed: ${added.body?.error?.message}`);

  const checkout = await authedCheckout(session, { ...ADDRESS, payment_method: 'ONLINE' });
  assert.equal(checkout.status, 201, `online checkout failed: ${checkout.body?.error?.message}`);
  const orderNumber = checkout.body.data.order.orderNumber;

  const init = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(init.status, 201, `init failed: ${init.body?.error?.message}`);

  return { session, variantId, orderNumber, init, order: checkout.body.data.order };
}

/** Builds a signed webhook request against the exact bytes that will be sent. */
function webhook(provider, body, { timestamp, secret } = {}) {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(body);
  const signature = signPayload(secret ?? WEBHOOK_SECRET, raw, ts);
  return request(app)
    .post(`/api/v1/payments/webhook/${provider}`)
    .set('Content-Type', 'application/json')
    .set('x-payment-timestamp', ts)
    .set('x-payment-signature', `sha256=${signature}`)
    .send(raw);
}

function paidEvent(reference, { amount, currency = 'ETB' } = {}) {
  return { reference, status: 'SUCCESS', amount, currency };
}

function failedEvent(
  reference,
  { amount, currency = 'ETB', failureReason = 'Card declined during sandbox.' } = {}
) {
  return { reference, status: 'FAILED', amount, currency, failure_reason: failureReason };
}

/* -------------------------------------------------------------------------- */
/* Happy path                                                                  */
/* -------------------------------------------------------------------------- */

test('a verified PAID webhook confirms an ONLINE order', async () => {
  const { session, orderNumber, init } = await placeOnlineOrder();

  const reference = init.body.data.payment.reference;
  assert.match(reference, /^MOCK-/);
  assert.equal(init.body.data.payment.status, 'PENDING');
  assert.equal(init.body.data.nextAction.type, 'redirect');
  assert.equal(init.body.data.sandbox, true);

  const total = init.body.data.payment.amount;
  const res = await webhook('MOCK', paidEvent(reference, { amount: total }));
  assert.equal(res.status, 200, `webhook rejected: ${res.body?.error?.message}`);
  assert.equal(res.body.data.status, 'PAID');
  assert.equal(res.body.data.duplicate, false);

  // Payment row settled, order confirmed, all atomically.
  const { rows: payments } = await db.query(
    `SELECT p.status AS payment_status, p.paid_at, p.transaction_reference,
            o.payment_status AS order_payment_status, o.status AS order_status
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.order_number = $1`,
    [orderNumber]
  );
  assert.equal(payments.length, 1);
  assert.equal(payments[0].payment_status, 'PAID');
  assert.equal(payments[0].transaction_reference, reference);
  assert.ok(payments[0].paid_at, 'a PAID payment must record when the money moved');
  assert.equal(payments[0].order_payment_status, 'PAID');
  assert.equal(payments[0].order_status, 'CONFIRMED');

  const { rows: orderRows } = await db.query(
    `SELECT status, payment_status FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  assert.equal(orderRows[0].status, 'CONFIRMED', 'a verified payment confirms the order');
  assert.equal(orderRows[0].payment_status, 'PAID');

  // The shopper's order detail reflects the settlement.
  const detail = await request(app).get(`/api/v1/orders/${orderNumber}`).set('Cookie', session.raw);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.order.payment.status, 'PAID');
  assert.equal(detail.body.data.order.payment.provider, 'MOCK');
});

test('a FAILED webhook keeps the order retryable', async () => {
  const { session, orderNumber, init } = await placeOnlineOrder();
  const reference = init.body.data.payment.reference;
  const total = init.body.data.payment.amount;

  const res = await webhook('MOCK', failedEvent(reference, { amount: total }));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'FAILED');

  const { rows: orderRows } = await db.query(
    `SELECT status, payment_status FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  assert.equal(orderRows[0].payment_status, 'FAILED');
  assert.equal(orderRows[0].status, 'PENDING', 'a failed payment must not confirm the order');

  const { rows: paymentRows } = await db.query(
    `SELECT status, failure_reason FROM payments
      WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`,
    [orderNumber]
  );
  assert.equal(paymentRows[0].status, 'FAILED');
  assert.ok(paymentRows[0].failure_reason, 'a FAILED row must say why');

  // The shopper can start a fresh intent after the failure.
  const retry = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(retry.status, 201, 'a failed order must be retryable');
  const retryReference = retry.body.data.payment.reference;
  assert.notEqual(retryReference, reference, 'a retry gets a fresh provider reference');

  const paid = await webhook('MOCK', paidEvent(retryReference, { amount: total }));
  assert.equal(paid.body.data.status, 'PAID');
  const { rows: afterRows } = await db.query(`SELECT status FROM orders WHERE order_number = $1`, [
    orderNumber,
  ]);
  assert.equal(afterRows[0].status, 'CONFIRMED', 'the order confirms once the retry is paid');
});

test('replayed webhooks are idempotent — one payment row, no double effects', async () => {
  const { orderNumber, init } = await placeOnlineOrder();
  const reference = init.body.data.payment.reference;
  const total = init.body.data.payment.amount;
  const event = paidEvent(reference, { amount: total });

  const first = await webhook('MOCK', event);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.duplicate, false);

  const second = await webhook('MOCK', event);
  assert.equal(second.status, 200, 'a replay answers 200 so the gateway stops retrying');
  assert.equal(second.body.data.duplicate, true);

  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM payments
      WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`,
    [orderNumber]
  );
  assert.equal(rows[0].n, 1, 'the same transaction must never create a second payment row');

  const state = await db.query(
    `SELECT status, payment_status FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  assert.equal(state.rows[0].status, 'CONFIRMED');
  assert.equal(state.rows[0].payment_status, 'PAID');
});

/* -------------------------------------------------------------------------- */
/* Webhook security                                                            */
/* -------------------------------------------------------------------------- */

test('a webhook with an invalid signature is rejected', async () => {
  const { orderNumber, init } = await placeOnlineOrder();
  const reference = init.body.data.payment.reference;
  const total = init.body.data.payment.amount;
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(paidEvent(reference, { amount: total }));
  const wrong = signPayload('not-the-secret', raw, ts);

  const res = await request(app)
    .post('/api/v1/payments/webhook/MOCK')
    .set('Content-Type', 'application/json')
    .set('x-payment-timestamp', ts)
    .set('x-payment-signature', wrong)
    .send(raw);

  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');

  const { rows } = await db.query(
    `SELECT status, payment_status FROM orders WHERE order_number = $1`,
    [orderNumber]
  );
  assert.equal(rows[0].payment_status, 'PENDING', 'a rejected webhook must not settle anything');
  assert.equal(rows[0].status, 'PENDING');
});

test('a webhook billing the wrong amount is rejected', async () => {
  const { orderNumber, init } = await placeOnlineOrder();
  const reference = init.body.data.payment.reference;
  const total = init.body.data.payment.amount + 10000;

  const res = await webhook('MOCK', paidEvent(reference, { amount: total }));
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');

  const { rows } = await db.query(
    `SELECT status FROM payments
      WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`,
    [orderNumber]
  );
  assert.equal(rows[0].status, 'PENDING');
});

test('a webhook billing the wrong currency is rejected', async () => {
  const { init } = await placeOnlineOrder();
  const reference = init.body.data.payment.reference;
  const total = init.body.data.payment.amount;

  const res = await webhook('MOCK', paidEvent(reference, { amount: total, currency: 'USD' }));
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('a webhook for an unknown transaction is rejected', async () => {
  const res = await webhook(
    'MOCK',
    paidEvent('MOCK-00000000-0000-0000-0000-000000000000', { amount: 100000 })
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('a webhook from an unknown provider is rejected', async () => {
  const { init } = await placeOnlineOrder();
  const res = await webhook('NONSENSE', paidEvent(init.body.data.payment.reference, { amount: 1 }));
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('a webhook without a signature is rejected', async () => {
  const res = await request(app)
    .post('/api/v1/payments/webhook/MOCK')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ reference: 'MOCK-x', status: 'SUCCESS', amount: 1 }));
  assert.equal(res.status, 401);
});

/* -------------------------------------------------------------------------- */
/* Initiation rules                                                            */
/* -------------------------------------------------------------------------- */

test('creating an intent requires an authenticated shopper', async () => {
  const res = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .send({ order_number: 'ORD-20260101-0001' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('a shopper cannot pay another account order (404, not a leak)', async () => {
  const { orderNumber } = await placeOnlineOrder();
  const { session } = await createShopper('stranger');

  const res = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('a COD order refuses online payment with PAYMENT_NOT_REQUIRED', async () => {
  const { session } = await (async () => {
    const s = await createShopper('cod');
    const v = await makeVariant({ price: 100000, stock: 5 });
    const added = await authedAdd(s.session, v.variantId);
    assert.equal(added.status, 200);
    return { session: s.session };
  })();

  const checkout = await authedCheckout(session, { ...ADDRESS, payment_method: 'COD' });
  assert.equal(checkout.status, 201);
  const orderNumber = checkout.body.data.order.orderNumber;
  assert.equal(checkout.body.data.order.payment.provider, 'INTERNAL');

  const res = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'PAYMENT_NOT_REQUIRED');
});

test('a COD checkout creates a PENDING INTERNAL payment, exactly as before', async () => {
  const { session } = await createShopper('codverify');
  const { variantId } = await makeVariant({ price: 100000, stock: 5 });
  await authedAdd(session, variantId);
  const checkout = await authedCheckout(session, { ...ADDRESS, payment_method: 'COD' });
  assert.equal(checkout.status, 201);
  const orderNumber = checkout.body.data.order.orderNumber;

  const { rows } = await db.query(
    `SELECT p.provider, p.method, p.status, p.amount
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.order_number = $1`,
    [orderNumber]
  );
  assert.equal(rows[0].provider, 'INTERNAL');
  assert.equal(rows[0].method, 'COD');
  assert.equal(rows[0].status, 'PENDING');
});

test('an already-paid order refuses a second intent', async () => {
  const { session, orderNumber, init, order } = await placeOnlineOrder();
  await webhook('MOCK', paidEvent(init.body.data.payment.reference, { amount: order.total }));

  const res = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

/* -------------------------------------------------------------------------- */
/* Timeout                                                                    */
/* -------------------------------------------------------------------------- */

test('stale PENDING payments are expired and the order reverts to FAILED', async () => {
  const { session, orderNumber, init, order } = await placeOnlineOrder();
  assert.equal(order.paymentStatus, 'PENDING');
  assert.ok(init.body.data.payment.reference);

  // Backdate the attempt well past the configured timeout.
  await db.query(
    `UPDATE payments SET created_at = NOW() - INTERVAL '4 hours'
      WHERE order_id = (SELECT id FROM orders WHERE order_number = $1)`,
    [orderNumber]
  );

  const expired = await paymentService.expireStalePending(
    { query: (text, params = []) => db.query(text, params) },
    { timeoutMinutes: 30 }
  );
  assert.equal(expired, 1, 'the stale attempt must be expired');

  const { rows } = await db.query(
    `SELECT p.status, p.failure_reason, o.payment_status
       FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE o.order_number = $1`,
    [orderNumber]
  );
  assert.equal(rows[0].status, 'FAILED');
  assert.match(rows[0].failure_reason, /timed out/i);
  assert.equal(rows[0].payment_status, 'FAILED');

  // The order still belongs to the shopper and stays retryable.
  const retry = await request(app)
    .post('/api/v1/payments')
    .set('Origin', ORIGIN)
    .set('Cookie', session.raw)
    .send({ order_number: orderNumber });
  assert.equal(retry.status, 201);
});

/* -------------------------------------------------------------------------- */
/* Refund foundation (architecture only)                                       */
/* -------------------------------------------------------------------------- */

test('refunds are declared but not executable in this phase', async () => {
  await assert.rejects(
    () => paymentService.refundPayment({}, { providerName: 'MOCK' }),
    (error) =>
      error.statusCode === 501 && error.code === 'NOT_IMPLEMENTED' && /refund/i.test(error.message)
  );

  await assert.rejects(
    () => paymentService.refundPayment({}, { providerName: 'INTERNAL' }),
    (error) => error.code === 'NOT_IMPLEMENTED'
  );
});

/* -------------------------------------------------------------------------- */
/* Delivery configuration                                                     */
/* -------------------------------------------------------------------------- */

test('the flat delivery fee is waived at or above the free threshold', () => {
  assert.equal(calculateDeliveryFee({ subtotalMinor: 100000 }).feeMinor, 50000);
  assert.equal(calculateDeliveryFee({ subtotalMinor: 499999 }).isFree, false);
  assert.equal(calculateDeliveryFee({ subtotalMinor: 500000 }).feeMinor, 0);
  assert.equal(calculateDeliveryFee({ subtotalMinor: 500000 }).isFree, true);
  assert.equal(calculateDeliveryFee({ subtotalMinor: 900000 }).remainingForFreeMinor, 0);
  assert.equal(
    calculateDeliveryFee({ city: 'Addis Ababa', area: 'Bole', subtotalMinor: 100000 }).feeMinor,
    50000
  );
});

test('the standard zone carries an estimated delivery window and availability', () => {
  const estimate = estimateDelivery({ city: 'Addis Ababa', area: 'Bole' });
  assert.equal(estimate.zone, 'Standard');
  assert.equal(estimate.available, true);
  assert.equal(estimate.etaMinDays, 2);
  assert.equal(estimate.etaMaxDays, 5);
  assert.equal(estimate.etaLabel, '2–5 days');
  assert.equal(formatEta({ etaMinDays: 1, etaMaxDays: 1 }), '1 day');
});

test('delivery options expose the same rules the checkout transaction uses', () => {
  const options = getDeliveryOptions();
  assert.equal(options.currency, 'ETB');
  assert.equal(options.defaultFeeMinor, 50000);
  assert.equal(options.freeThresholdMinor, 500000);
  assert.deepEqual(options.defaultEta, { minDays: 2, maxDays: 5, label: '2–5 days' });
  assert.deepEqual(options.zones, []);
});
