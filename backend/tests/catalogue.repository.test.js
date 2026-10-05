/**
 * Catalogue unit tests — the pure layer, no database.
 *
 * These target the parts where a bug is INVISIBLE in the happy path: the filter
 * compiler, LIKE escaping, monetary arithmetic and the view model's treatment of
 * NULL. Each has a paired test here that fails only when the specific mistake is
 * made, which is what makes the suite worth keeping as the codebase grows.
 *
 * The SQL itself is covered by `catalogue.api.test.js` against a real engine; these
 * tests exist because a pure function can be checked exhaustively and a query
 * cannot.
 */
import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileProductFilters,
  compileSearch,
  escapeLikePattern,
  ParamList,
  SORT_CLAUSES,
  SORT_KEYS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../src/repositories/catalogue.repository.js';
import {
  discountPercent,
  lineTotalMinor,
  isValidPriceMinor,
  MAX_PRICE_MINOR,
} from '../src/services/money.js';
import {
  toListingProduct,
  toVariant,
  toReview,
  isRecentlyAdded,
  productAttributes,
  mergeAttributes,
  editorialFields,
  PURCHASABILITY,
} from '../src/services/catalogue.view.js';
import {
  listProductsQuerySchema,
  slugSchema,
  attributeKeySchema,
  attributeValueSchema,
} from '../src/validators/catalogue.schema.js';

/* -------------------------------------------------------------------------- */
/* The empty-array distinction                                                    */
/* -------------------------------------------------------------------------- */

test('no category filter omits the clause; an empty category list matches nothing', () => {
  const absent = compileProductFilters({ categoryIds: null });
  const empty = compileProductFilters({ categoryIds: [] });
  const present = compileProductFilters({ categoryIds: ['11111111-1111-4111-8111-111111111111'] });

  // This is the whole point. `?category=deleted` must return zero products, and it
  // does so because the empty array still emits a clause. Dropping it on `.length`
  // would answer a broken category link with the entire shop.
  assert.ok(!absent.clause.includes('category_id'), 'no filter means no category clause');
  assert.ok(empty.clause.includes('category_id'), 'an empty list must still constrain');
  assert.ok(present.clause.includes('category_id'));

  // Only the status literal is bound when nothing is filtered.
  assert.equal(absent.params.values.length, 1);
  assert.equal(absent.params.values[0], 'ACTIVE');
  assert.equal(empty.params.values.length, 2);
});

test('the category filter is bound as a parameter, never interpolated', () => {
  const hostile = "'; DROP TABLE products; --";
  const { clause, params } = compileProductFilters({ categoryIds: [hostile] });

  assert.ok(!clause.includes(hostile), 'the value must never appear in the SQL text');
  // The array is bound as a single uuid[] parameter, not stringified into SQL.
  assert.ok(
    params.values.some((value) => Array.isArray(value) && value[0] === hostile),
    'the value must be a bound parameter'
  );
  assert.match(clause, /p\.category_id = ANY\(\$\d+::uuid\[\]\)/);
});

test('only ACTIVE products are ever selected', () => {
  const { clause, params } = compileProductFilters({});

  assert.ok(clause.includes('p.status ='));
  assert.ok(params.values.includes('ACTIVE'));
  assert.ok(!clause.includes('DRAFT'));
  assert.ok(!clause.includes('ARCHIVED'));
});

/* -------------------------------------------------------------------------- */
/* Facet skipping                                                                 */
/* -------------------------------------------------------------------------- */

test('skipping a dimension omits only that dimension', () => {
  const filters = {
    categoryIds: ['11111111-1111-4111-8111-111111111111'],
    brands: ['Nike'],
    productTypes: ['SHOES'],
  };

  const withoutBrand = compileProductFilters(filters, { skip: 'brand' });

  // The shopper's own brand selection must not count itself, or every other brand
  // would report zero the moment "Nike" is ticked.
  assert.ok(!withoutBrand.clause.includes('p.brand'));
  assert.ok(withoutBrand.clause.includes('p.category_id'));
  assert.ok(withoutBrand.clause.includes('p.product_type'));
});

/* -------------------------------------------------------------------------- */
/* LIKE escaping                                                                  */
/* -------------------------------------------------------------------------- */

test('LIKE metacharacters are escaped so they match literally', () => {
  assert.equal(escapeLikePattern('100%'), '100\\%');
  assert.equal(escapeLikePattern('a_b'), 'a\\_b');
  assert.equal(escapeLikePattern('back\\slash'), 'back\\\\slash');

  // Without this, `?q=%` matches every product and the search box becomes a
  // catalogue dump — while looking like it worked.
  assert.ok(escapeLikePattern('%').includes('\\'));
  assert.ok(escapeLikePattern('_').includes('\\'));
});

test('every search term becomes an ILIKE clause with an ESCAPE', () => {
  const params = new ParamList();
  const { predicate, rank } = compileSearch(params, 'red shoe');

  assert.ok(predicate.includes('ILIKE'), 'search must be case-insensitive');
  assert.ok(predicate.includes('ESCAPE'), 'escaping is meaningless without an ESCAPE clause');
  assert.ok(rank.includes('CASE'), 'a search must come back ranked');
  // The rank binds the whole term for exact-match and prefix scoring; the
  // predicate binds one infix pattern per word.
  assert.ok(params.values.includes('red shoe'), 'the whole term is bound for exact matching');
  assert.ok(params.values.includes('%red%'), 'and each word gets its own infix pattern');
  assert.ok(params.values.includes('%shoe%'));
});

test('every word must match something', () => {
  const params = new ParamList();
  const { predicate } = compileSearch(params, 'max black');

  // Both words are conjunctive. "max black" must not return every black product on
  // the strength of "max" — that is the classic AND-versus-OR search bug, and it
  // returns plausible-looking results, so it survives casual testing.
  assert.ok(predicate.split('ILIKE').length - 1 >= 4, 'two words, several predicates each');
  assert.ok(predicate.includes('p.name'), 'name matches');
  assert.ok(predicate.includes('p.brand'), 'brand matches');
});

test('a bound pattern is reused across columns rather than bound per column', () => {
  const params = new ParamList();
  const { predicate } = compileSearch(params, 'black');

  const patterns = params.values.filter(
    (value) => typeof value === 'string' && value.includes('%')
  );
  const references = (predicate.match(/ILIKE/g) ?? []).length;

  // Three patterns: a prefix and an infix for the rank, plus one infix for the
  // word. The predicate then references that one infix from seven columns.
  // Binding per column instead would grow the parameter list without adding any
  // information — and an unreferenced placeholder makes PostgreSQL reject the whole
  // statement as untyped, so the sharing is load-bearing, not an optimisation.
  assert.equal(patterns.length, 3);
  assert.ok(references > 6, `expected the pattern to be reused, saw ${references} references`);
});

test('search matches variant attributes, not just product names', () => {
  const { predicate, rank } = compileSearch(new ParamList(), 'black');

  // "black" exists only in a variant attribute_value. If this regresses, the
  // filter panel offers options that search can never find.
  assert.ok(predicate.includes('jsonb_each_text'), 'the predicate must reach variant attributes');
  // ...but at the weakest rank, since every product sharing "Black" matches.
  assert.ok(rank.includes('jsonb_each_text'), 'the rank must consider attributes too');
  assert.ok(rank.includes('THEN 6'), 'attributes rank below name and brand');
});

test('a blank search term compiles to nothing', () => {
  for (const blank of ['', '   ', '\t\n']) {
    const params = new ParamList();
    const compiled = compileSearch(params, blank);

    assert.equal(compiled.predicate, '');
    assert.equal(compiled.rank, '', `blank term ${JSON.stringify(blank)} must compile to nothing`);
    assert.equal(params.values.length, 0, 'and must bind nothing');
  }
});

/* -------------------------------------------------------------------------- */
/* Sorting                                                                        */
/* -------------------------------------------------------------------------- */

test('every sort key has a clause and the keys are the frontend spellings', () => {
  for (const key of ['featured', 'newest', 'price-asc', 'price-desc', 'name-asc', 'name-desc']) {
    assert.ok(SORT_CLAUSES[key], `sort key ${key} has no clause`);
  }

  assert.deepEqual([...SORT_KEYS].sort(), [
    'featured',
    'name-asc',
    'name-desc',
    'newest',
    'price-asc',
    'price-desc',
  ]);
});

test('an unknown sort key falls back rather than reaching the SQL', () => {
  assert.equal(SORT_CLAUSES['price-asc; DROP TABLE products'], undefined);
  assert.ok(SORT_CLAUSES[SORT_KEYS[0]], 'there is always a default');
});

test('price sorts place missing prices last in both directions', () => {
  // A digital product has no price. Sorting it first as "cheapest" is a lie, and
  // sorting it last as "most expensive" is equally a lie; last is the honest place.
  assert.ok(/NULLS LAST/i.test(SORT_CLAUSES['price-asc']), 'ascending must push NULLs last');
  assert.ok(/NULLS LAST/i.test(SORT_CLAUSES['price-desc']), 'descending must push NULLs last');
});

test('page limits are bounded', () => {
  assert.ok(MAX_LIMIT <= 60, 'an uncapped limit is a data exfiltration primitive');
  assert.ok(DEFAULT_LIMIT > 0 && DEFAULT_LIMIT <= MAX_LIMIT);
});

/* -------------------------------------------------------------------------- */
/* Money                                                                          */
/* -------------------------------------------------------------------------- */

test('discount percentage is relative to the was-price', () => {
  // 7,500 off 10,000 is a 25% discount. Dividing by the sale price instead gives
  // 33%, which is the sale price as a share of the original — true, but not what
  // anyone means by "off", and the most commonly miscalculated figure in a shop.
  assert.equal(discountPercent(7500, 10000), 25);
  assert.equal(discountPercent(5000, 10000), 50);
  assert.equal(discountPercent(100, 10000), 99);
  // Rounded down, so a saving is never overstated.
  assert.equal(discountPercent(3333, 10000), 66);
});

test('no discount is null, not zero', () => {
  // 0 would be a real zero-percent discount; null means "no badge to render".
  assert.equal(discountPercent(10000, 10000), null);
  assert.equal(discountPercent(10000, null), null);
  assert.equal(discountPercent(null, 10000), null);
  assert.equal(discountPercent(0, 10000), null);
});

test('a compare-at price below the sale price yields no discount', () => {
  // Otherwise the UI shows "-75%" on a price rise.
  assert.equal(discountPercent(12000, 10000), null);
});

test('line totals multiply in minor units', () => {
  assert.equal(lineTotalMinor(49900, 2), 99800);
  assert.equal(lineTotalMinor(49900, 0), 0);
  // Fractional ETB has no representation, so a fractional quantity is refused
  // rather than silently rounded into a different charge.
  assert.equal(lineTotalMinor(3333, 3), 9999);
});

test('price validation accepts the ceiling and rejects beyond it', () => {
  assert.equal(isValidPriceMinor(0), true);
  assert.equal(isValidPriceMinor(MAX_PRICE_MINOR), true);
  assert.equal(isValidPriceMinor(MAX_PRICE_MINOR + 1), false);
  assert.equal(isValidPriceMinor(-1), false);
  assert.equal(isValidPriceMinor(10.5), false, 'prices are integers, not floats');
  assert.equal(isValidPriceMinor('100'), false, 'a string price is not a price');
  assert.equal(isValidPriceMinor(NaN), false);
  assert.equal(isValidPriceMinor(Infinity), false);
});

/* -------------------------------------------------------------------------- */
/* NULL stock — the distinction the whole shop turns on                          */
/* -------------------------------------------------------------------------- */

const DIGITAL_ROW = {
  id: '1',
  sku: 'DL-1',
  price: 25000,
  compare_at_price: null,
  is_active: true,
  attributes: { format: 'SVG' },
  // No inventory row at all. The repository reports `available` as NULL, not 0.
  available: null,
  quantity: null,
  reserved_quantity: null,
};

const DIGITAL_PRODUCT = {
  id: 'p1',
  slug: 'icon-set',
  name: 'Icon Set',
  product_type: 'DIGITAL',
};

const SOLD_OUT_ROW = {
  ...DIGITAL_ROW,
  sku: 'SO-1',
  available: 0,
  quantity: 0,
  reserved_quantity: 0,
};

const PHYSICAL_PRODUCT = { ...DIGITAL_PRODUCT, product_type: 'PHYSICAL' };

test('a NULL stock row means untracked and buyable, not sold out', () => {
  const variant = toVariant(DIGITAL_ROW, DIGITAL_PRODUCT, null);

  assert.equal(variant.stock, null, 'stock must stay null so the UI can tell the difference');
  assert.equal(variant.is_digital, true);
  assert.equal(variant.is_purchasable, true);
  assert.equal(variant.purchasability_reason, PURCHASABILITY.AVAILABLE);
});

test('a tracked quantity of zero means sold out', () => {
  const variant = toVariant(SOLD_OUT_ROW, PHYSICAL_PRODUCT, null);

  assert.equal(variant.is_digital, false);
  assert.equal(variant.stock.available, 0);
  assert.equal(variant.stock.is_tracked, true);
  assert.equal(variant.is_purchasable, false);
});

test('stock is net of reservations', () => {
  const reserved = toVariant(
    { ...SOLD_OUT_ROW, available: 0, quantity: 10, reserved_quantity: 10 },
    PHYSICAL_PRODUCT,
    null
  );

  // 10 on the shelf but all of it promised to other orders means nothing to sell.
  assert.equal(reserved.stock.quantity, 10);
  assert.equal(reserved.stock.reserved, 10);
  assert.equal(reserved.stock.available, 0);
  assert.equal(reserved.is_purchasable, false);
});

test('an inactive variant is not purchasable however much stock it has', () => {
  const inactive = toVariant(
    { ...SOLD_OUT_ROW, is_active: false, available: 5, quantity: 5, reserved_quantity: 0 },
    PHYSICAL_PRODUCT,
    null
  );

  assert.equal(inactive.is_purchasable, false);
});

test('variant attributes are exposed as a plain key/value map', () => {
  const variant = toVariant(
    { ...DIGITAL_ROW, attributes: { color: 'Black', size: '40' } },
    DIGITAL_PRODUCT,
    null
  );

  assert.deepEqual(variant.attributes, { color: 'Black', size: '40' });
  assert.ok(variant.label.includes('Black'), 'the picker needs a human label');
});

test('a product with no purchasable variant is unavailable, and still listable', () => {
  const row = {
    id: 'p9',
    slug: 'ebook',
    name: 'Ebook',
    brand: null,
    product_type: 'DIGITAL',
    created_at: new Date(),
    status: 'ACTIVE',
    category_slug: 'digital-downloads',
    category_name: 'Digital Downloads',
    category_id: 'c1',
    price_min_minor: null,
    price_max_minor: null,
    compare_at_minor: null,
    variant_count: 0,
    purchasable_count: 0,
    total_stock: 0,
    rating_average: 0,
    rating_count: 0,
    images: [],
  };

  const product = toListingProduct(row);

  assert.equal(product.is_purchasable, false);
  assert.equal(product.is_listable, true, 'unbuyable is not the same as unstocKed');
  assert.equal(product.price_min_minor, null, 'no price means no price, not zero');
});

/* -------------------------------------------------------------------------- */
/* Editorial fields                                                               */
/* -------------------------------------------------------------------------- */

test('editorial fields are explicit, not absent', () => {
  const fields = editorialFields({ createdAt: new Date() });

  // A missing key reads as "not decided" in the UI; false and 0 read as "decided".
  assert.equal(fields.is_featured, false);
  assert.equal(fields.display_order, 0);
  assert.equal(typeof fields.is_new, 'boolean');
});

test('is_new is a 30-day window, and the boundary is not fuzzy', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const day = 86_400_000;

  assert.equal(isRecentlyAdded(new Date(now - 5 * day), { now }), true);
  assert.equal(isRecentlyAdded(new Date(now - 29 * day), { now }), true);
  assert.equal(isRecentlyAdded(new Date(now - 31 * day), { now }), false);
  assert.equal(isRecentlyAdded(new Date(now - 400 * day), { now }), false);
  // A product with no creation date must not claim to be new.
  assert.equal(isRecentlyAdded(null, { now }), false);
});

/* -------------------------------------------------------------------------- */
/* Attributes                                                                     */
/* -------------------------------------------------------------------------- */

test('product attributes union active variants only', () => {
  const variants = [
    { is_active: true, attributes: { color: 'Black', size: '40' } },
    { is_active: true, attributes: { color: 'White', size: '42' } },
    { is_active: false, attributes: { color: 'Neon', internal_code: 'X1' } },
  ];

  const attributes = productAttributes(variants);

  // Sorted, so the filter panel is byte-identical between two responses.
  assert.deepEqual(attributes.color, ['Black', 'White']);
  assert.deepEqual(attributes.size, ['40', '42']);
  // A draft variant's attributes must not appear in the filter panel, or the
  // shopper selects "Neon" and gets nothing.
  assert.ok(!attributes.color.includes('Neon'));
  assert.equal(attributes.internal_code, undefined);
});

test('productAttributes and mergeAttributes differ only by the active filter', () => {
  const variants = [
    { is_active: true, attributes: { color: 'Black' } },
    { is_active: false, attributes: { color: 'Neon' } },
  ];

  // The picker must show a sold-out option rather than let it vanish; the filter
  // must not offer a value that can never match. Same input, two deliberate
  // answers, and the difference has to stay exactly this one.
  assert.deepEqual(productAttributes(variants).color, ['Black']);
  assert.deepEqual(mergeAttributes(variants).color, ['Black', 'Neon']);
});

test('attribute values are sorted so the filter panel is stable between requests', () => {
  const one = productAttributes([
    { attributes: { color: 'White' } },
    { attributes: { color: 'Black' } },
  ]);
  const two = productAttributes([
    { attributes: { color: 'Black' } },
    { attributes: { color: 'White' } },
  ]);

  assert.deepEqual(one.color, two.color, 'the same data must not produce a different order');
  assert.deepEqual(one.color, ['Black', 'White']);
});

/* -------------------------------------------------------------------------- */
/* Reviews                                                                        */
/* -------------------------------------------------------------------------- */

test('a review exposes author and body, never the reviewer account', () => {
  const review = toReview({
    id: 'r1',
    product_id: 'p1',
    rating: 5,
    title: 'Great',
    comment: 'Comfortable and true to size.',
    reviewer_name: 'Abebe Bekele',
    created_at: new Date(),
    is_verified_purchase: true,
    email: 'abebe@example.com',
    user_id: 'u1',
  });

  assert.equal(review.author, 'Abebe Bekele');
  assert.equal(review.body, 'Comfortable and true to size.');
  assert.equal(review.is_verified_purchase, true);
  assert.equal(review.user_id, undefined, 'a review must not leak the account id');
  assert.equal(review.email, undefined, 'a review must not leak the reviewer email');
});

/* -------------------------------------------------------------------------- */
/* Validator defaults                                                             */
/* -------------------------------------------------------------------------- */

test('an empty listing query gets safe defaults, not undefined everywhere', () => {
  const parsed = listProductsQuerySchema.parse({});

  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 24);
  assert.equal(parsed.sort, 'featured');
  assert.deepEqual(parsed.categories, []);
  assert.deepEqual(parsed.attributes, {});
});

test('the slug validator refuses everything that is not a slug', () => {
  assert.equal(slugSchema.safeParse('nike-air-max-270').success, true);
  for (const bad of ['Nike', 'has space', '-leading', 'trailing-', 'a--b', 'under_score', '']) {
    assert.equal(slugSchema.safeParse(bad).success, false, `${bad} should fail`);
  }
});

test('a nested object in a filter parameter is rejected, not coerced', () => {
  // `?brand[$ne]=` reaches a validator as a real object under Express's extended
  // query parser. Coercing it to a string would let "[object Object]" become a
  // brand filter; passing it through would reach the SQL as an object. Refusing is
  // the only safe answer.
  const result = listProductsQuerySchema.safeParse({ brand: { $ne: null } });

  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path[0] === 'brand'));
});

test('attribute values reject characters that could escape their context', () => {
  const hostile = [
    // Would break out of an HTML attribute.
    '"><script>alert(1)</script>',
    // Would break out of a single-quoted JS string in a log line.
    "'; DROP TABLE products; --",
    // Backtick template injection.
    'red`${process.exit(1)}`',
    // A newline smuggled into a log line, so a later entry reads as trusted.
    'black\nINFO: authorised',
    // An ampersand, which would let a value sit next to an HTML entity.
    '&lt;',
    // A real NUL byte, not the two characters "\" and "0". Built with fromCharCode
    // because a literal control character in source is invisible to a reviewer.
    `black${String.fromCharCode(0)}`,
    // A raw DEL, which no terminal displays but a log file happily stores.
    `black${String.fromCharCode(127)}`,
  ];

  for (const value of hostile) {
    assert.equal(
      attributeValueSchema.safeParse(value).success,
      false,
      `${JSON.stringify(value)} should be rejected`
    );
  }

  // The point of the rule: ordinary shopper vocabulary still passes.
  for (const value of ['Black', '256GB', 'Stainless Steel', 'Kid Size 4', 'Red / Blue']) {
    assert.equal(
      attributeValueSchema.safeParse(value).success,
      true,
      `${JSON.stringify(value)} should be accepted`
    );
  }
});

test('attribute keys are restricted to safe identifiers', () => {
  assert.equal(attributeKeySchema.safeParse('color').success, true);
  assert.equal(attributeKeySchema.safeParse('storage_gb').success, true);
  for (const key of ['col or', 'color;', '', 'a'.repeat(41), 'color-']) {
    assert.equal(
      attributeKeySchema.safeParse(key).success,
      false,
      `${JSON.stringify(key)} should fail`
    );
  }
});

test('a repeated filter parameter becomes an array of strings', () => {
  const parsed = listProductsQuerySchema.parse({ brand: ['Nike', 'Adidas'] });

  assert.deepEqual(parsed.brand, ['Nike', 'Adidas']);
  assert.ok(parsed.brand.every((value) => typeof value === 'string'));
});
