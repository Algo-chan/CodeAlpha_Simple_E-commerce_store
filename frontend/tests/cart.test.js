/**
 * Cart behaviour.
 *
 * Built on the real fixture catalogue rather than hand-written stubs, because
 * most of what matters here is the agreement between the view model and the
 * store: the ceiling comes from the variant, the price comes from the variant,
 * and the line snapshot comes from the variant's product stub.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCartStore,
  describeVariant,
  MAX_QUANTITY,
  FREE_SHIPPING_THRESHOLD_MINOR,
} from '../js/state/cart.js';
import { createCatalogueStore } from '../js/state/catalogue.js';
import { fixtureCatalogue } from '../js/mock/api.js';

/** A catalogue wired into a cart store, the way app.js builds it. */
function harness() {
  const catalogue = createCatalogueStore();
  catalogue.setCatalogue(fixtureCatalogue());

  const cart = createCartStore({
    resolveVariant: (variantId) => catalogue.getVariant(variantId),
  });

  return { catalogue, cart };
}

/** First purchasable variant of the first product matching a predicate. */
function pickVariant(catalogue, predicate) {
  const product = catalogue.selectListable().find((item) => predicate(item, item.variants ?? []));
  assert.ok(product, 'fixture catalogue should contain a matching product');

  const variant = (product.variants ?? []).find((item) => item.is_purchasable);
  assert.ok(variant, 'matching product should have a purchasable variant');
  return { product, variant };
}

/**
 * First purchasable variant whose available stock falls in a range.
 *
 * Selected at variant level rather than through `pickVariant`, which returns
 * whichever variant happens to come first in the product.
 */
function pickVariantWithStock(catalogue, min, max) {
  const variant = catalogue
    .selectListable()
    .flatMap((product) => product.variants ?? [])
    .find(
      (item) =>
        item.is_purchasable &&
        item.stock !== null &&
        item.stock.available >= min &&
        item.stock.available <= max
    );
  assert.ok(variant, `fixture catalogue should include a variant with ${min}-${max} in stock`);
  return variant;
}

test('adding a variant creates a line with a name, price and variant label', () => {
  const { catalogue, cart } = harness();
  const { product, variant } = pickVariant(catalogue, (item) => item.variants.length > 1);

  const result = cart.add(variant.id);
  assert.equal(result.ok, true);
  assert.equal(result.quantity, 1);

  const [line] = cart.getState().lines;
  assert.equal(line.variantId, variant.id);
  assert.equal(line.productId, product.id);
  assert.equal(line.name, product.name);
  assert.equal(line.unitPrice, variant.price_minor);
  assert.equal(line.quantity, 1);
  assert.ok(line.variantName, 'the shopper can see which variant they picked');
  assert.ok(line.image, 'a thumbnail is carried so the drawer needs no lookup');
});

test('adding the same variant again increases the quantity', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, (item) =>
    (item.variants ?? []).some((v) => (v.stock?.available ?? 0) > 2)
  );

  cart.add(variant.id);
  const second = cart.add(variant.id);

  assert.equal(second.ok, true);
  assert.equal(second.quantity, 2);
  assert.equal(cart.getState().lines.length, 1, 'still one line');
});

test('a quantity above available stock is refused, not silently trimmed', () => {
  const { catalogue, cart } = harness();
  const variant = pickVariantWithStock(catalogue, 1, 4);
  assert.ok(variant.stock.available < MAX_QUANTITY, 'the ceiling is what limits this');

  const result = cart.add(variant.id, 99);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'max-stock');
  assert.equal(cart.getState().lines.length, 0);
});

test('an unknown variant id is refused', () => {
  const { cart } = harness();

  const result = cart.add('00000000-0000-4000-8000-999999999999');

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
});

test('a sold-out variant cannot be added', () => {
  const { catalogue, cart } = harness();
  // Sold out is `available === 0` on a tracked row. It is not the same event as a
  // deactivated variant: the row is still active, there is just nothing on hand.
  const soldOut = catalogue
    .selectListable()
    .flatMap((product) => product.variants ?? [])
    .find((variant) => variant.stock !== null && variant.stock.available === 0);

  assert.ok(soldOut, 'the fixture set should include a sold-out variant');

  const result = cart.add(soldOut.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unavailable');
});

test('an inactive variant cannot be added even with stock on hand', () => {
  // No fixture is inactive, so it is built directly. This is the case the old
  // `stock.is_active` check missed: stock exists, yet the variant is not for sale.
  const { cart } = harness();
  const deactivated = {
    id: '50000000-0000-4000-8000-000000009997',
    product_id: '40000000-0000-4000-8000-000000009997',
    sku: 'DEACT-1',
    price_minor: 100000,
    attributes: {},
    is_active: false,
    product: { slug: 'deactivated', name: 'Deactivated', primary_image: null },
    stock: { quantity: 10, reserved_quantity: 0, available: 10, is_tracked: true },
  };

  assert.equal(cart.add(deactivated).reason, 'unavailable');
  assert.equal(cart.getState().lines.length, 0);
});

test('zero available stock on an active row is refused as a stock ceiling', () => {
  // No fixture has this shape, so it is built directly. `add` accepts a variant
  // object, which is how a caller holding a resolved variant avoids a lookup.
  const { cart } = harness();
  const zeroStock = {
    id: '50000000-0000-4000-8000-000000009999',
    product_id: '40000000-0000-4000-8000-000000009999',
    sku: 'ZERO-1',
    price_minor: 100000,
    attributes: { color: 'Black' },
    product: { slug: 'zero-stock', name: 'Zero stock product', primary_image: null },
    stock: { quantity: 0, available: 0, is_tracked: true },
  };

  const result = cart.add(zeroStock);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'max-stock');
  assert.equal(cart.getState().lines.length, 0);
});

test('reserved units are excluded from the purchasable ceiling', () => {
  // quantity 10 with 8 reserved leaves 2 sellable. Offering all 10 is how a mock
  // becomes an oversell once real stock sits behind it.
  const { cart } = harness();
  const partlyReserved = {
    id: '50000000-0000-4000-8000-000000009998',
    product_id: '40000000-0000-4000-8000-000000009998',
    sku: 'RES-1',
    price_minor: 100000,
    attributes: {},
    product: { slug: 'reserved', name: 'Partly reserved', primary_image: null },
    stock: { quantity: 10, reserved_quantity: 8, available: 2, is_tracked: true },
  };

  assert.equal(cart.add(partlyReserved, 3).reason, 'max-stock');
  assert.equal(cart.add(partlyReserved, 2).ok, true);
  assert.equal(cart.getState().lines[0].maxQuantity, 2);
});

test('step increases and decreases within the stock ceiling', () => {
  const { catalogue, cart } = harness();
  const variant = pickVariantWithStock(catalogue, 3, MAX_QUANTITY);

  cart.add(variant.id);
  cart.step(variant.id, 1);
  assert.equal(cart.selectLines()[0].quantity, 2);

  cart.step(variant.id, -1);
  assert.equal(cart.selectLines()[0].quantity, 1);
});

test('quantity never drops below one, so a line cannot be removed by accident', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);
  cart.step(variant.id, -5);

  assert.equal(cart.selectLines()[0].quantity, 1);
});

test('quantity is capped at the per-order maximum', () => {
  const { catalogue, cart } = harness();
  const digital = catalogue
    .selectListable()
    .find((product) => product.is_digital && product.default_variant);

  cart.add(digital.default_variant.id, MAX_QUANTITY + 5);

  assert.equal(cart.getState().lines[0].quantity, MAX_QUANTITY);
});

test('the subtotal is an integer sum of minor units', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, (item) => (item.variants ?? []).length > 1);

  cart.add(variant.id, 3);

  assert.equal(cart.selectSubtotal(), variant.price_minor * 3);
  assert.equal(Number.isInteger(cart.selectSubtotal()), true, 'no float ever reaches the total');
});

test('line totals and the subtotal agree', () => {
  const { catalogue, cart } = harness();
  for (const product of catalogue.selectListable().slice(0, 3)) {
    const variant = (product.variants ?? []).find((item) => item.is_purchasable);
    if (variant) cart.add(variant.id, 2);
  }

  const summed = cart.selectLines().reduce((total, line) => total + line.lineTotal, 0);
  assert.equal(summed, cart.selectSubtotal());
});

test('removing a line empties the basket and resets the count', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);
  cart.remove(variant.id);

  assert.equal(cart.selectIsEmpty(), true);
  assert.equal(cart.selectCount(), 0);
  assert.equal(cart.selectSubtotal(), 0);
});

test('a removed line can be restored for undo', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id, 2);
  const [line] = cart.getState().lines;
  cart.remove(variant.id);

  assert.equal(cart.restoreLine(line).ok, true);
  assert.equal(cart.getState().lines.length, 1);
  assert.equal(cart.selectCount(), 2, 'restored at the quantity it had');
});

test('restoreLine refuses a line that is already in the basket', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);
  const [line] = cart.getState().lines;

  assert.equal(cart.restoreLine(line).reason, 'already-in-cart');
  assert.equal(cart.getState().lines.length, 1);
});

test('reconcile re-reads price from the catalogue rather than trusting the snapshot', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);

  // Simulates a price change while the basket sat in storage.
  const stale = cart.getState().lines.map((line) => ({ ...line, unitPrice: 1 }));
  cart.setState({ lines: stale });

  cart.reconcile();

  assert.equal(cart.getState().lines[0].unitPrice, variant.price_minor);
});

test('reconcile flags a line whose product has gone missing', () => {
  const { cart } = harness();
  cart.setState({
    lines: [
      {
        variantId: '00000000-0000-4000-8000-999999999999',
        productId: '00000000-0000-4000-8000-888888888888',
        slug: 'gone',
        name: 'Discontinued product',
        variantName: null,
        image: null,
        unitPrice: 1000,
        quantity: 1,
        maxQuantity: 1,
      },
    ],
  });

  cart.reconcile();

  const [line] = cart.getState().lines;
  assert.equal(line.unavailableReason, 'missing', 'flagged rather than deleted');
  assert.equal(cart.getState().lines.length, 1, 'the shopper can see what happened');
});

test('an unbuyable line is excluded from the count, the subtotal and free delivery', () => {
  const { cart } = harness();
  cart.setState({
    lines: [
      {
        variantId: 'a',
        productId: 'a',
        slug: 'a',
        name: 'Gone',
        variantName: null,
        image: null,
        unitPrice: 900000,
        quantity: 2,
        maxQuantity: 2,
        unavailableReason: 'missing',
      },
    ],
  });

  assert.equal(cart.selectCount(), 0);
  assert.equal(cart.selectSubtotal(), 0);
  assert.equal(cart.selectIsUnfulfillable(), true);
  assert.equal(
    cart.selectShippingProgress().qualifies,
    false,
    'an unbuyable line cannot win free delivery'
  );
});

test('free-delivery progress never divides by zero and never exceeds 100', () => {
  const { cart } = harness();
  const empty = cart.selectShippingProgress();
  assert.equal(empty.percent, 0, 'an empty basket is 0%, not NaN');
  assert.equal(empty.qualifies, false);
  assert.equal(empty.remaining, FREE_SHIPPING_THRESHOLD_MINOR);

  cart.setState({
    lines: [
      {
        variantId: 'big',
        productId: 'big',
        slug: 'big',
        name: 'Expensive',
        variantName: null,
        image: null,
        unitPrice: FREE_SHIPPING_THRESHOLD_MINOR * 4,
        quantity: 1,
        maxQuantity: MAX_QUANTITY,
      },
    ],
  });

  const over = cart.selectShippingProgress();
  assert.equal(over.percent, 100);
  assert.equal(over.qualifies, true);
  assert.equal(over.remaining, 0);
});

test('a digital product with no inventory row is still purchasable', () => {
  const { catalogue, cart } = harness();
  const digital = catalogue
    .selectListable()
    .find((product) => product.is_digital && product.default_variant?.synthetic);

  assert.ok(digital, 'the fixture set should include a digital product');

  const result = cart.add(digital.default_variant.id);
  assert.equal(result.ok, true);
  assert.equal(
    cart.getState().lines[0].maxQuantity,
    MAX_QUANTITY,
    'untracked, so bounded by the order cap'
  );
});

test('a synthetic digital variant survives reconcile', () => {
  const { catalogue, cart } = harness();
  const digital = catalogue
    .selectListable()
    .find((product) => product.is_digital && product.default_variant?.synthetic);

  cart.add(digital.default_variant.id);
  cart.reconcile();

  assert.equal(cart.getState().lines[0].unavailableReason, undefined);
});

test('the cart badge count sums quantities, not lines', () => {
  const { catalogue, cart } = harness();
  const variants = catalogue
    .selectListable()
    .flatMap((product) => product.variants ?? [])
    .filter((variant) => variant.is_purchasable && (variant.stock?.available ?? 0) > 2)
    .slice(0, 2);

  cart.add(variants[0].id, 2);
  cart.add(variants[1].id, 1);

  assert.equal(cart.getState().lines.length, 2);
  assert.equal(cart.selectCount(), 3);
});

test('the last added variant is remembered so a card can show "Added"', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);
  assert.equal(cart.getState().lastAddedVariantId, variant.id);

  cart.remove(variant.id);
  assert.equal(cart.getState().lastAddedVariantId, null);
});

test('drawer visibility is independent of basket contents', () => {
  const { cart } = harness();

  cart.open();
  assert.equal(cart.getState().isOpen, true);

  cart.toggle();
  assert.equal(cart.getState().isOpen, false);
});

test('clear empties the basket', () => {
  const { catalogue, cart } = harness();
  const { variant } = pickVariant(catalogue, () => true);

  cart.add(variant.id);
  cart.clear();

  assert.equal(cart.selectIsEmpty(), true);
});

test('describeVariant joins attributes into a readable label', () => {
  assert.equal(describeVariant({ color: 'Black', size: '40' }), 'Black / 40');
  assert.equal(describeVariant({}), null);
  assert.equal(describeVariant(null), null);
  assert.equal(describeVariant({ license: 'Single' }), 'Single');
});
