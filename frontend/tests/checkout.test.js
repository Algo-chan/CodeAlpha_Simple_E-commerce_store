/**
 * Checkout helpers.
 *
 * These are the decisions the checkout page makes before it speaks to the
 * server: the body it sends, the delivery figure it previews, and the words it
 * puts on a failure. All pure, all testable without a browser or a database.
 *
 * The important pins:
 *   - the request body is snake_case and omits blanks, because it matches the
 *     backend's `checkoutSchema` and the address book the shopper already used;
 *   - the delivery preview reproduces the backend's flat rule exactly, so the
 *     number on the summary and the number on the receipt agree;
 *   - a known error code gets specific copy, and an unknown one degrades to the
 *     message rather than to "undefined".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCheckoutBody,
  buildCouponPreviewBody,
  normaliseCouponCode,
  previewDeliveryFee,
  checkoutTotal,
  describeCheckoutError,
  describeCouponError,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  DELIVERY_DEFAULT_FEE_MINOR,
  DELIVERY_FREE_THRESHOLD_MINOR,
  PAYMENT_METHOD_COD,
} from '../js/utils/checkout.js';

test('buildCheckoutBody maps camelCase fields to the snake_case request body', () => {
  const body = buildCheckoutBody({
    fullName: 'Hanna Bekele',
    email: 'Hanna@Example.com',
    phone: '+251911000000',
    label: 'Home',
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road, Building 4',
    landmark: 'Next to the bank',
    additionalNotes: 'Ring the bell twice',
    customerNotes: 'Leave with the guard',
  });

  assert.deepEqual(body, {
    full_name: 'Hanna Bekele',
    email: 'Hanna@Example.com',
    phone: '+251911000000',
    label: 'Home',
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road, Building 4',
    landmark: 'Next to the bank',
    additional_notes: 'Ring the bell twice',
    customer_notes: 'Leave with the guard',
    payment_method: 'COD',
  });
});

test('buildCheckoutBody always sends the required destination fields, even empty', () => {
  const body = buildCheckoutBody({ city: '  ', area: '', street: null });

  assert.equal(body.city, '');
  assert.equal(body.area, '');
  assert.equal(body.street, '');
  assert.equal(body.payment_method, PAYMENT_METHOD_COD);
});

test('buildCheckoutBody omits blank optional fields rather than sending empty strings', () => {
  const body = buildCheckoutBody({
    fullName: 'Hanna',
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road',
    landmark: '   ',
    additionalNotes: '',
    customerNotes: '  ',
  });

  assert.equal('landmark' in body, false);
  assert.equal('additional_notes' in body, false);
  assert.equal('customer_notes' in body, false);
  assert.equal('email' in body, false);
  assert.equal('phone' in body, false);
});

test('buildCheckoutBody trims optional values that are present', () => {
  const body = buildCheckoutBody({
    city: 'A',
    area: 'B',
    street: 'C',
    landmark: '  By the mosque  ',
  });
  assert.equal(body.landmark, 'By the mosque');
});

test('previewDeliveryFee charges the flat fee below the threshold', () => {
  const result = previewDeliveryFee(100_000);

  assert.equal(result.isFree, false);
  assert.equal(result.feeMinor, DELIVERY_DEFAULT_FEE_MINOR);
  assert.equal(result.remainingForFreeMinor, DELIVERY_FREE_THRESHOLD_MINOR - 100_000);
});

test('previewDeliveryFee waives the fee at or above the threshold', () => {
  const atThreshold = previewDeliveryFee(DELIVERY_FREE_THRESHOLD_MINOR);
  const above = previewDeliveryFee(DELIVERY_FREE_THRESHOLD_MINOR + 1);

  assert.equal(atThreshold.isFree, true);
  assert.equal(atThreshold.feeMinor, 0);
  assert.equal(atThreshold.remainingForFreeMinor, 0);
  assert.equal(above.feeMinor, 0);
});

test('previewDeliveryFee treats a missing subtotal as zero', () => {
  const result = previewDeliveryFee(undefined);
  assert.equal(result.feeMinor, DELIVERY_DEFAULT_FEE_MINOR);
  assert.equal(result.remainingForFreeMinor, DELIVERY_FREE_THRESHOLD_MINOR);
});

test('previewDeliveryFee accepts an override, so a zone tariff changes nothing here', () => {
  const result = previewDeliveryFee(50_000, { freeThresholdMinor: 0, defaultFeeMinor: 0 });
  assert.equal(result.isFree, true);
  assert.equal(result.feeMinor, 0);
});

test('checkoutTotal adds delivery and subtracts a discount', () => {
  assert.equal(checkoutTotal(100_000, 50_000), 150_000);
  assert.equal(checkoutTotal(100_000, 50_000, 20_000), 130_000);
  assert.equal(checkoutTotal(undefined, undefined), 0);
});

test('describeCheckoutError gives specific copy per known code', () => {
  assert.match(describeCheckoutError({ code: 'CART_EMPTY' }), /nothing in your cart/i);
  assert.match(describeCheckoutError({ code: 'PRODUCT_UNAVAILABLE' }), /no longer available/i);
  assert.match(
    describeCheckoutError({ code: 'INSUFFICIENT_STOCK', message: 'Only 1 unit remains.' }),
    /Only 1 unit remains\./
  );
  assert.match(describeCheckoutError({ code: 'VALIDATION_ERROR' }), /highlighted fields/i);
  assert.match(describeCheckoutError({ code: 'NETWORK_ERROR' }), /could not reach/i);
});

test('describeCheckoutError falls back to the message, then to a generic line', () => {
  assert.equal(describeCheckoutError({ code: 'SOMETHING', message: 'Boom.' }), 'Boom.');
  assert.match(describeCheckoutError({ code: 'SOMETHING' }), /went wrong/i);
  assert.match(describeCheckoutError(null), /went wrong/i);
});

test('order status helpers label and tone every known state', () => {
  assert.equal(orderStatusLabel('PENDING'), 'Awaiting confirmation');
  assert.equal(orderStatusTone('PENDING'), 'warning');
  assert.equal(orderStatusTone('DELIVERED'), 'success');
  assert.equal(orderStatusTone('CANCELLED'), 'error');
  assert.equal(orderStatusTone('SHIPPED'), 'info');
  assert.equal(orderStatusLabel('WAT'), 'Processing');
});

test('payment status helpers describe the COD lifecycle', () => {
  assert.equal(paymentStatusLabel('PENDING'), 'Payment due on delivery');
  assert.equal(paymentStatusLabel('PAID'), 'Paid');
  assert.equal(paymentStatusLabel('REFUNDED'), 'Refunded');
  assert.equal(paymentStatusLabel('WAT'), 'Payment pending');
});

test('normaliseCouponCode upper-cases and strips spaces, matching storage', () => {
  assert.equal(normaliseCouponCode(' save10 '), 'SAVE10');
  assert.equal(normaliseCouponCode('saver ten'), 'SAVERTEN');
  assert.equal(normaliseCouponCode(''), '');
  assert.equal(normaliseCouponCode(null), '');
});

test('buildCouponPreviewBody sends a normalised code', () => {
  assert.deepEqual(buildCouponPreviewBody(' save10 '), { code: 'SAVE10' });
});

test('buildCheckoutBody carries a normalised coupon_code when one is applied', () => {
  const body = buildCheckoutBody({
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road',
    couponCode: ' saver ten ',
  });
  assert.equal(body.coupon_code, 'SAVERTEN');
});

test('buildCheckoutBody omits coupon_code when none is applied', () => {
  const blank = buildCheckoutBody({ city: 'A', area: 'B', street: 'C', couponCode: '   ' });
  assert.equal('coupon_code' in blank, false);

  const missing = buildCheckoutBody({ city: 'A', area: 'B', street: 'C' });
  assert.equal('coupon_code' in missing, false);
});

test('describeCouponError names the coupon rules and degrades safely', () => {
  assert.match(
    describeCouponError({ code: 'COUPON_INVALID', message: 'Add 20.00 ETB more.' }),
    /Add 20\.00 ETB more\./
  );
  assert.match(describeCouponError({ code: 'COUPON_INVALID' }), /isn't valid/i);
  assert.match(describeCouponError({ code: 'VALIDATION_ERROR' }), /valid coupon code/i);
  assert.match(describeCouponError({ code: 'NETWORK_ERROR' }), /could not reach/i);
  assert.match(describeCouponError(null), /could not check/i);
});

test('describeCheckoutError surfaces a coupon problem from the server', () => {
  assert.match(
    describeCheckoutError({ code: 'COUPON_INVALID', message: 'That coupon has expired.' }),
    /That coupon has expired\./
  );
});
