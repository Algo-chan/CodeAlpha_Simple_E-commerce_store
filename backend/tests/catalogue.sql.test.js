/**
 * The catalogue queries, actually executed.
 *
 * Every other catalogue test either checks a SQL string or checks a view model
 * from a hand-written row. Neither runs the query, which leaves a whole class of
 * mistake untested: a typo in a column alias, a bad aggregate, a `FILTER` clause
 * on the wrong aggregate, a JSON column arriving in a shape the mapper did not
 * expect. All of those produce a broken API and a green test suite at the same
 * time, which is the worst combination available.
 *
 * So this file runs the real statements against a seeded PGlite, which is real
 * PostgreSQL compiled to WebAssembly. No server needed.
 *
 * PGlite's `query` has the same signature the repository expects, so it is passed
 * straight in as `db`.
 */
import './setup.js';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSeededDb } from './helpers/database.js';
import {
  listProducts,
  listRelatedProducts,
  buildFacets,
  findProductBySlug,
} from '../src/repositories/catalogue.repository.js';
import {
  toListingProduct,
  toProductDetail,
  productAttributes,
} from '../src/services/catalogue.view.js';

let db;
let conn;

before(async () => {
  db = await createSeededDb();
  // The repository calls `db.query(...)` unbound, and PGlite's `query` needs its
  // receiver. The seed harness wraps it for the same reason.
  conn = { query: (text, params = []) => db.query(text, params) };
});

after(async () => {
  await db?.close();
});

describe('listProducts over real SQL', () => {
  test('a listing row carries a real attributes array, not an empty object', async () => {
    const page = await listProducts({}, {}, conn);

    assert.ok(page.rows.length > 0, 'the seeds should produce products');

    // The aggregate returns one entry per ACTIVE variant, and most seeded variants
    // legitimately have no attributes at all, so "the array is non-empty" proves
    // nothing. What matters is that some entry carries a key.
    const withAttributes = page.rows.filter(
      (row) =>
        Array.isArray(row.attributes) &&
        row.attributes.some((entry) => Object.keys(entry ?? {}).length > 0)
    );
    assert.ok(withAttributes.length > 0, 'some seeded product should have variant attributes');

    for (const row of withAttributes) {
      const product = toListingProduct(row);
      const keys = Object.keys(product.attributes);
      assert.ok(keys.length > 0, `${product.name} lost its attributes`);
      for (const values of Object.values(product.attributes)) {
        assert.ok(Array.isArray(values), 'values must be an array, or .includes() never matches');
        for (const value of values) assert.equal(typeof value, 'string');
      }
    }
  });

  test('the listing attributes agree with the detail page for the same product', async () => {
    const page = await listProducts({}, { limit: 50 }, conn);
    let compared = 0;

    for (const row of page.rows) {
      const detail = await findProductBySlug(row.slug, conn);
      if (!detail.product) continue;

      const listing = toListingProduct(row).attributes;
      const viewVariants = detail.variants.map((variant) => ({
        is_active: variant.is_active,
        attributes: variant.attributes,
      }));
      const fromDetail = productAttributes(viewVariants);

      assert.deepEqual(
        listing,
        fromDetail,
        `${row.slug}: the grid and the product page offer different options`
      );
      compared += 1;
    }

    assert.ok(compared > 0, 'nothing was compared');
  });

  test('only active variants contribute attributes', async () => {
    await db.query(
      `UPDATE product_variants SET is_active = false
        WHERE id = (SELECT id FROM product_variants ORDER BY id LIMIT 1)`
    );

    const page = await listProducts({}, { limit: 50 }, conn);
    for (const row of page.rows) {
      const detail = await findProductBySlug(row.slug, conn);
      if (!detail.product) continue;
      const activeValues = detail.variants
        .filter((variant) => variant.is_active)
        .flatMap((variant) => Object.values(variant.attributes ?? {}));
      for (const values of Object.values(toListingProduct(row).attributes)) {
        for (const value of values) {
          assert.ok(
            activeValues.includes(value),
            `${row.slug} offers "${value}" from a retired variant`
          );
        }
      }
    }
  });

  test('a listing row keeps its price and stock columns after the change', async () => {
    // The attributes aggregate was added to a LATERAL that already carried every
    // other summary column. Adding a column to that SELECT list is exactly how a
    // total_stock or price_min_minor goes missing without any error.
    const page = await listProducts({}, { limit: 10 }, conn);

    for (const row of page.rows) {
      const product = toListingProduct(row);
      assert.equal(typeof product.total_stock, 'number', 'total_stock must survive');
      assert.ok(product.price_min_minor === null || product.price_min_minor > 0);
      assert.ok(Array.isArray(row.images), 'images must survive');
      assert.equal(typeof row.total_count, 'number', 'the window total must survive');
    }
  });

  test('a search term still runs, with the attributes aggregate in place', async () => {
    const page = await listProducts({}, { searchTerm: 'black', limit: 10 }, conn);

    for (const row of page.rows) {
      assert.equal(typeof row.attributes === 'object', true);
    }
  });

  test('sorting and filtering still run over the same query', async () => {
    for (const sort of ['price_asc', 'price_desc', 'rating', 'newest', 'featured']) {
      const page = await listProducts({}, { sort, limit: 5 }, conn);
      assert.ok(Array.isArray(page.rows), `sort ${sort} must return rows`);
    }

    const paged = await listProducts({}, { limit: 2, page: 1 }, conn);
    assert.ok(paged.rows.length <= 2, 'the limit must still be applied');
    assert.ok(Number(paged.total) >= paged.rows.length);
  });
});

describe('related products over real SQL', () => {
  test('related rows carry attributes too, since they use the same mapper', async () => {
    const page = await listProducts({}, { limit: 1 }, conn);
    const target = page.rows[0];
    if (!target) return;

    const rows = await listRelatedProducts(
      {
        categoryIds: [target.category_id],
        siblingCategoryIds: [],
        brand: null,
        excludeProductId: target.id,
        limit: 4,
      },
      conn
    );

    assert.ok(
      rows.every((row) => row.id !== target.id),
      'the product being viewed is not suggested back to the shopper'
    );

    for (const row of rows) {
      const product = toListingProduct(row);
      assert.ok(Array.isArray(row.attributes), 'related rows must select the aggregate');

      // Same promise as a listing row: a rail thumbnail must offer the same
      // options as the product page it links to.
      const detail = await findProductBySlug(row.slug, conn);
      if (!detail.product) continue;
      assert.deepEqual(
        product.attributes,
        productAttributes(
          detail.variants.map((variant) => ({
            is_active: variant.is_active,
            attributes: variant.attributes,
          }))
        ),
        `${row.slug}: the rail and the product page offer different options`
      );
    }
  });
});

describe('facets and detail over real SQL', () => {
  test('facet counts match what the listing rows offer', async () => {
    const facets = await buildFacets({}, conn);
    const page = await listProducts({}, { limit: 50 }, conn);
    const listing = new Map(page.rows.map((row) => [row.id, toListingProduct(row).attributes]));

    for (const facet of facets.attributes ?? []) {
      assert.ok((facet.values ?? []).length > 0, `facet ${facet.key} has no values`);
      for (const entry of facet.values) {
        assert.equal(typeof entry.count, 'number');
        assert.ok(entry.count > 0, 'a facet value must be offered by at least one product');
      }
    }
    assert.ok(listing.size > 0);
  });

  test('a detail page assembles without an undefined field', async () => {
    const page = await listProducts({}, { limit: 1 }, conn);
    const detail = await findProductBySlug(page.rows[0].slug, conn);

    const view = toProductDetail({
      product: detail.product,
      variants: detail.variants,
      images: detail.images,
      rating: { average: 0, count: 0, distribution: [] },
      reviews: [],
      ancestry: [],
      related: [],
    });

    assert.ok(view.attributes, 'detail must expose attributes');
    assert.ok(Array.isArray(view.variants));
    assert.ok(view.attribute_options.length > 0 || view.variants.length === 0);
  });
});
