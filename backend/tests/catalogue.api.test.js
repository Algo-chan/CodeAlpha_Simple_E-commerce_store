/**
 * Catalogue HTTP tests.
 *
 * These exercise the WHOLE stack against a real PostgreSQL engine (PGlite), not a
 * stub: Express routing, validation, the service, the SQL, and the error envelope.
 * A service-level test would pass while `?page=0` returned 500; only a request can
 * catch that.
 *
 * WHAT IS ASSERTED, AND WHY IT MATTERS
 *
 *   - Envelope shape on success AND failure, because the frontend client branches
 *     on `success` and would break silently otherwise.
 *   - Every documented 422, because a filter that is silently clamped makes the
 *     URL lie about what it did.
 *   - That injection attempts return an ordinary empty result rather than
 *     altering data. The seed data surviving is the actual assertion.
 *   - That a sold-out product is still listable. It is the single easiest
 *     property in this domain to get backwards, and getting it backwards hides
 *     products from the shop.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createSeededDb } from './helpers/database.js';
import { createApp } from '../src/app.js';

let db;
let app;

test.before(async () => {
  db = await createSeededDb();
  app = createApp({ db: { query: (text, params = []) => db.query(text, params) } });
});

test.after(async () => {
  await db?.close();
});

/** Shorthand: GET a path and return the supertest response. */
const get = (path) => request(app).get(path);

/* -------------------------------------------------------------------------- */
/* Envelope                                                                      */
/* -------------------------------------------------------------------------- */

test('GET /api/v1/products returns a success envelope with products and pagination', async () => {
  const response = await get('/api/v1/products');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);

  const { data } = response.body;
  assert.ok(Array.isArray(data.products));
  assert.ok(Array.isArray(data.facets.brands));
  assert.equal(typeof data.pagination.total, 'number');
  assert.equal(typeof data.pagination.total_pages, 'number');
  assert.equal(typeof data.pagination.has_more, 'boolean');
  assert.equal(data.pagination.from, 1);
  // The seed holds 8 ACTIVE products and 1 DRAFT; the DRAFT must not be counted.
  assert.equal(data.pagination.total, 8);
});

test('a product listing never includes a DRAFT product', async () => {
  const response = await get('/api/v1/products?limit=60');

  const slugs = response.body.data.products.map((product) => product.slug);
  assert.ok(!slugs.includes('wireless-charging-pad-prototype'));
  assert.ok(slugs.every(Boolean));
});

test('GET /api/v1/categories returns a nested tree with inclusive counts', async () => {
  const response = await get('/api/v1/categories');

  assert.equal(response.status, 200);
  const { categories } = response.body.data;

  const electronics = categories.find((category) => category.slug === 'electronics');
  assert.ok(electronics, 'electronics should be a root');
  // Electronics holds no products directly; its 3 come from children. A count that
  // ignored descendants would show 0 and make the nav look broken.
  assert.equal(electronics.direct_product_count, 0);
  assert.equal(electronics.product_count, 3);
  assert.ok(Array.isArray(electronics.children));
});

test('GET /api/v1/categories?flat=1 returns un-nested rows', async () => {
  const response = await get('/api/v1/categories?flat=1');
  const { categories } = response.body.data;

  assert.ok(categories.length > 0);
  assert.ok(categories.every((category) => !Array.isArray(category.children)));
});

test('GET /api/v1/products/:slug returns a detail payload with breadcrumbs', async () => {
  const response = await get('/api/v1/products/nike-air-max-270');

  assert.equal(response.status, 200);
  const { product } = response.body.data;

  assert.equal(product.name, 'Nike Air Max 270');
  assert.equal(product.price_min_minor, 470000);
  assert.equal(product.is_purchasable, true);
  assert.equal(product.breadcrumbs.map((crumb) => crumb.name).join(' > '), 'Fashion > Shoes');
  assert.equal(product.rating_average, 5);
  assert.equal(product.rating_count, 1);
  assert.equal(product.rating_distribution.length, 5, 'all five star buckets are present');
});

test('detail attribute_options values are ARRAYS, as the filter panel expects', async () => {
  const response = await get('/api/v1/products/nike-air-max-270');
  const { product } = response.body.data;

  const color = product.attribute_options.find((option) => option.key === 'color');
  assert.ok(Array.isArray(color.values), 'values must be an array for .includes() to work');
  assert.deepEqual(color.values, ['Black', 'White']);
});

test('detail reviews expose author and body, the names the page renders', async () => {
  const response = await get('/api/v1/products/nike-air-max-270');
  const { product } = response.body.data;

  assert.equal(product.reviews.length, 1);
  const [review] = product.reviews;
  assert.equal(review.author, 'Abebe Bekele');
  assert.ok(review.body.length > 0);
  assert.equal(review.is_verified_purchase, true);
  assert.equal(review.rating, 5);
  // The reviewer record's email must not be reachable through a review payload.
  assert.equal(review.email, undefined);
  assert.equal(review.user_id, undefined);
});

test('GET /api/v1/products/:slug/reviews paginates and reports the unpaginated total', async () => {
  const response = await get('/api/v1/products/nike-air-max-270/reviews?page=1&limit=5');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.reviews.length, 1);
  assert.equal(response.body.data.pagination.total, 1);
  assert.equal(response.body.data.pagination.has_more, false);
});

test('catalogue responses are publicly cacheable', async () => {
  const response = await get('/api/v1/products');

  // Public is only safe because nothing here is per-user: no cart, no account.
  assert.match(response.headers['cache-control'], /public/);
  assert.match(response.headers['cache-control'], /max-age=\d+/);
});

/* -------------------------------------------------------------------------- */
/* Availability                                                                  */
/* -------------------------------------------------------------------------- */

test('a sold-out or unavailable product is STILL listable', async () => {
  const response = await get('/api/v1/products?limit=60');
  const ebook = response.body.data.products.find(
    (product) => product.slug === 'ebook-building-rest-apis-with-nodejs'
  );

  assert.ok(ebook, 'the ebook must appear in the catalogue');
  assert.equal(ebook.is_listable, true, 'hiding it would imply the shop does not stock it');
  assert.equal(ebook.is_purchasable, false);
  assert.equal(ebook.purchasability_reason, 'NO_PURCHASABLE_VARIANT');
  // Not "sold out": there are no variants to sell, which is a different statement.
  assert.deepEqual(ebook.badges, ['unavailable']);
});

test('availability=out_of_stock returns unavailable products, not an error', async () => {
  const response = await get('/api/v1/products?availability=out_of_stock');

  assert.equal(response.status, 200);
  assert.ok(response.body.data.products.length > 0);
  assert.ok(response.body.data.products.every((product) => product.is_purchasable === false));
});

test('availability=in_stock excludes products that cannot be bought', async () => {
  const response = await get('/api/v1/products?availability=in_stock');

  assert.equal(response.status, 200);
  assert.ok(response.body.data.products.every((product) => product.is_purchasable === true));
});

test('a variant with no inventory row is untracked, not sold out', async () => {
  const response = await get('/api/v1/products/icon-set-addis-city');
  const [variant] = response.body.data.product.variants;

  // This is the distinction the whole catalogue turns on: NULL stock means digital,
  // and 0 would mean sold out. Collapsing them marks every download unavailable.
  assert.equal(variant.stock, null);
  assert.equal(variant.is_digital, true);
  assert.equal(variant.is_purchasable, true);
});

/* -------------------------------------------------------------------------- */
/* Filtering, sorting, pagination                                                */
/* -------------------------------------------------------------------------- */

test('category filter scopes to the whole subtree', async () => {
  const response = await get('/api/v1/products?category=electronics&limit=60');

  assert.equal(response.status, 200);
  // Electronics has no products of its own; all 3 live on child categories.
  assert.equal(response.body.data.pagination.total, 3);
  assert.deepEqual(response.body.data.applied_filters.categories, ['electronics']);
  assert.equal(response.body.data.applied_filters.category_ids.length, 5);
});

test('facets are counted with the shopper own dimension omitted', async () => {
  const response = await get('/api/v1/products?category=fashion');
  const brands = response.body.data.facets.brands;

  // With "fashion" scoped, only fashion brands may appear — but the BRAND dimension
  // is not filtered, so other fashion brands keep their real counts.
  assert.ok(brands.length > 0);
  assert.ok(brands.every((brand) => brand.count > 0));
});

test('attribute filters accept repeated params and comma lists', async () => {
  const repeated = await get('/api/v1/products?attr.color=Black&attr.color=White&limit=60');
  const comma = await get('/api/v1/products?attr.color=Black,White&limit=60');

  assert.equal(repeated.status, 200);
  assert.equal(comma.status, 200);
  assert.equal(
    repeated.body.data.pagination.total,
    comma.body.data.pagination.total,
    'both spellings must select the same products'
  );
  assert.ok(repeated.body.data.pagination.total > 1);
});

test('attribute filters are OR within a key and AND across keys', async () => {
  const orWide = await get('/api/v1/products?attr.color=Black&attr.color=White&limit=60');
  const andNarrow = await get('/api/v1/products?attr.color=Black&attr.size=M&limit=60');

  assert.ok(
    andNarrow.body.data.pagination.total < orWide.body.data.pagination.total,
    'adding a second key must narrow the result'
  );
});

test('every sort key is accepted and rejected keys are refused', async () => {
  for (const sort of ['featured', 'newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc']) {
    const response = await get(`/api/v1/products?sort=${sort}`);
    assert.equal(response.status, 200, `sort=${sort} should be accepted`);
    assert.equal(response.body.data.sort, sort);
  }

  const rejected = await get('/api/v1/products?sort=DROP+TABLE');
  assert.equal(rejected.status, 422);
});

test('price-asc and price-desc actually order by price', async () => {
  const asc = await get('/api/v1/products?sort=price-asc&limit=60');
  const desc = await get('/api/v1/products?sort=price-desc&limit=60');

  const prices = (response) =>
    response.body.data.products.map((product) => product.price_min_minor).filter((p) => p !== null);

  const ascending = prices(asc);
  assert.deepEqual(
    ascending,
    [...ascending].sort((a, b) => a - b)
  );

  const descending = prices(desc);
  assert.deepEqual(
    descending,
    [...descending].sort((a, b) => b - a)
  );
});

test('pagination is stable: no duplicates or gaps across pages', async () => {
  const seen = [];

  for (let page = 1; page <= 3; page += 1) {
    const response = await get(`/api/v1/products?limit=3&page=${page}`);
    assert.equal(response.status, 200);
    // The total must not drift between pages, or the pager lies about its own
    // page count and a shopper can never reach the last page.
    assert.equal(response.body.data.pagination.total, 8);
    seen.push(...response.body.data.products.map((product) => product.slug));
  }

  assert.equal(seen.length, 8, 'three pages of three covers all 8 products');
  assert.equal(new Set(seen).size, 8, 'a product appeared on two pages');
});

test('a page past the end reports the real total and an empty range', async () => {
  const response = await get('/api/v1/products?page=99&limit=3');

  assert.equal(response.status, 200);
  const { pagination } = response.body.data;
  assert.equal(pagination.total, 8, 'the total must survive an empty page');
  assert.equal(response.body.data.products.length, 0);
  // "295-8 of 8" would read as corruption.
  assert.equal(pagination.from, 0);
  assert.equal(pagination.to, 0);
  assert.equal(pagination.has_more, false);
});

test('includeFacets=0 skips the facet queries', async () => {
  const response = await get('/api/v1/products?includeFacets=0');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.facets, null);
});

/* -------------------------------------------------------------------------- */
/* Search                                                                        */
/* -------------------------------------------------------------------------- */

test('GET /api/v1/search finds products by name and by variant attribute', async () => {
  const byName = await get('/api/v1/search?q=nike');
  assert.equal(byName.status, 200);
  assert.equal(byName.body.data.products.length, 1);

  // "black" appears only in variant attributes, never in a product name.
  const byAttribute = await get('/api/v1/search?q=black');
  assert.equal(byAttribute.status, 200);
  assert.ok(
    byAttribute.body.data.products.length > 0,
    'attribute values must be searchable, or the filter panel offers options search cannot find'
  );
});

test('a search term with no matches is an empty result, not an error', async () => {
  const response = await get('/api/v1/search?q=zzzzznothing');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.products, []);
  assert.equal(response.body.data.pagination.total, 0);
});

test('GET /api/v1/search/suggest returns products and category hits', async () => {
  const response = await get('/api/v1/search/suggest?q=phone');

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data.products));
  assert.ok(response.body.data.categories.length > 0, '"phone" should match the Phones category');
});

test('an empty search term is a 422, not the whole catalogue', async () => {
  const response = await get('/api/v1/search?q=');

  assert.equal(response.status, 422);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                    */
/* -------------------------------------------------------------------------- */

const INVALID_QUERIES = [
  ['page=0', 'page must start at 1'],
  ['page=-5', 'page must be positive'],
  ['page=abc', 'page must be a number'],
  ['limit=0', 'limit must be at least 1'],
  ['limit=100000', 'limit must be capped'],
  ['sort=nonsense', 'sort must be from the whitelist'],
  ['minPrice=-500', 'a negative price is refused'],
  ['minPrice=1.50', 'a fractional price is refused, not truncated'],
  ['minPrice=90000&maxPrice=1000', 'a crossed range is refused'],
  ['availability=maybe', 'availability is an enum'],
  ['productType=Subscription', 'product type is an enum'],
];

for (const [query, description] of INVALID_QUERIES) {
  test(`rejects ${query} — ${description}`, async () => {
    const response = await get(`/api/v1/products?${query}`);

    assert.equal(response.status, 422, `${query} should be refused`);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(response.body.error.details.errors));
    assert.ok(response.body.error.details.errors.length > 0);
  });
}

test('rejects an over-long search term', async () => {
  const response = await get(`/api/v1/search?q=${'a'.repeat(200)}`);

  assert.equal(response.status, 422);
});

/**
 * Malformed slugs are refused before they reach the database.
 *
 * Percent-encoded, because that is what a client actually puts on the wire. A raw
 * `<` in a request line is not something a browser emits, so asserting on it would
 * be testing the test client rather than the server.
 */
const MALFORMED_SLUGS = [
  ['<script>alert(1)</script>', 'script injection'],
  ['NOT A SLUG', 'spaces and capitals'],
  ['Upper-Case', 'uppercase letters'],
  ['trailing-', 'a trailing hyphen'],
  ['double--hyphen', 'a doubled hyphen'],
  ['-leading', 'a leading hyphen'],
  ['under_score', 'an underscore'],
  ['drop%20table', 'an encoded space'],
  ['a'.repeat(300), 'an absurd length'],
];

for (const [raw, description] of MALFORMED_SLUGS) {
  test(`rejects the slug ${JSON.stringify(raw).slice(0, 30)} — ${description}`, async () => {
    const response = await get(`/api/v1/products/${encodeURIComponent(raw)}`);

    // 422, not 404: the request was malformed, which is a different problem from
    // the product not existing, and the client can act on it.
    assert.equal(response.status, 422);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(response.body.error.details.errors[0].field, 'slug');
  });
}

test('a malformed slug is rejected on the category page too', async () => {
  const response = await get(`/api/v1/categories/${encodeURIComponent('<script>')}`);

  assert.equal(response.status, 422);
});

/* -------------------------------------------------------------------------- */
/* Injection                                                                     */
/* -------------------------------------------------------------------------- */

test('injection attempts are treated as literal search text and change nothing', async () => {
  const before = (await db.query('SELECT count(*)::int AS n FROM products')).rows[0].n;

  for (const attempt of [
    "'; DROP TABLE products; --",
    "' OR '1'='1",
    '100%',
    'a_b',
    "'; DELETE FROM reviews; --",
  ]) {
    const response = await get(`/api/v1/search?q=${encodeURIComponent(attempt)}`);

    // Either an empty result or an ordinary one: never an error, never data loss.
    assert.equal(response.status, 200, `${attempt} should be a normal search`);
  }

  const after = (await db.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
  const reviews = (await db.query('SELECT count(*)::int AS n FROM reviews')).rows[0].n;

  assert.equal(after, before, 'products table was altered by a search');
  assert.equal(reviews, 1, 'reviews table was altered by a search');
});

test('a LIKE wildcard searches for the literal character', async () => {
  const wildcard = await get(`/api/v1/search?q=${encodeURIComponent('%')}`);
  const everything = await get('/api/v1/search?q=a');

  // If % were passed through, q=% would match every product.
  assert.ok(
    wildcard.body.data.products.length < everything.body.data.pagination.total,
    'q=% must not match everything'
  );
});

/* -------------------------------------------------------------------------- */
/* 404s                                                                          */
/* -------------------------------------------------------------------------- */

test('an unknown product slug is a 404 with a specific code', async () => {
  const response = await get('/api/v1/products/no-such-product-anywhere');

  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'PRODUCT_NOT_FOUND');
});

test('a DRAFT product is a 404, not a preview', async () => {
  const response = await get('/api/v1/products/wireless-charging-pad-prototype');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'PRODUCT_NOT_FOUND');
});

test('an unknown category slug is a 404', async () => {
  const response = await get('/api/v1/categories/no-such-category');

  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'CATEGORY_NOT_FOUND');
});

test('an unknown category FILTER yields zero results, not a 404', async () => {
  // A stale link should say "nothing matches", not claim the category is missing.
  const response = await get('/api/v1/products?category=no-such-category');

  assert.equal(response.status, 200);
  assert.equal(response.body.data.pagination.total, 0);
});

/* -------------------------------------------------------------------------- */
/* Related                                                                       */
/* -------------------------------------------------------------------------- */

test('related products are populated even in a one-product leaf category', async () => {
  const response = await get('/api/v1/products/nike-air-max-270');
  const { related } = response.body.data.product;

  // Shoes holds only the Nike. An empty rail there is a visible hole in the page.
  assert.ok(related.length > 0);
  assert.ok(
    related.every((product) => product.slug !== 'nike-air-max-270'),
    'a product must not be related to itself'
  );
  // Related cards render through the same ProductCard, so they must be listing rows.
  assert.ok(related.every((product) => product.is_listable === true));
  assert.ok(related.every((product) => 'price_min_minor' in product));
});

test('includeRelated=0 omits the rail', async () => {
  const response = await get('/api/v1/products/nike-air-max-270?includeRelated=0');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.product.related, []);
});

test('GET /api/v1/products/:slug/related works standalone', async () => {
  const response = await get('/api/v1/products/nike-air-max-270/related?limit=2');

  assert.equal(response.status, 200);
  assert.ok(response.body.data.related.length <= 2);
});

/* -------------------------------------------------------------------------- */
/* Phase boundaries                                                              */
/* -------------------------------------------------------------------------- */

test('cart, wishlist, orders, payments and admin remain unimplemented', async () => {
  for (const path of [
    '/api/v1/cart',
    '/api/v1/wishlist',
    '/api/v1/orders',
    '/api/v1/payments',
    '/api/v1/admin',
  ]) {
    const response = await get(path);
    assert.equal(response.status, 501, `${path} belongs to a later phase`);
  }
});

test('catalogue endpoints are read-only: no write method is accepted', async () => {
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const response = await request(app)[method]('/api/v1/products');
    assert.ok(
      response.status === 404 || response.status === 405,
      `${method.toUpperCase()} /products should not be routable, got ${response.status}`
    );
  }
});
