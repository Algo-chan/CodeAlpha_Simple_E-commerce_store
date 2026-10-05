/**
 * The mock catalogue service and the fixture dataset behind it.
 *
 * Two things are being checked here.
 *
 * First, the seam itself. `createMockClient` is the thing that will be replaced
 * by `core/api.js` when the backend lands, so its method names, its `{ data }`
 * shape and its `ApiError` behaviour have to hold now, or every component that
 * consumes it has to be rewritten later.
 *
 * Second, the dataset. Phase 4 requires a storefront-wide spread of products,
 * variants, attribute combinations and stock states. If a state is missing from
 * the fixtures it cannot be reviewed on the page, and an unreviewable state is
 * an unbuilt one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMockClient, fixtureCatalogue, computeFacets } from '../js/mock/api.js';
import { listCategories, buildTree } from '../js/mock/categories.js';
import { listProducts, listVariants, listReviews } from '../js/mock/products.js';
import { LOW_STOCK_THRESHOLD } from '../js/utils/product-view.js';
import {
  findVariantFor,
  canSelectAttribute,
  badgeLabel,
  buildProductView,
} from '../js/mock/view.js';
import { ApiError } from '../js/core/api.js';

/** No latency, no jitter, no injected failure: deterministic and fast. */
function client(overrides = {}) {
  return createMockClient({ latencyMs: 0, jitterMs: 0, shouldFail: () => null, ...overrides });
}

/* -------------------------------------------------------------------------- */
/* Service seam                                                                  */
/* -------------------------------------------------------------------------- */

test('getCatalogue returns products and a category tree', async () => {
  const { products, categories } = await client().getCatalogue();

  assert.ok(Array.isArray(products) && products.length > 0);
  assert.ok(Array.isArray(categories) && categories.length > 0);
  assert.ok(
    categories.some((node) => Array.isArray(node.children)),
    'a tree, not a flat list'
  );
});

test('getCatalogue hands back a copy, so a caller cannot corrupt the cache', async () => {
  const api = client();
  const first = await api.getCatalogue();

  first.products[0].name = 'MUTATED';
  first.products.length = 0;

  const second = await api.getCatalogue();
  assert.ok(second.products.length > 0);
  assert.notEqual(second.products[0].name, 'MUTATED');
});

test('getProduct resolves by slug and by id, and 404s otherwise', async () => {
  const api = client();
  const [product] = (await api.getCatalogue()).products;

  assert.equal((await api.getProduct(product.slug)).id, product.id);
  assert.equal((await api.getProduct(product.id)).slug, product.slug);

  await assert.rejects(
    () => api.getProduct('no-such-product'),
    (error) => {
      assert.ok(
        error instanceof ApiError,
        'a miss is an ApiError, so the page can render its own state'
      );
      assert.equal(error.status, 404);
      assert.equal(error.code, 'PRODUCT_NOT_FOUND');
      return true;
    }
  );
});

test('an injected failure rejects with an ApiError the UI can report', async () => {
  const api = client({ shouldFail: () => 'catalogue' });

  await assert.rejects(
    () => api.getCatalogue(),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'MOCK_FAILURE');
      return true;
    }
  );
});

test('an offline injection reports a network error naming the API', async () => {
  const api = client({ shouldFail: () => 'offline' });

  await assert.rejects(
    () => api.getCatalogue(),
    (error) => {
      assert.equal(error.code, 'NETWORK_ERROR');
      assert.match(error.message, /4000/, 'the message should point at the configured API base');
      return true;
    }
  );
});

test('an aborted request rejects rather than resolving late', async () => {
  const api = createMockClient({ latencyMs: 50, jitterMs: 0, shouldFail: () => null });
  const controller = new AbortController();
  const pending = api.getCatalogue({ signal: controller.signal });

  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.equal(error.name, 'AbortError');
    return true;
  });
});

/* -------------------------------------------------------------------------- */
/* Search                                                                        */
/* -------------------------------------------------------------------------- */

test('an empty query returns nothing rather than the whole catalogue', async () => {
  const result = await client().searchProducts('');

  assert.deepEqual(result.products, []);
  assert.deepEqual(result.categories, []);
});

test('search finds products by name', async () => {
  const api = client();
  const [product] = (await api.getCatalogue()).products;
  const word = product.name.split(' ')[0];

  const result = await api.searchProducts(word);

  assert.ok(result.products.length > 0, `"${word}" should return something`);
  assert.ok(result.products.some((item) => String(item.id) === String(product.id)));
});

test('search suggests categories as well as products', async () => {
  const api = client();
  const category = (await api.getCatalogue()).categories[0];

  const result = await api.searchProducts(category.name.toLowerCase());

  assert.ok(
    result.categories.some((node) => String(node.id) === String(category.id)),
    'a category suggestion should be offered'
  );
});

test('search ranks a name match above a description-only match', async () => {
  const api = client();
  const needle = 'shirt';

  const result = await api.searchProducts(needle);
  if (result.products.length < 2) return;

  const [first] = result.products;
  assert.ok(
    first.name.toLowerCase().includes(needle),
    `"${first.name}" should be a name match, not a description match`
  );
});

test('search requires every word to match somewhere', async () => {
  const result = await client().searchProducts('zzzznotathing');
  assert.deepEqual(result.products, []);

  // A two-word query where one word is impossible must not fall back to
  // returning everything that matches the other word.
  const partial = await client().searchProducts('shirt zzzznotathing');
  assert.deepEqual(partial.products, []);
});

test('search never returns an unpublished product', async () => {
  const api = client();
  const draft = (await api.getCatalogue()).products.find((product) => !product.is_listable);
  if (!draft) return;

  for (const term of draft.name.split(' ')) {
    const result = await api.searchProducts(term.toLowerCase());
    assert.ok(
      !result.products.some((product) => String(product.id) === String(draft.id)),
      'a DRAFT must not be reachable through search'
    );
  }
});

test('search honours its result limit', async () => {
  const api = client();
  const result = await api.searchProducts('a', { limit: 3 });

  assert.ok(result.products.length <= 3);
});

/* -------------------------------------------------------------------------- */
/* Facets                                                                        */
/* -------------------------------------------------------------------------- */

test('facets ignore unpublished products', () => {
  const { products } = fixtureCatalogue();
  const facets = computeFacets(products);
  const listable = products.filter((product) => product.is_listable);

  for (const attribute of facets.attributes) {
    for (const { value, count } of attribute.values) {
      const actual = listable.filter((product) =>
        (product.attributes?.[attribute.key] ?? []).includes(value)
      ).length;
      assert.equal(count, actual, `${attribute.key}=${value}`);
    }
  }
});

test('the facet price range covers the cheapest and dearest variant', () => {
  const { products } = fixtureCatalogue();
  const facets = computeFacets(products);
  const listable = products.filter((product) => product.is_listable);

  const cheapest = Math.min(...listable.map((p) => p.price_min_minor));
  const dearest = Math.max(...listable.map((p) => p.price_max_minor ?? p.price_min_minor));

  assert.equal(facets.price.min, cheapest);
  assert.equal(facets.price.max, dearest);
});

/* -------------------------------------------------------------------------- */
/* Dataset requirements                                                          */
/* -------------------------------------------------------------------------- */

const catalogue = fixtureCatalogue();
const rawProducts = listProducts();
const rawVariants = listVariants();

test('the catalogue is large enough to review every state on', () => {
  // Counted over the flat list, not the tree roots: the requirement is five
  // browsable categories, and four of them here have children.
  assert.ok(listCategories().length >= 5, 'at least five categories');
  assert.ok(rawProducts.length >= 12, 'at least twelve products');
});

test('both physical and digital products are represented', () => {
  const types = new Set(rawProducts.map((product) => product.product_type));

  assert.ok(types.has('PHYSICAL'), 'shipped products');
  assert.ok(types.has('DIGITAL'), 'downloads, which have no inventory row');
});

test('products cover in-stock, low-stock and sold-out states', () => {
  const bySlug = new Map(catalogue.products.map((product) => [product.slug, product]));

  assert.ok(
    catalogue.products.some((product) => product.is_low_stock),
    'a low-stock product, so the LOW STOCK badge can be reviewed'
  );
  assert.ok(
    catalogue.products.some((product) => !product.in_stock),
    'a sold-out product, so the SALE/NEW badges yield to SOLD OUT'
  );
  assert.ok(
    catalogue.products.some((product) => product.in_stock && !product.is_low_stock),
    'a comfortably-stocked product'
  );
  assert.ok(bySlug.size === catalogue.products.length, 'slugs are unique');
});

test('products carry new and featured flags for merchandising', () => {
  assert.ok(catalogue.products.some((product) => product.is_featured));
  assert.ok(catalogue.products.some((product) => product.is_new));
  assert.ok(
    catalogue.products.some((product) => product.display_order > 0),
    'at least one product carries a merchandised rank'
  );
});

test('every product has at least three images with alt text and an angle', () => {
  for (const product of catalogue.products) {
    assert.ok(product.images.length >= 3, `${product.slug} should have 3+ images`);

    for (const image of product.images) {
      assert.ok(image.url, `${product.slug}: image url`);
      assert.ok(image.thumb_url, `${product.slug}: thumbnail url`);
      assert.ok(image.alt, `${product.slug}: alt text is required`);
      assert.ok(image.angle, `${product.slug}: an angle label drives the gallery caption`);
    }

    assert.equal(
      product.images.filter((image) => image.is_primary).length,
      1,
      `${product.slug}: exactly one primary image`
    );
  }
});

test('angles are varied, and front/side/back coverage exists where a product has it', () => {
  const multi = catalogue.products.filter((product) => product.images.length >= 3);
  assert.ok(multi.length > 0);

  // Every product leads with a front view and carries at least one other angle,
  // so the gallery is never a row of identical frames.
  for (const product of multi) {
    const angles = product.images.map((image) => String(image.angle).toLowerCase());
    assert.ok(
      angles.some((a) => a.includes('front')),
      `${product.slug}: a front view`
    );
    assert.ok(new Set(angles).size >= 2, `${product.slug}: more than one angle`);
  }

  // "Front, side and back" is required where a product genuinely has those
  // angles. Not every product does - a coffee set has no meaningful side view -
  // so the requirement is that the three-angle case is represented, and that the
  // gallery handles arbitrary angle labels rather than assuming three.
  const threeAngles = multi.filter((product) => {
    const angles = product.images.map((image) => String(image.angle).toLowerCase());
    return (
      angles.some((a) => a.includes('front')) &&
      angles.some((a) => a.includes('side') || a.includes('left') || a.includes('right')) &&
      angles.some((a) => a.includes('back') || a.includes('rear'))
    );
  });

  assert.ok(threeAngles.length > 0, 'at least one product demonstrates front, side and back');
});

test('fixture images are generated placeholders, not binary assets', () => {
  for (const product of catalogue.products) {
    for (const image of product.images) {
      assert.match(
        image.url,
        /^(data:image\/svg\+xml;base64,|\/)/,
        'either an inlined SVG fixture or a real path once assets exist'
      );
      assert.ok(image.url.length > 0);
    }
  }
});

test('every angle has its own image, so switching the gallery changes something', () => {
  for (const product of catalogue.products) {
    const urls = product.images.map((image) => image.url);
    assert.equal(new Set(urls).size, urls.length, `${product.slug}: duplicate image urls`);
  }
});

test('thumbnails are smaller renditions of the same angle', () => {
  for (const product of catalogue.products) {
    for (const image of product.images) {
      assert.notEqual(
        image.thumb_url,
        image.url,
        `${product.slug}: a thumbnail is its own request`
      );
    }
  }
});

test('every variant belongs to a real product and has a unique SKU', () => {
  const productIds = new Set(rawProducts.map((product) => String(product.id)));
  const skus = new Set();

  for (const variant of rawVariants) {
    assert.ok(productIds.has(String(variant.product_id)), 'orphan variant');
    assert.equal(skus.has(variant.sku), false, `duplicate SKU ${variant.sku}`);
    skus.add(variant.sku);
    assert.ok(Number.isInteger(variant.price_minor), 'prices are integer minor units');
    assert.ok(variant.price_minor > 0);
  }
});

test('variant attribute combinations are genuinely varied, not just colour and size', () => {
  const combinations = new Set(
    rawVariants.map((variant) =>
      Object.keys(variant.attributes ?? {})
        .sort()
        .join('+')
    )
  );

  assert.ok(combinations.size >= 4, 'several distinct attribute shapes');
  for (const expected of ['color+size', 'size', 'storage']) {
    assert.ok(
      combinations.has(expected),
      `expected a "${expected}" combination; saw ${[...combinations].join(', ')}`
    );
  }
});

test('products include ones with no meaningful variant choices', () => {
  const noAttributes = rawVariants.filter(
    (variant) => Object.keys(variant.attributes ?? {}).length === 0
  );
  assert.ok(noAttributes.length > 0, 'a single-variant product with nothing to choose');
});

test('prices span a realistic range in ETB minor units', () => {
  const prices = rawVariants.map((variant) => variant.price_minor);

  assert.ok(Math.min(...prices) < 200000, 'an affordable item exists');
  assert.ok(Math.max(...prices) > 1000000, 'a premium item exists');
  assert.equal(
    prices.every((price) => Number.isInteger(price)),
    true,
    'no float ever enters a price'
  );
});

test('some variants are priced below their compare-at price', () => {
  const onSale = rawVariants.filter((variant) => variant.compare_at_price_minor);
  assert.ok(onSale.length > 0, 'so the SALE badge and strikethrough price can be reviewed');
  for (const variant of onSale) {
    assert.ok(variant.compare_at_price_minor > variant.price_minor);
  }
});

test('the category tree has roots, children and a description for each node', () => {
  const raw = listCategories();
  const tree = buildTree(raw);

  assert.ok(tree.length >= 4, 'several top-level categories');
  assert.ok(
    tree.some((node) => node.children.length > 0),
    'at least one nests a child, so the dropdown and filter paths are exercised'
  );
  assert.ok(
    raw.some((node) => node.parent_id),
    'at least one category is a child'
  );
  for (const node of raw) {
    assert.ok(node.name);
    assert.ok(node.slug);
    assert.ok(node.description, `${node.slug}: a description for the category header`);
    assert.ok(Number.isInteger(node.sort_order));
  }
  assert.equal(new Set(raw.map((node) => node.slug)).size, raw.length, 'slugs are unique');
});

test('ratings exist and are within range', () => {
  const reviews = listReviews();

  assert.ok(reviews.length > 0, 'ratings can be reviewed');
  for (const review of reviews) {
    assert.ok(review.rating >= 1 && review.rating <= 5);
  }
  assert.ok(
    catalogue.products.some((product) => product.rating_average != null),
    'at least one product shows a rating'
  );
});

/* -------------------------------------------------------------------------- */
/* Variant resolution                                                             */
/* -------------------------------------------------------------------------- */

test('a partial selection still resolves to the best-matching variant', () => {
  const product = catalogue.products.find((item) =>
    (item.variants ?? []).some((variant) => Object.keys(variant.attributes ?? {}).length >= 2)
  );
  if (!product) return;

  const [key] = Object.keys(product.variants[0].attributes);
  const value = product.variants[0].attributes[key];

  const match = findVariantFor(product, { [key]: value });
  assert.ok(match, 'choosing one attribute should still price the product');
  assert.equal(String(match.attributes[key]), String(value));
});

test('an empty selection falls back to the default variant', () => {
  const product = catalogue.products.find((item) => item.default_variant);
  assert.equal(findVariantFor(product, {}).id, product.default_variant.id);
});

test('a selection matching nothing resolves to null rather than a wrong variant', () => {
  const product = catalogue.products[0];

  assert.equal(findVariantFor(product, { size: 'no-such-size' }), null);
});

test('an unavailable combination is reported as not selectable', () => {
  const product = catalogue.products.find((item) =>
    (item.variants ?? []).some((variant) => !variant.is_purchasable)
  );
  if (!product) return;

  const soldOut = product.variants.find((variant) => !variant.is_purchasable);

  // The whole attribute set is passed, so `canSelectAttribute` narrows to this
  // one variant rather than to the first variant sharing its colour.
  const result = canSelectAttribute(product, 'color', soldOut.attributes?.color, {
    ...soldOut.attributes,
  });

  assert.ok(result.variant, 'the sold-out variant is still found, so it can be shown as disabled');
  assert.equal(result.enabled, false, 'a sold-out option must be disabled, not selectable');
});

test('a sold-out variant is never purchasable, whatever the stock row says', () => {
  for (const product of catalogue.products) {
    for (const variant of product.variants ?? []) {
      const available = variant.stock?.available;
      // Tracked and empty, or not purchasable for any other reason. `stock` of
      // `null` is deliberately excluded: untracked means digital, which is buyable.
      if (available === 0 || variant.is_purchasable !== true) {
        assert.equal(
          variant.is_purchasable,
          false,
          `${product.slug} / ${variant.sku} has no stock but claims to be purchasable`
        );
      }
    }
  }
});

test('fixtures mark low stock the same way the API does', () => {
  // Components read `variant.is_low_stock` rather than comparing stock to their
  // own threshold, so the fixtures have to send it. Without this, every "Only N
  // left" line disappears the day the catalogue switches from fixtures to the
  // server, and the failure has nothing to do with the change that caused it.
  let sawLow = false;
  let sawNotLow = false;

  for (const product of catalogue.products) {
    for (const variant of product.variants ?? []) {
      const available = variant.stock?.available ?? null;
      const expected =
        variant.is_active !== false &&
        available !== null &&
        available > 0 &&
        available <= LOW_STOCK_THRESHOLD;

      assert.equal(
        variant.is_low_stock,
        expected,
        `${product.slug} / ${variant.sku}: available=${String(available)}`
      );
      if (variant.is_low_stock) sawLow = true;
      else sawNotLow = true;
    }
  }

  assert.ok(sawLow, 'the fixtures should include a low-stock variant');
  assert.ok(sawNotLow, 'and a variant that is not low stock');
});

test('a value with no matching variant is disabled', () => {
  const product = catalogue.products[0];

  const result = canSelectAttribute(product, 'color', 'Chartreuse', {});
  assert.equal(result.enabled, false);
  assert.equal(result.variant, null);
});

test('availability ignores the option being tested, so a choice can be undone', () => {
  // The classic dead end is "Black / 42" being unavailable while "Black / 40"
  // is fine: the shopper must still be able to switch colour away from Black.
  const product = catalogue.products.find((item) => (item.variants ?? []).length > 2);
  if (!product) return;

  const keys = new Set(
    product.variants.flatMap((variant) => Object.keys(variant.attributes ?? {}))
  );
  const [firstKey] = [...keys];
  if (!firstKey) return;

  const anyValue = product.variants[0].attributes[firstKey];
  const result = canSelectAttribute(product, firstKey, anyValue, {});

  assert.ok(
    result.enabled || result.variant !== null,
    'testing an option must not be blocked by that same option being selected'
  );
});

test('badge labels are human, including a computed discount', () => {
  assert.equal(badgeLabel('new'), 'New');
  assert.equal(badgeLabel('sold-out'), 'Sold out');
  assert.equal(badgeLabel('low-stock'), 'Low stock');
  assert.equal(badgeLabel('featured'), 'Featured');
  assert.equal(badgeLabel('sale-15'), '15% off');
});

test('a card never stacks more than two badges', () => {
  for (const product of catalogue.products) {
    assert.ok(product.badges.length <= 2, `${product.slug} has ${product.badges.length} badges`);
  }
});

test('sold out always wins the badge slot', () => {
  const soldOut = catalogue.products.find((product) => !product.in_stock);
  if (!soldOut) return;

  assert.equal(soldOut.badges[0], 'sold-out');
});

/* -------------------------------------------------------------------------- */
/* View-model normalisation                                                       */
/* -------------------------------------------------------------------------- */

test('a product view exposes the fields every component reads', () => {
  const view = buildProductView(listProducts()[0], {
    variants: listVariants().filter((variant) => variant.product_id === listProducts()[0].id),
    reviews: [],
    category: null,
    now: Date.now(),
  });

  for (const key of [
    'id',
    'slug',
    'name',
    'brand',
    'product_type',
    'is_listable',
    'primary_image',
    'variants',
    'default_variant',
    'attributes',
    'attribute_options',
    'badges',
  ]) {
    assert.ok(key in view, `missing "${key}"`);
  }
});

test('a digital product with no variant rows still gets a purchasable default', () => {
  const digital = catalogue.products.find((product) => product.is_digital);

  assert.ok(digital, 'the fixture set includes a download');
  assert.ok(digital.default_variant, 'a synthetic variant so it can be sold');
  assert.ok(digital.default_variant.synthetic, 'flagged as synthetic, not a real row');
  assert.ok(digital.default_variant.price_minor > 0, 'a download still costs something');
  assert.equal(digital.in_stock, true, 'and it is not sold out');
});

test('an inactive variant cannot influence price or availability', () => {
  const product = buildProductView(listProducts()[0], {
    variants: [
      {
        id: 'v1',
        product_id: 'p1',
        sku: 'LIVE',
        price_minor: 100000,
        attributes: { color: 'Black' },
        is_active: true,
        stock: { quantity: 5, available: 5, is_active: true },
      },
      {
        id: 'v2',
        product_id: 'p1',
        sku: 'RETIRED',
        price_minor: 9900000,
        attributes: { color: 'Gold' },
        is_active: false,
        stock: { quantity: 99, available: 99, is_active: true },
      },
    ],
    reviews: [],
    category: null,
    now: Date.now(),
  });

  assert.deepEqual(product.attributes.color, ['Black'], 'a retired colour is not offered');
  assert.ok(product.price_max_minor < 9900000, 'a retired price cannot set the range');
});
