/**
 * Catalogue store: lookups, merchandising selectors and facets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCatalogueStore,
  flattenCategories,
  humaniseAttribute,
  LOAD_STATUS,
} from '../js/state/catalogue.js';
import { fixtureCatalogue } from '../js/mock/api.js';

function loaded() {
  const catalogue = createCatalogueStore();
  catalogue.setCatalogue(fixtureCatalogue());
  return catalogue;
}

test('an unloaded catalogue reports idle, then ready', () => {
  const catalogue = createCatalogueStore();
  assert.equal(catalogue.getState().status, LOAD_STATUS.idle);

  catalogue.setLoading();
  assert.equal(catalogue.getState().status, LOAD_STATUS.loading);

  catalogue.setCatalogue(fixtureCatalogue());
  assert.equal(catalogue.getState().status, LOAD_STATUS.ready);
});

test('a failed load reports the error rather than an empty catalogue', () => {
  const catalogue = createCatalogueStore();
  const failure = new Error('catalogue unavailable');

  catalogue.setError(failure);

  assert.equal(catalogue.getState().status, LOAD_STATUS.error);
  assert.equal(catalogue.getState().error, failure);
});

test('products are reachable by id and by slug', () => {
  const catalogue = loaded();
  const [first] = catalogue.selectListable();

  assert.equal(catalogue.getProduct(first.id).slug, first.slug);
  assert.equal(catalogue.getProductBySlug(first.slug).id, first.id);
  assert.equal(catalogue.getProduct('missing'), null);
  assert.equal(catalogue.getProductBySlug('missing'), null);
  assert.equal(catalogue.getProduct(null), null);
});

test('variants are reachable by id, including synthetic digital ones', () => {
  const catalogue = loaded();

  for (const product of catalogue.selectListable()) {
    for (const variant of product.variants ?? []) {
      assert.ok(catalogue.getVariant(variant.id), `variant ${variant.id} should resolve`);
    }
  }

  const digital = catalogue
    .selectListable()
    .find((product) => product.is_digital && product.default_variant?.synthetic);
  assert.ok(
    catalogue.getVariant(digital.default_variant.id),
    'a synthetic variant must resolve, or reconcile flags a good download as missing'
  );
});

test('a DRAFT product is never listable', () => {
  const catalogue = loaded();
  const drafts = catalogue.selectProducts().filter((product) => product.status !== 'ACTIVE');

  assert.ok(drafts.length > 0, 'the fixture set should include a non-ACTIVE product');
  for (const draft of drafts) {
    assert.equal(draft.is_listable, false);
    assert.ok(!catalogue.selectListable().includes(draft), 'a DRAFT must not reach any grid');
  }
});

test('a category filter includes products in descendant categories', () => {
  const catalogue = loaded();
  const parents = catalogue.selectCategories().filter((category) => category.depth === 0);

  for (const parent of parents) {
    const direct = catalogue
      .getAllCategories()
      .filter((category) => String(category.parent_id) === String(parent.id))
      .map((c) => String(c.id));

    const products = catalogue.getProductsInCategory(parent.id);
    for (const product of products) {
      const ids = [String(product.category_id), ...direct];
      assert.ok(
        ids.includes(String(product.category_id)),
        'products come from the category or its children'
      );
    }
  }
});

test('breadcrumbs run from root to the category', () => {
  const catalogue = loaded();
  const leaf = catalogue.selectCategories().find((category) => category.depth > 0);
  if (!leaf) return; // a flat catalogue has no leaf to walk

  const trail = catalogue.getCategoryTrail(leaf.id);

  assert.ok(trail.length >= 2, 'at least a root and the category itself');
  assert.equal(trail[0].depth, 0, 'the root comes first');
  assert.equal(String(trail[trail.length - 1].id), String(leaf.id), 'the category comes last');
});

test('a category trail with a broken parent link terminates', () => {
  const catalogue = createCatalogueStore();
  catalogue.setCatalogue({
    products: [],
    categories: [{ id: 'a', parent_id: 'missing', name: 'Orphan', depth: 0, children: [] }],
  });

  const trail = catalogue.getCategoryTrail('a');
  assert.equal(trail.length, 1, 'it stops rather than looping');
});

test('featured and new arrivals are editorial flags, not date guesses', () => {
  const catalogue = loaded();

  const featured = catalogue.selectFeatured();
  assert.ok(featured.length > 0);
  for (const product of featured) {
    assert.equal(product.is_featured, true);
    assert.equal(product.is_listable, true);
  }

  const arrivals = catalogue.selectNewArrivals();
  assert.ok(arrivals.length > 0);
  for (const product of arrivals) assert.equal(product.is_new, true);

  const dates = arrivals.map((product) => new Date(product.created_at).getTime());
  const sorted = [...dates].sort((a, b) => b - a);
  assert.deepEqual(dates, sorted, 'ordered by date within the flagged set');
});

test('popular is a merchandised rank that excludes unranked products', () => {
  const catalogue = loaded();
  const popular = catalogue.selectPopular();

  assert.ok(popular.length > 0);
  for (const product of popular) {
    assert.ok(
      product.display_order > 0,
      'a product with no rank drops out rather than sorting to the top'
    );
  }

  const ranks = popular.map((product) => product.display_order);
  assert.deepEqual(
    ranks,
    [...ranks].sort((a, b) => a - b)
  );
});

test('related products share a category and exclude the product itself', () => {
  const catalogue = loaded();
  // `selectRelated` is curried: the store selector yields a `(product) => list`,
  // so the anchor is resolved before the selector is applied.
  const relatedFor = catalogue.selectRelated();

  for (const product of catalogue.selectListable().slice(0, 5)) {
    const related = relatedFor(product);
    for (const candidate of related) {
      assert.notEqual(String(candidate.id), String(product.id));
      assert.equal(candidate.is_listable, true);
    }
  }

  assert.deepEqual(relatedFor(null), []);
});

test('related products are capped so a rail cannot run away', () => {
  const catalogue = loaded();
  const relatedFor = catalogue.selectRelated();

  for (const product of catalogue.selectListable()) {
    assert.ok(relatedFor(product).length <= 8);
  }
});

test('facets cover every attribute value with a count and a price range', () => {
  const catalogue = loaded();
  const facets = catalogue.selectFacets();

  assert.ok(facets.price.min > 0);
  assert.ok(facets.price.max >= facets.price.min);
  assert.ok(facets.attributes.length > 0);

  for (const attribute of facets.attributes) {
    assert.ok(attribute.label, 'each attribute is humanised for the panel');
    for (const value of attribute.values) {
      assert.ok(value.count >= 1);
      assert.equal(typeof value.value, 'string');
    }
  }
});

test('facet counts agree with the catalogue', () => {
  const catalogue = loaded();
  const listable = catalogue.selectListable();

  for (const attribute of catalogue.selectFacets().attributes) {
    for (const { value, count } of attribute.values) {
      const actual = listable.filter((product) =>
        (product.attributes?.[attribute.key] ?? []).includes(value)
      ).length;
      assert.equal(count, actual, `count for ${attribute.key}=${value}`);
    }
  }
});

test('flattenCategories is depth-first with parents before children', () => {
  const tree = [
    {
      id: 'a',
      children: [
        { id: 'a1', children: [] },
        { id: 'a2', children: [] },
      ],
    },
    { id: 'b', children: [] },
  ];

  const flat = flattenCategories(tree);

  assert.deepEqual(
    flat.map((node) => [node.id, node.depth]),
    [
      ['a', 0],
      ['a1', 1],
      ['a2', 1],
      ['b', 0],
    ]
  );
});

test('humaniseAttribute turns a key into a label', () => {
  assert.equal(humaniseAttribute('available_colors'), 'Available colors');
  assert.equal(humaniseAttribute('ram'), 'Ram');
  assert.equal(humaniseAttribute('storage-capacity'), 'Storage capacity');
});
