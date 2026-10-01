/**
 * 07_orders_payments_reviews.seed.js — two completed purchases, one guest
 * checkout, one failed online attempt, and a verified-purchase review.
 *
 * Snapshots are the point of this file. Every order_item copies the product
 * name, SKU, variant attributes and unit price as they were at purchase time,
 * and every order copies the delivery address. Change the product price or the
 * customer address afterwards and these orders read exactly the same.
 *
 *   ORD-20260115-0001  Abebe, DELIVERED, COD, paid          -> stock sold
 *   ORD-20260120-0002  guest, PENDING, COD, unpaid         -> stock reserved
 *   ORD-20260122-0003  Sara, CANCELLED, ONLINE, failed     -> no stock movement
 *
 * Inventory balances are written as absolute values, not as relative updates,
 * so re-running this seed is a no-op instead of decrementing stock twice.
 *
 * Timestamps come from _reference_time.js rather than NOW(), so the story is
 * identical on every machine and every run.
 */
import { daysBeforeNow } from './_reference_time.js';

const ABBE_ID = '10000000-0000-4000-8000-000000000002';
const SARA_ID = '10000000-0000-4000-8000-000000000003';

const NIKE = '40000000-0000-4000-8000-000000000001';
const SAMSUNG = '40000000-0000-4000-8000-000000000002';
const MACBOOK = '40000000-0000-4000-8000-000000000003';
const TSHIRT = '40000000-0000-4000-8000-000000000004';
const JBL = '40000000-0000-4000-8000-000000000005';
const COFFEE = '40000000-0000-4000-8000-000000000006';

const ORDERS = [
  {
    id: '90000000-0000-4000-8000-000000000001',
    orderNumber: 'ORD-20260115-0001',
    placedDaysAgo: 8,
    userId: ABBE_ID,
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'COD',
    subtotal: 1820000,
    deliveryFee: 50000,
    discountTotal: 0,
    total: 1870000,
    customerEmail: 'abebe@example.com',
    customerPhone: '0911223344',
    customerNotes: 'Please leave the parcel with the doorman.',
    shippingAddressSnapshot: {
      label: 'Home',
      full_name: 'Abebe Bekele',
      phone: '0911223344',
      city: 'Addis Ababa',
      area: 'Bole',
      street: 'Bole Road, House 24',
      landmark: 'Near Bole Medhanialem',
      additional_notes: 'Call before arriving; I work until 6pm.',
    },
  },
  {
    // Guest checkout: no account, so the fulfilment contact lives on the order.
    id: '90000000-0000-4000-8000-000000000002',
    orderNumber: 'ORD-20260120-0002',
    placedDaysAgo: 3,
    userId: null,
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'COD',
    subtotal: 3240000,
    deliveryFee: 50000,
    discountTotal: 0,
    total: 3290000,
    customerEmail: 'mekdes@example.com',
    customerPhone: '0944556677',
    customerNotes: 'Call when you arrive, I am near the cathedral.',
    shippingAddressSnapshot: {
      label: null,
      full_name: 'Mekdes Girma',
      phone: '0944556677',
      city: 'Addis Ababa',
      area: 'Arada',
      street: 'Ras Hailu, Building 12',
      landmark: 'Beside St. George Cathedral',
      additional_notes: 'Second floor, no lift.',
    },
  },
  {
    id: '90000000-0000-4000-8000-000000000003',
    orderNumber: 'ORD-20260122-0003',
    placedDaysAgo: 1,
    userId: SARA_ID,
    status: 'CANCELLED',
    paymentStatus: 'FAILED',
    paymentMethod: 'ONLINE',
    subtotal: 7800000,
    deliveryFee: 50000,
    discountTotal: 0,
    total: 7850000,
    customerEmail: 'sara@example.com',
    customerPhone: '0922334455',
    customerNotes: null,
    shippingAddressSnapshot: {
      label: 'Home',
      full_name: 'Sara Mohammed',
      phone: '0922334455',
      city: 'Addis Ababa',
      area: 'Kirkos',
      street: 'Bole Bulbula, Apartment 3B',
      landmark: 'Opposite Millennium Hall',
      additional_notes: null,
    },
  },
];

const ORDER_ITEMS = [
  {
    id: '91000000-0000-4000-8000-000000000001',
    orderId: '90000000-0000-4000-8000-000000000001',
    productId: NIKE,
    variantId: '50000000-0000-4000-8000-000000000003',
    productName: 'Nike Air Max 270',
    sku: 'NIKE-AM270-BLK-42',
    variantAttributes: { color: 'Black', size: '42' },
    unitPrice: 470000,
    quantity: 2,
    subtotal: 940000,
  },
  {
    id: '91000000-0000-4000-8000-000000000002',
    orderId: '90000000-0000-4000-8000-000000000001',
    productId: NIKE,
    variantId: '50000000-0000-4000-8000-000000000006',
    productName: 'Nike Air Max 270',
    sku: 'NIKE-AM270-WHT-42',
    variantAttributes: { color: 'White', size: '42' },
    unitPrice: 470000,
    quantity: 1,
    subtotal: 470000,
  },
  {
    id: '91000000-0000-4000-8000-000000000003',
    orderId: '90000000-0000-4000-8000-000000000001',
    productId: JBL,
    variantId: '50000000-0000-4000-8000-000000000017',
    productName: 'JBL Tune 510BT',
    sku: 'JBL-510BT-BLK',
    variantAttributes: { color: 'Black' },
    unitPrice: 245000,
    quantity: 1,
    subtotal: 245000,
  },
  {
    id: '91000000-0000-4000-8000-000000000004',
    orderId: '90000000-0000-4000-8000-000000000001',
    productId: COFFEE,
    variantId: '50000000-0000-4000-8000-000000000019',
    productName: 'Ceramic Coffee Set (4 piece)',
    sku: 'COFFEE-SET-4PC',
    variantAttributes: {},
    unitPrice: 165000,
    quantity: 1,
    subtotal: 165000,
  },
  {
    id: '91000000-0000-4000-8000-000000000005',
    orderId: '90000000-0000-4000-8000-000000000002',
    productId: TSHIRT,
    variantId: '50000000-0000-4000-8000-000000000014',
    productName: 'Ethiopian Cotton T-Shirt',
    sku: 'TSHIRT-BLK-M',
    variantAttributes: { color: 'Black', size: 'M' },
    unitPrice: 95000,
    quantity: 2,
    subtotal: 190000,
  },
  {
    id: '91000000-0000-4000-8000-000000000006',
    orderId: '90000000-0000-4000-8000-000000000002',
    productId: SAMSUNG,
    variantId: '50000000-0000-4000-8000-000000000009',
    productName: 'Samsung Galaxy A55',
    sku: 'SAM-A55-256-8-NAVY',
    variantAttributes: { storage: '256GB', ram: '8GB', color: 'Navy' },
    unitPrice: 3050000,
    quantity: 1,
    subtotal: 3050000,
  },
  {
    id: '91000000-0000-4000-8000-000000000007',
    orderId: '90000000-0000-4000-8000-000000000003',
    productId: MACBOOK,
    variantId: '50000000-0000-4000-8000-000000000011',
    productName: 'Apple MacBook Air 13" (M3)',
    sku: 'MBA13-M3-256-MID',
    variantAttributes: { storage: '256GB', color: 'Midnight' },
    unitPrice: 7800000,
    quantity: 1,
    subtotal: 7800000,
  },
];

const PAYMENTS = [
  {
    id: '92000000-0000-4000-8000-000000000001',
    orderId: '90000000-0000-4000-8000-000000000001',
    provider: 'INTERNAL',
    method: 'COD',
    status: 'PAID',
    amount: 1870000,
    transactionReference: null,
    failureReason: null,
    paidAt: daysBeforeNow(6),
  },
  {
    id: '92000000-0000-4000-8000-000000000002',
    orderId: '90000000-0000-4000-8000-000000000002',
    provider: 'INTERNAL',
    method: 'COD',
    status: 'PENDING',
    amount: 3290000,
    transactionReference: null,
    failureReason: null,
    paidAt: null,
  },
  {
    // A failed online attempt. The provider name is free-form, so a real
    // Stripe or Telebirr integration needs no schema change.
    id: '92000000-0000-4000-8000-000000000003',
    orderId: '90000000-0000-4000-8000-000000000003',
    provider: 'STRIPE',
    method: 'ONLINE',
    status: 'FAILED',
    amount: 7850000,
    transactionReference: 'pi_demo_failed_attempt_0001',
    failureReason: 'Card declined by issuer',
    paidAt: null,
  },
];

const REVIEWS = [
  {
    id: '95000000-0000-4000-8000-000000000001',
    userId: ABBE_ID,
    productId: NIKE,
    // The purchased line that proves the purchase, from the delivered order.
    orderItemId: '91000000-0000-4000-8000-000000000001',
    rating: 5,
    title: 'Comfortable straight out of the box',
    comment:
      'Wore them for two weeks straight during the rainy season and they still ' +
      'look new. The size chart is accurate - I am usually between sizes and ' +
      'took my usual.',
    status: 'APPROVED',
    // Written a few days after the delivery, like a real customer.
    reviewedDaysAgo: 4,
  },
];

/**
 * Absolute stock levels after the orders above. Written as full values so the
 * seed stays idempotent.
 */
const INVENTORY_AFTER_ORDERS = [
  { variantId: '50000000-0000-4000-8000-000000000003', quantity: 0, reserved: 0 }, // Black / 42, sold out
  { variantId: '50000000-0000-4000-8000-000000000006', quantity: 3, reserved: 0 }, // White / 42
  { variantId: '50000000-0000-4000-8000-000000000017', quantity: 19, reserved: 0 }, // JBL Black
  { variantId: '50000000-0000-4000-8000-000000000019', quantity: 14, reserved: 0 }, // Coffee set
  { variantId: '50000000-0000-4000-8000-000000000009', quantity: 9, reserved: 1 }, // Samsung 256GB
  { variantId: '50000000-0000-4000-8000-000000000014', quantity: 45, reserved: 2 }, // T-shirt Black / M
];

/** Stock movements caused by the delivered order. */
const ORDER_STOCK_MOVEMENTS = [
  { variantId: '50000000-0000-4000-8000-000000000003', quantity: -2 },
  { variantId: '50000000-0000-4000-8000-000000000006', quantity: -1 },
  { variantId: '50000000-0000-4000-8000-000000000017', quantity: -1 },
  { variantId: '50000000-0000-4000-8000-000000000019', quantity: -1 },
];

const ORDER_ID = '90000000-0000-4000-8000-000000000001';

export default async function up({ query }) {
  for (const order of ORDERS) {
    await query(
      `INSERT INTO orders
         (id, order_number, user_id, status, subtotal, delivery_fee, discount_total,
          total, payment_status, payment_method, customer_email, customer_phone,
          shipping_address_snapshot, customer_notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::JSONB, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         order_number              = EXCLUDED.order_number,
         user_id                   = EXCLUDED.user_id,
         status                    = EXCLUDED.status,
         subtotal                  = EXCLUDED.subtotal,
         delivery_fee              = EXCLUDED.delivery_fee,
         discount_total            = EXCLUDED.discount_total,
         total                     = EXCLUDED.total,
         payment_status            = EXCLUDED.payment_status,
         payment_method            = EXCLUDED.payment_method,
         customer_email            = EXCLUDED.customer_email,
         customer_phone            = EXCLUDED.customer_phone,
         shipping_address_snapshot = EXCLUDED.shipping_address_snapshot,
         customer_notes            = EXCLUDED.customer_notes,
         created_at                = EXCLUDED.created_at`,
      [
        order.id,
        order.orderNumber,
        order.userId,
        order.status,
        order.subtotal,
        order.deliveryFee,
        order.discountTotal,
        order.total,
        order.paymentStatus,
        order.paymentMethod,
        order.customerEmail,
        order.customerPhone,
        JSON.stringify(order.shippingAddressSnapshot),
        order.customerNotes,
        daysBeforeNow(order.placedDaysAgo),
      ]
    );
  }

  for (const item of ORDER_ITEMS) {
    await query(
      `INSERT INTO order_items
         (id, order_id, product_id, variant_id, product_name, sku,
          variant_attributes, unit_price, quantity, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         product_name       = EXCLUDED.product_name,
         sku                = EXCLUDED.sku,
         variant_attributes = EXCLUDED.variant_attributes,
         unit_price         = EXCLUDED.unit_price,
         quantity           = EXCLUDED.quantity,
         subtotal           = EXCLUDED.subtotal`,
      [
        item.id,
        item.orderId,
        item.productId,
        item.variantId,
        item.productName,
        item.sku,
        JSON.stringify(item.variantAttributes),
        item.unitPrice,
        item.quantity,
        item.subtotal,
      ]
    );
  }

  for (const payment of PAYMENTS) {
    await query(
      `INSERT INTO payments
         (id, order_id, provider, method, status, amount, transaction_reference,
          failure_reason, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         provider             = EXCLUDED.provider,
         method               = EXCLUDED.method,
         status               = EXCLUDED.status,
         amount               = EXCLUDED.amount,
         transaction_reference = EXCLUDED.transaction_reference,
         failure_reason       = EXCLUDED.failure_reason,
         paid_at              = EXCLUDED.paid_at`,
      [
        payment.id,
        payment.orderId,
        payment.provider,
        payment.method,
        payment.status,
        payment.amount,
        payment.transactionReference,
        payment.failureReason,
        payment.paidAt,
      ]
    );
  }

  for (const level of INVENTORY_AFTER_ORDERS) {
    await query(
      `UPDATE inventory
          SET quantity = $2, reserved_quantity = $3
        WHERE variant_id = $1`,
      [level.variantId, level.quantity, level.reserved]
    );
  }

  for (const [index, movement] of ORDER_STOCK_MOVEMENTS.entries()) {
    await query(
      `INSERT INTO inventory_transactions
         (id, variant_id, transaction_type, quantity, reference_type, reference_id, note)
       VALUES ($1, $2, 'SALE', $3, 'ORDER', $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         quantity     = EXCLUDED.quantity,
         reference_id = EXCLUDED.reference_id`,
      [
        `61000000-0000-4000-8000-0000000000${String(index + 1).padStart(2, '0')}`,
        movement.variantId,
        movement.quantity,
        ORDER_ID,
        'Sold on ORD-20260115-0001',
      ]
    );
  }

  for (const review of REVIEWS) {
    await query(
      `INSERT INTO reviews
         (id, user_id, product_id, order_item_id, rating, title, comment, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         rating    = EXCLUDED.rating,
         title     = EXCLUDED.title,
         comment   = EXCLUDED.comment,
         status    = EXCLUDED.status,
         created_at = EXCLUDED.created_at`,
      [
        review.id,
        review.userId,
        review.productId,
        review.orderItemId,
        review.rating,
        review.title,
        review.comment,
        review.status,
        daysBeforeNow(review.reviewedDaysAgo),
      ]
    );
  }
}
