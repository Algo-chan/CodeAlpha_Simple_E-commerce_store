/**
 * Checkout service — creates an order from a cart, transactionally.
 *
 * THE WHOLE POINT OF THIS FILE IS THE TRANSACTION. Everything between
 * `runInTransaction` and its return either commits together or rolls back
 * together. A caller can never observe a half-built order: no order row without
 * its lines, no lines without a payment record, no stock removed without a
 * ledger entry, no cleared cart without an order to show for it.
 *
 * The steps, in order, mirror the phase brief:
 *
 *   1. resolve + lock the cart (guests by cookie hash, customers by user id)
 *   2. validate the cart is not empty
 *   3. validate every line's product status and variant
 *   4. validate inventory (and lock it, so the check holds until commit)
 *   5. recompute authoritative prices from the database — never the client
 *   6. compute the subtotal
 *   7. compute the delivery fee from the delivery service
 *   8. allocate an order number
 *   9. insert the order (with a delivery-address snapshot)
 *  10. insert the order items (with name/SKU/options/price snapshots)
 *  11. insert the payment record (COD = internal provider, ONLINE = configured)
 *  12. deduct inventory atomically and append a ledger row per tracked line
 *  13. clear the cart
 *  14. commit
 *
 * Identity never comes from the body. `userId` is resolved by the auth
 * middleware; a guest is recognised only by the hash of their cart cookie, the
 * same rule the cart layer uses.
 */
import { runInTransaction } from '../utils/transaction.js';
import { AppError } from '../utils/app-error.js';
import {
  ERROR_CODES,
  PAYMENT_METHOD,
  PAYMENT_PROVIDER,
  PAYMENT_STATUS,
  ORDER_STATUS,
} from '../config/constants.js';
import * as carts from '../repositories/cart.repository.js';
import * as orders from '../repositories/order.repository.js';
import * as inventory from '../repositories/inventory.repository.js';
import { calculateDeliveryFee } from './delivery.service.js';
import { normaliseAttributes } from './catalogue.view.js';
import { toOrderView } from './order.view.js';
import { getActiveOnlineProvider } from '../payments/index.js';
import * as couponService from './coupon.service.js';

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

const cartEmpty = () =>
  new AppError('Your cart is empty. Add something before checking out.', 409, 'CART_EMPTY');

const productUnavailable = (name) =>
  new AppError(
    name
      ? `"${name}" is no longer available for purchase.`
      : 'An item in your cart is no longer available.',
    409,
    'PRODUCT_UNAVAILABLE'
  );

const insufficientStock = ({ available, requested }) =>
  new AppError(
    available > 0
      ? `Only ${available} unit${available === 1 ? '' : 's'} of this item remain.`
      : 'This item sold out while you were checking out.',
    409,
    'INSUFFICIENT_STOCK',
    { available, requested }
  );

const missingContact = (field) =>
  new AppError(`A ${field} is required to place this order.`, 422, ERROR_CODES.VALIDATION_ERROR, {
    errors: [{ field, source: 'body', code: 'required', message: `${field} is required` }],
  });

/* -------------------------------------------------------------------------- */
/* Cart resolution                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Finds the caller's ACTIVE cart and locks it for the rest of the transaction.
 *
 * Locking the cart row first is what serialises checkout against concurrent
 * cart mutations: every cart write locks the same row before touching lines, so
 * nothing can add or remove a line midway through placing the order.
 */
async function lockCart(tx, { userId, guestToken }) {
  if (userId) {
    return carts.findActiveByUser(tx, userId, { forUpdate: true });
  }
  if (guestToken) {
    return carts.findActiveByTokenHash(tx, carts.hashCartToken(guestToken), { forUpdate: true });
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Contact fallbacks                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Guests must supply their own contact details; a signed-in customer may fall
 * back to the name, email and phone on their account. Whatever is chosen is
 * copied onto the order so it survives account deletion.
 *
 * Field names follow `addressSchema` (`full_name`, `phone`) plus an `email`,
 * matching the addresses endpoint the shopper has already used.
 */
function resolveContact(input, user) {
  const name = clean(input.full_name) ?? clean(user?.name);
  const email = clean(input.email) ?? clean(user?.email);
  const phone = clean(input.phone) ?? clean(user?.phone);

  if (!name) throw missingContact('name');
  if (!email) throw missingContact('email');
  if (!phone) throw missingContact('phone');

  return { name, email: email.toLowerCase(), phone };
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/* -------------------------------------------------------------------------- */
/* Payment method                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the payment method and provider for a checkout.
 *
 * COD is always the store itself (provider INTERNAL). ONLINE is only accepted
 * while an online provider is configured; otherwise the shopper gets a clear
 * 503-style refusal instead of an order that can never be settled. The provider
 * name is copied onto the payment row so the webhook knows which gateway owns it.
 *
 * @returns {{ method: string, provider: string }}
 */
function resolvePaymentMethod(input) {
  const method = input?.payment_method ?? PAYMENT_METHOD.COD;
  if (method !== PAYMENT_METHOD.ONLINE) {
    return { method: PAYMENT_METHOD.COD, provider: PAYMENT_PROVIDER.INTERNAL };
  }

  const online = getActiveOnlineProvider();
  if (!online) {
    throw new AppError(
      'Online payment is not available right now. Please use cash on delivery.',
      422,
      ERROR_CODES.SERVICE_UNAVAILABLE
    );
  }
  return { method: PAYMENT_METHOD.ONLINE, provider: online.name };
}

/* -------------------------------------------------------------------------- */
/* Checkout                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Places an order for the current cart.
 *
 * @param {object} db request-scoped executor (may be undefined in production)
 * @param {{ userId: string|null, guestToken: string|null }} context
 * @param {object} input validated checkout body
 * @param {{ user?: object|null }} [options]
 * @returns {Promise<{ order: object, cookie: null, merged: false }>}
 */
export async function checkout(db, context, input, { user = null } = {}) {
  return runInTransaction(db, async (tx) => {
    /* 1–2. Resolve, lock and validate the cart. */
    const cart = await lockCart(tx, context);
    if (!cart) throw cartEmpty();

    const rows = await carts.listItems(tx, cart.id);
    if (rows.length === 0) throw cartEmpty();

    /* 3–5. Validate each line and build the authoritative line list. */
    const lines = [];
    let subtotal = 0;

    for (const row of rows) {
      if (!row.variant_row_id || !row.product_id) {
        throw productUnavailable(row.product_name);
      }

      // Lock the variant row and re-read its state, so a price change or a
      // deactivation between listing and now is caught here rather than
      // silently baked into the order.
      const variant = await carts.lockVariant(tx, row.variant_id);
      if (!variant || variant.product_status !== 'ACTIVE' || variant.is_active !== true) {
        throw productUnavailable(variant?.product_name ?? row.product_name);
      }

      const stock = await inventory.lockInventory(tx, row.variant_id);
      const quantity = Number(row.quantity);
      if (stock) {
        const available = Number(stock.quantity) - Number(stock.reserved_quantity);
        if (available < quantity) throw insufficientStock({ available, requested: quantity });
      }

      const unitPrice = Number(variant.price);
      const lineSubtotal = unitPrice * quantity;
      subtotal += lineSubtotal;

      lines.push({
        productId: variant.product_id,
        variantId: variant.id,
        productName: variant.product_name,
        sku: variant.sku ?? null,
        variantAttributes: normaliseAttributes(variant.attributes),
        unitPrice,
        quantity,
        subtotal: lineSubtotal,
        tracked: Boolean(stock),
      });
    }

    /* 6–7. Totals. Delivery is computed from the destination, never the client. */
    const contact = resolveContact(input, user);
    const address = buildAddressSnapshot(input, contact);
    const delivery = calculateDeliveryFee({
      subtotalMinor: subtotal,
      city: input.city,
      area: input.area,
    });

    // A coupon is optional. When present it is locked and validated against the
    // authoritative subtotal here, and one use is spent in this same
    // transaction, so the order, the discount and the usage count commit or
    // roll back together.
    const couponCode = clean(input.coupon_code);
    const coupon = couponCode
      ? await couponService.redeem(tx, {
          code: couponCode,
          subtotalMinor: subtotal,
          userId: context.userId,
        })
      : null;
    const discountTotal = coupon?.discountMinor ?? 0;

    const total = subtotal + delivery.feeMinor - discountTotal;

    /* 8. Allocate a unique, human-readable order number. */
    const orderNumber = await orders.nextOrderNumber(tx);

    /* 9. The order, with an immutable shipping-address snapshot. */
    const paymentMethod = resolvePaymentMethod(input);
    const order = await orders.insertOrder(tx, {
      orderNumber,
      userId: context.userId ?? null,
      status: ORDER_STATUS.PENDING,
      subtotal,
      deliveryFee: delivery.feeMinor,
      discountTotal,
      couponId: coupon?.couponId ?? null,
      couponCode: coupon?.couponCode ?? null,
      total,
      currency: 'ETB',
      paymentStatus: PAYMENT_STATUS.PENDING,
      paymentMethod: paymentMethod.method,
      customerEmail: contact.email,
      customerPhone: contact.phone,
      shippingAddressSnapshot: address,
      customerNotes: clean(input.customer_notes),
    });

    /* 10. Line snapshots — name, SKU, options and price frozen at purchase. */
    const items = [];
    for (const line of lines) {
      const item = await orders.insertOrderItem(tx, {
        orderId: order.id,
        productId: line.productId,
        variantId: line.variantId,
        productName: line.productName,
        sku: line.sku,
        variantAttributes: line.variantAttributes,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        subtotal: line.subtotal,
      });
      items.push(item);
    }

    /* 11. The payment record. COD starts PENDING; the provider is free-form. */
    const payment = await orders.insertPayment(tx, {
      orderId: order.id,
      provider: paymentMethod.provider,
      method: paymentMethod.method,
      status: PAYMENT_STATUS.PENDING,
      amount: total,
      currency: 'ETB',
    });

    /* 12. Deduct stock and append the ledger, per tracked line. */
    for (const line of lines) {
      if (!line.tracked) continue;

      const deducted = await inventory.deduct(tx, line.variantId, line.quantity);
      if (!deducted) {
        // The locks made this unreachable in practice; it is the last line of
        // defence and rolls the entire order back if it ever fires.
        throw insufficientStock({ available: 0, requested: line.quantity });
      }

      await inventory.recordTransaction(tx, {
        variantId: line.variantId,
        type: 'SALE',
        quantity: -line.quantity,
        referenceType: 'ORDER',
        referenceId: order.id,
        note: `Sold on ${orderNumber}`,
        createdBy: context.userId ?? null,
      });
    }

    /* 13. Clear the cart. The cart row and any guest cookie survive. */
    await carts.clearItems(tx, cart.id);

    /* 14. runInTransaction commits here. */
    return { order: toOrderView({ order, items, payment }), cookie: null, merged: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Address snapshot                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds the JSONB address snapshot.
 *
 * The shape mirrors the `addresses` table exactly (migration 014), so a
 * fulfilment tool can read it the same way it reads a live address. The
 * customer's name and phone live on the snapshot as `full_name`/`phone`
 * because the order's own CHECK constraints require `full_name` and `city` to
 * be non-empty.
 *
 * @returns {object} the snapshot to store in `orders.shipping_address_snapshot`
 */
function buildAddressSnapshot(input, contact) {
  return {
    label: clean(input.label),
    full_name: contact.name,
    phone: contact.phone,
    city: clean(input.city) ?? '',
    area: clean(input.area) ?? '',
    street: clean(input.street) ?? '',
    landmark: clean(input.landmark),
    additional_notes: clean(input.additional_notes),
  };
}

export default { checkout };
