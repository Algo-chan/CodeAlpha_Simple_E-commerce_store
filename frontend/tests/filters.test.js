/**
 * Filtering, sorting and pagination.
 *
 * The pure functions are tested directly rather than through the store, which
 * is the reason they were kept free of it: the grid, the result count and the
 * facet panel all call the same code, so they cannot disagree.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterProducts,
  sortProducts,
  queryProducts,
  countActiveFilters,
  buildChips,
  SORT_OPTIONS,
} from '../js/state/filters.js';
import { fixtureCatalogue } from '../js/mock/api.js';

const { products } = fixtureCatalogue();

/** An empty filter set, as the collection page starts from. */
const noFilters = {
  search: '',
  categoryId: null,
  attributes: {},
  price: { min: null, max: null },
  inStockOnly: false,
  onSaleOnly: false,
  sort: 'featured',
  page: 1,
  perPage: 12,
};

test('no filters returns every listable product', () => {
  const result = filterProducts(products, noFilters);

  assert.equal(result.length, products.filter((p) => p.is_listable).length);
});

test('a DRAFT product is filtered out even with no filters applied', () => {
  const result = filterProducts(products, noFilters);

  for (const product of result) assert.equal(product.is_listable, true);
});

test('filtering returns a new array and leaves the input untouched', () => {
  const before = products.length;
  const result = filterProducts(products, { ...noFilters, inStockOnly: true });

  assert.notEqual(result, products);
  assert.equal(products.length, before, 'the source list is never sorted in place');
});

test('a category filter includes descendant categories', () => {
  const catalogue = fixtureCatalogue();
  const parent = catalogue.categories.find((node) => node.children?.length > 0);
  assert.ok(parent, 'the fixture tree should nest at least one level');

  // Depth-first walk: `categories` is a tree, so descendants are not reachable
  // without flattening it first.
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  const all = flatten(catalogue.categories);

  const descendantIds = new Set([String(parent.id)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of all) {
      if (
        node.parent_id &&
        descendantIds.has(String(node.parent_id)) &&
        !descendantIds.has(String(node.id))
      ) {
        descendantIds.add(String(node.id));
        grew = true;
      }
    }
  }
  assert.ok(descendantIds.size > 1, 'the parent should have descendants');

  const result = filterProducts(
    products,
    { ...noFilters, categoryId: String(parent.id) },
    { categoryIds: descendantIds }
  );

  assert.ok(result.length > 0, 'a parent category should not come back empty');
  for (const product of result) {
    assert.ok(descendantIds.has(String(product.category_id)));
  }

  const directOnly = filterProducts(products, { ...noFilters, categoryId: String(parent.id) });
  assert.ok(
    result.length >= directOnly.length,
    'including descendants never hides a product the exact match found'
  );
});

test('filtering a parent without its descendant set still works', () => {
  const catalogue = fixtureCatalogue();
  const parent = catalogue.categories.find((node) => node.children?.length > 0);

  const result = filterProducts(products, { ...noFilters, categoryId: String(parent.id) });
  for (const product of result) {
    assert.equal(
      String(product.category_id),
      String(parent.id),
      'exact match when no set is supplied'
    );
  }
});

test('search matches name, brand, category and tags case-insensitively', () => {
  const target = products.find((product) => product.is_listable);
  const word = target.name.split(' ')[0];

  const result = filterProducts(products, { ...noFilters, search: word.toUpperCase() });

  assert.ok(
    result.some((product) => String(product.id) === String(target.id)),
    `"${word}" should find the product regardless of case`
  );
});

test('search that matches nothing returns an empty list, not everything', () => {
  const result = filterProducts(products, { ...noFilters, search: 'zzz-nothing-zzz' });
  assert.deepEqual(result, []);
});

test('the in-stock filter keeps products with any purchasable variant', () => {
  const result = filterProducts(products, { ...noFilters, inStockOnly: true });

  assert.ok(result.length > 0);
  for (const product of result) assert.equal(product.in_stock, true);
});

test('the on-sale filter keeps only products priced below compare-at', () => {
  const onSale = products.filter((product) => product.is_listable && product.is_on_sale);
  if (onSale.length === 0) return;

  const result = filterProducts(products, { ...noFilters, onSaleOnly: true });

  assert.equal(result.length, onSale.length);
  for (const product of result) assert.equal(product.is_on_sale, true);
});

test('a price range keeps a product that spans the boundary', () => {
  const result = filterProducts(products, { ...noFilters, price: { min: 500000, max: 2000000 } });

  for (const product of result) {
    assert.ok(product.price_max_minor >= 500000, 'a product reaching into the range shows');
    assert.ok(product.price_min_minor <= 2000000, 'a product starting below the ceiling shows');
  }
});

test('attribute facets are OR within a key and AND across keys', () => {
  const withColors = products.filter((product) => (product.attributes?.color ?? []).length > 1);
  if (withColors.length === 0) return;

  const [black, navy] = withColors[0].attributes.color;

  const either = filterProducts(products, { ...noFilters, attributes: { color: [black, navy] } });
  assert.ok(
    either.some(
      (product) =>
        (product.attributes.color ?? []).includes(black) ||
        (product.attributes.color ?? []).includes(navy)
    )
  );

  const both = filterProducts(products, {
    ...noFilters,
    attributes: { color: [black], size: ['this-size-does-not-exist'] },
  });
  assert.deepEqual(both, [], 'an unsatisfiable combination yields nothing');
});

test('filters combine rather than replacing one another', () => {
  const inStock = filterProducts(products, { ...noFilters, inStockOnly: true });
  const narrowed = filterProducts(products, { ...noFilters, inStockOnly: true, onSaleOnly: true });

  assert.ok(narrowed.length <= inStock.length, 'adding a facet cannot widen the result');
});

test('every sort option returns a stable, complete ordering', () => {
  for (const key of Object.keys(SORT_OPTIONS)) {
    const sorted = sortProducts(products, key);

    assert.equal(sorted.length, products.length, `${key} must not drop products`);
    assert.notEqual(sorted, products, `${key} must not sort the source in place`);
    assert.deepEqual(
      [...sorted].map((p) => p.id).sort(),
      products.map((p) => p.id).sort(),
      `${key} must be a permutation of the input`
    );
  }
});

test('price sorting runs from the cheapest variant', () => {
  const ascending = sortProducts(
    products.filter((p) => p.is_listable),
    'price-asc'
  );
  const prices = ascending.map((product) => product.price_min_minor ?? Infinity);

  for (let i = 1; i < prices.length; i += 1) {
    assert.ok(prices[i] >= prices[i - 1], `position ${i} breaks the ascending order`);
  }

  const descending = sortProducts(
    products.filter((p) => p.is_listable),
    'price-desc'
  );
  assert.ok(descending[0].price_min_minor >= descending[descending.length - 1].price_min_minor);
});

test('name sorting is alphabetical in both directions', () => {
  const listable = products.filter((product) => product.is_listable);

  const asc = sortProducts(listable, 'name-asc').map((p) => p.name);
  const desc = sortProducts(listable, 'name-desc').map((p) => p.name);

  assert.deepEqual(
    asc,
    [...asc].sort((a, b) => a.localeCompare(b))
  );
  assert.deepEqual(desc, [...asc].reverse());
});

test('featured sorting puts flagged products first', () => {
  const sorted = sortProducts(products, 'featured');
  const flagged = sorted.filter((product) => product.is_featured).length;

  assert.equal(flagged, products.filter((product) => product.is_featured).length);
  assert.ok(sorted.slice(0, flagged).every((product) => product.is_featured));
});

test('an unknown sort key falls back to featured instead of throwing', () => {
  assert.deepEqual(
    sortProducts(products, 'nonsense').map((p) => p.id),
    sortProducts(products, 'featured').map((p) => p.id)
  );
});

test('queryProducts pages without losing or duplicating a product', () => {
  const perPage = 5;
  const all = queryProducts(products, { ...noFilters, sort: 'name-asc', perPage, page: 1 });
  const seen = new Set();

  assert.equal(all.items.length, Math.min(perPage, all.total));
  assert.ok(all.totalPages >= 1);

  for (let page = 1; page <= all.totalPages; page += 1) {
    const result = queryProducts(products, { ...noFilters, sort: 'name-asc', perPage, page });
    for (const item of result.items) {
      assert.equal(seen.has(item.id), false, `page ${page} repeated ${item.id}`);
      seen.add(item.id);
    }
  }

  assert.equal(seen.size, all.total, 'every product appears exactly once across the pages');
});

test('an out-of-range page clamps to the last one instead of showing nothing', () => {
  const result = queryProducts(products, { ...noFilters, perPage: 4, page: 999 });

  assert.equal(result.page, result.totalPages);
  assert.ok(result.items.length > 0, 'the shopper sees products, not an empty grid');
});

test('a page below one clamps up', () => {
  const result = queryProducts(products, { ...noFilters, perPage: 4, page: -3 });
  assert.equal(result.page, 1);
});

test('an empty result set reports one page rather than zero', () => {
  const result = queryProducts(products, { ...noFilters, search: 'zzz-nothing-zzz', perPage: 12 });

  assert.equal(result.total, 0);
  assert.equal(result.totalPages, 1, 'pagination needs a page to render against');
  assert.deepEqual(result.items, []);
  assert.equal(result.from, 0);
  assert.equal(result.to, 0);
});

test('active filters are counted for the "clear all" affordance', () => {
  assert.equal(countActiveFilters(noFilters), 0);
  assert.equal(countActiveFilters({ ...noFilters, search: 'shirt' }), 1);
  assert.equal(countActiveFilters({ ...noFilters, inStockOnly: true, onSaleOnly: true }), 2);
  assert.equal(countActiveFilters({ ...noFilters, price: { min: 100, max: 200 } }), 2);
  assert.equal(
    countActiveFilters({ ...noFilters, attributes: { color: ['Black', 'Navy'] } }),
    2,
    'each selected value counts separately'
  );
});

test('chips describe each active filter and can remove themselves', () => {
  const filters = {
    ...noFilters,
    search: 'shirt',
    attributes: { color: ['Black'] },
    inStockOnly: true,
    price: { min: 100000, max: 500000 },
  };

  const chips = buildChips(filters);
  const types = chips.map((chip) => chip.type);

  assert.ok(types.includes('search'));
  assert.ok(types.includes('attribute'));
  assert.ok(types.includes('inStock'));
  assert.equal(
    chips.filter((chip) => chip.type === 'price').length,
    1,
    'a two-sided price range is one chip'
  );

  for (const chip of chips) {
    assert.ok(chip.label, 'every chip is labelled');
    assert.ok(chip.key, 'every chip knows its own key, so it can remove itself');
  }
});

test('a one-sided price bound is its own chip', () => {
  assert.equal(buildChips({ ...noFilters, price: { min: 100, max: null } })[0].value, 'min');
  assert.equal(buildChips({ ...noFilters, price: { min: null, max: 100 } })[0].value, 'max');
});
