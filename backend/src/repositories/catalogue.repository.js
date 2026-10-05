/**
 * Catalogue repository — the only place allowed to run catalogue SQL.
 *
 * DESIGN RULES ENFORCED HERE
 *
 * 1. Every value reaches PostgreSQL as a bound parameter. No identifier, sort
 *    key, operator or fragment is ever built from request input. Even the sort
 *    clause comes from a fixed lookup table, because `ORDER BY $1` cannot be
 *    parameterized and a whitelist is the only safe alternative.
 *
 * 2. No N+1. A listing is ONE query no matter how many products it returns:
 *    price, availability, rating and the hover-swap images all come from
 *    LATERAL aggregates correlated on the product id, which PostgreSQL executes
 *    as an index-driven join rather than as a round trip per row.
 *
 * 3. A listing does not read descriptions, full variant matrices or reviews.
 *    Only columns a card can render are selected, so the working set stays
 *    small even at the maximum page size.
 *
 * 4. The executor is injected. Production passes the `pg` pool; the tests pass
 *    an in-process PGlite instance, so `npm test` really executes these queries
 *    on a machine with no PostgreSQL server.
 */
import { query as poolQuery } from '../config/db.js';

/* -------------------------------------------------------------------------- */
/* Sort whitelist                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The ONLY ordering clauses this repository will ever emit. Each references the
 * aliased columns of the inner query in `listProducts`.
 *
 * `featured` needs an explanation. `products` has no merchandising column — no
 * `is_featured`, no `featured_rank`, no view counter — so nothing in the data
 * can honestly express "the shopkeeper chose these". Rather than invent a
 * ranking, `featured` resolves to a deterministic, documented order: most
 * recently added first, name as a stable tiebreaker. It is a placeholder for a
 * merchandising decision, NOT a claim about popularity, and explicitly NOT
 * "best selling" — no sales figures exist, and implying otherwise would be
 * inventing analytics.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SORT_CLAUSES = Object.freeze({
  featured: 't.created_at DESC, t.name ASC, t.id ASC',
  newest: 't.created_at DESC, t.name ASC, t.id ASC',
  'price-asc': 't.price_min_minor ASC NULLS LAST, t.name ASC, t.id ASC',
  'price-desc': 't.price_max_minor DESC NULLS LAST, t.name ASC, t.id ASC',
  'name-asc': 't.name ASC, t.id ASC',
  'name-desc': 't.name DESC, t.id ASC',
});

/** Every legal `?sort=` value. Anything else is rejected by validation. */
export const SORT_KEYS = Object.freeze(Object.keys(SORT_CLAUSES));

/** Sorts offered inside a category listing, where price ordering is meaningful. */
export const CATEGORY_SORTS = Object.freeze([
  'featured',
  'newest',
  'price-asc',
  'price-desc',
  'name-asc',
  'name-desc',
]);

/** Page-size bounds for the storefront. */
export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 60;

/**
 * Images a listing row carries: the primary frame plus one hover swap. A card
 * never shows the whole gallery, and fetching ten URLs per row would let images
 * dominate the page weight.
 */
export const CARD_IMAGE_COUNT = 2;

/* -------------------------------------------------------------------------- */
/* SQL fragments                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A variant is purchasable when it is active AND either untracked or in stock.
 *
 * A missing `inventory` row is not "no data" — it is how the schema models a
 * DIGITAL product, which needs no stock record. Treating it as sold out is what
 * would make every download look unavailable.
 *
 * Availability is `quantity - reserved_quantity`: reserved units are promised to
 * orders that have not shipped, so counting them would oversell.
 */
const PURCHASABLE = `
  v.is_active
  AND (i.variant_id IS NULL OR (i.quantity - i.reserved_quantity) > 0)
`;

/**
 * Escapes a user-supplied search term for use as an ILIKE pattern.
 *
 * A shopper searching for `50%` or `c_` must not turn into a wildcard that
 * matches everything, and `_` must not swallow a character.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

/* -------------------------------------------------------------------------- */
/* Parameter builder                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Append-only parameter list that hands back the correct placeholder.
 *
 * Written as an explicit builder rather than counting `params.length - 2`
 * inline: arithmetic on positional placeholders is exactly the kind of thing
 * that is correct until one clause is added, and then silently filters by the
 * wrong column.
 */
export class ParamList {
  /** @param {unknown[]} [initial] values bound before this list takes over */
  constructor(initial = []) {
    this.values = [...initial];
  }

  /** Binds a value and returns its `$n` placeholder. */
  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Filter compilation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Compiles validated filters into a parameterized WHERE clause.
 *
 * `skip` omits one dimension. That is how facet counts are produced: the brands
 * facet is counted with every OTHER filter applied but not the brand filter
 * itself, so a shopper who ticks "Nike" can still see that another brand would
 * return 4 results, instead of watching every other brand collapse to zero.
 *
 * @param {object} filters validated, already-coerced filters
 * @param {{ skip?: string }} [options]
 * @returns {{ clause: string, params: ParamList }}
 */
export function compileProductFilters(filters, { skip } = {}) {
  const params = new ParamList();
  const clauses = [];

  // The status literal is a constant rather than input, but it is still bound so
  // that every value in the statement provably comes from the parameter list.
  // A DRAFT or ARCHIVED product must never be listable, regardless of filters.
  clauses.push(`p.status = ${params.add('ACTIVE')}`);

  // Category scope. The guard tests for PRESENCE, not truthiness, and that
  // distinction decides what a broken category link does:
  //
  //   undefined  no category filter      -> clause omitted, whole catalogue
  //   []         a filter matched nothing -> `= ANY('{}')` is false for every row
  //
  // Testing `.length` instead would drop the clause for the empty array and answer
  // `?category=deleted-category` with the entire catalogue — a silent, confident,
  // completely wrong answer, and the hardest kind to notice in review.
  if (Array.isArray(filters.categoryIds) && skip !== 'category') {
    clauses.push(`p.category_id = ANY(${params.add(filters.categoryIds)}::uuid[])`);
  }

  if (filters.brands?.length && skip !== 'brand') {
    clauses.push(`p.brand = ANY(${params.add(filters.brands)}::text[])`);
  }

  if (filters.productTypes?.length && skip !== 'productType') {
    clauses.push(`p.product_type = ANY(${params.add(filters.productTypes)}::text[])`);
  }

  // Price belongs to a VARIANT, so a price filter becomes an EXISTS: "products
  // where some variant is priced in this range". Comparing a product-level
  // minimum would wrongly drop a product whose cheaper variant sits below the
  // floor while its other variants do not.
  if (skip !== 'price') {
    const priceClauses = [];
    if (filters.minPrice !== null && filters.minPrice !== undefined) {
      priceClauses.push(`v.price >= ${params.add(filters.minPrice)}`);
    }
    if (filters.maxPrice !== null && filters.maxPrice !== undefined) {
      priceClauses.push(`v.price <= ${params.add(filters.maxPrice)}`);
    }
    if (priceClauses.length > 0) {
      clauses.push(`EXISTS (
        SELECT 1 FROM product_variants v
         WHERE v.product_id = p.id AND ${priceClauses.join(' AND ')}
      )`);
    }
  }

  // Availability is derived from variants and inventory, never stored on the
  // product. "In stock" means something can be bought right now.
  if (skip !== 'availability' && filters.availability === 'in_stock') {
    clauses.push(`EXISTS (
      SELECT 1 FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE v.product_id = p.id AND ${PURCHASABLE}
    )`);
  } else if (skip !== 'availability' && filters.availability === 'out_of_stock') {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE v.product_id = p.id AND ${PURCHASABLE}
    )`);
  }

  // Dynamic JSONB attributes: `attributes @> '{"color":"Black"}'`. Containment is
  // supported by the GIN index created in migration 007, so this does not scan.
  // Nothing here knows that "size" or "color" exist; a phone filters on storage
  // and RAM through exactly the same code path.
  //
  // OR SEMANTICS, EMITTED ONE VALUE AT A TIME. `?attr.color=Black&attr.color=Blue`
  // means "black OR blue", so the values are OR'd. They cannot be folded into a
  // single `@> '{"color":["Black","Blue"]}'`: containment would then demand a
  // variant whose `color` array contains both, which no variant ever is, and the
  // filter would silently return nothing. One EXISTS per value is also what lets
  // the GIN index serve each test independently.
  if (skip !== 'attributes') {
    for (const [key, values] of Object.entries(filters.attributes ?? {})) {
      if (!Array.isArray(values) || values.length === 0) continue;

      const alternatives = values.map(
        (value) =>
          `EXISTS (
             SELECT 1 FROM product_variants v
              WHERE v.product_id = p.id AND v.is_active
                AND v.attributes @> ${params.add(JSON.stringify({ [key]: value }))}::jsonb
           )`
      );

      if (alternatives.length > 0) clauses.push(`(${alternatives.join(' OR ')})`);
    }
  }

  return { clause: clauses.join(' AND '), params };
}

/**
 * Appends the free-text search predicate and its rank expression.
 *
 * Position and field weight, not a search engine: exact name, then name prefix,
 * then slug prefix, then SKU prefix, then a name mention, then a brand mention.
 * Every word must match something, which is what stops "max black" from
 * returning every black product on the strength of "max".
 *
 * Kept as its own function so replacing it with `ts_rank`, a trigram index or a
 * typo-tolerant scorer later is a change to one place.
 *
 * @param {ParamList} params
 * @param {string} term already-trimmed search term
 * @returns {{ predicate: string, rank: string }}
 */
export function compileSearch(params, term) {
  // Self-guarding on an empty term. The caller already checks, but a rank built
  // from placeholders that were never bound produces "could not determine data
  // type of parameter $1" from deep inside the driver — an error that points at
  // the query rather than at the mistake. Cheaper to make the wrong call a no-op.
  if (!term || term.trim().length === 0) return { predicate: '', rank: '' };

  // One escaped pattern bound per word and reused across every field that should
  // match it, so a word costs ONE bound value rather than one per column.
  // A prefix match is a subset of an infix match, so only the infix pattern is
  // needed per field — no separate prefix branch.
  //
  // Only values that are actually referenced get bound. An allocated-but-unused
  // placeholder is not a harmless no-op: PostgreSQL cannot infer the type of an
  // unreferenced parameter and rejects the whole statement with
  // "could not determine data type of parameter $n".
  //
  // `\\` in this template literal is one backslash in the emitted SQL, which is
  // what makes `ESCAPE '\'` a valid single-character escape.
  const bindWord = (word) => params.add(`%${escapeLikePattern(word)}%`);

  const safeTerm = escapeLikePattern(term);
  const rankTerm = params.add(term);
  const rankPrefix = params.add(`${safeTerm}%`);
  const rankInfix = params.add(`%${safeTerm}%`);

  // Field weight, not a search engine: exact name, then name prefix, then slug
  // prefix, then SKU prefix, then a name mention, then a brand mention. ILIKE
  // plus an explicit ESCAPE keeps the escaped patterns honest — without ESCAPE
  // the backslash would itself become a literal character to match.
  const rank = `
    CASE
      WHEN LOWER(p.name) = LOWER(${rankTerm})        THEN 0
      WHEN p.name ILIKE ${rankPrefix} ESCAPE '\\'    THEN 1
      WHEN p.slug ILIKE ${rankPrefix} ESCAPE '\\'    THEN 2
      WHEN EXISTS (
        SELECT 1 FROM product_variants sv
         WHERE sv.product_id = p.id AND sv.sku ILIKE ${rankPrefix} ESCAPE '\\'
      )                                            THEN 3
      WHEN p.name ILIKE ${rankInfix} ESCAPE '\\'     THEN 4
      WHEN p.brand ILIKE ${rankInfix} ESCAPE '\\'    THEN 5
      -- Attribute matches rank last: they are the weakest signal, since any
      -- product sharing "Black" matches, which is exactly why the attribute
      -- predicate above requires EVERY word to hit somewhere.
      WHEN EXISTS (
        SELECT 1
          FROM product_variants av
          CROSS JOIN LATERAL jsonb_each_text(av.attributes) AS akv(key, value)
         WHERE av.product_id = p.id AND akv.value ILIKE ${rankInfix} ESCAPE '\\'
      )                                            THEN 6
      ELSE 7
    END
  `;

  // Every word must appear somewhere. Requiring all of them is what stops
  // "max black" from returning every black product on the strength of "max".
  //
  // VARIANT ATTRIBUTES ARE SEARCHED, because they are where the shopper's own
  // vocabulary lives. "black" and "256gb" are real attribute values in the seed
  // data, and a search box that cannot find them while the filter panel can select
  // them is incoherent: the shopper sees the option, types it, and gets nothing.
  // The cast to text keeps the match uniform across value types, since JSONB
  // values are not necessarily strings.
  const wordClauses = term
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const infix = bindWord(word);
      return `(
        p.name ILIKE ${infix} ESCAPE '\\'
        OR p.slug ILIKE ${infix} ESCAPE '\\'
        OR p.brand ILIKE ${infix} ESCAPE '\\'
        OR p.description ILIKE ${infix} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM product_variants sv
           WHERE sv.product_id = p.id
             AND (sv.sku ILIKE ${infix} ESCAPE '\\'
                  OR EXISTS (
                    SELECT 1
                      FROM jsonb_each_text(sv.attributes) AS kv(key, value)
                     WHERE kv.value ILIKE ${infix} ESCAPE '\\'
                  ))
        )
        OR EXISTS (
          SELECT 1 FROM categories sc
           WHERE sc.id = p.category_id AND sc.name ILIKE ${infix} ESCAPE '\\'
        )
      )`;
    });

  return { predicate: wordClauses.join(' AND '), rank };
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lists products with filters, sorting and server-side pagination.
 *
 * Two-level statement: the inner query applies filters and computes aggregates
 * (including `count(*) OVER ()` for the unpaginated total), and the outer query
 * orders and limits. Sorting therefore refers to a computed `price_min_minor`,
 * which is only expressible once the inner row exists.
 *
 * @param {object} filters validated filters
 * @param {{ page?: number, limit?: number, sort?: string, searchTerm?: string }} [options]
 * @param {{ query?: Function }} [db] injectable executor
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listProducts(filters, options = {}, db = {}) {
  const execute = db.query ?? poolQuery;
  const searchTerm = options.searchTerm?.trim() ?? '';

  const { clause, params } = compileProductFilters(filters);

  let predicate = clause;
  let rankColumn = '';

  if (searchTerm) {
    const search = compileSearch(params, searchTerm);
    predicate = `${clause} AND (${search.predicate})`;
    rankColumn = `, ${search.rank} AS search_rank`;
  }

  // Enough images for the primary frame and the hover swap, and no more: a card
  // never shows the whole gallery and loading ten URLs per row would dominate
  // the page weight.
  const galleryLimit = params.add(CARD_IMAGE_COUNT);

  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(Number(options.page) || 1, 1);
  const limitParam = params.add(limit);
  const offsetParam = params.add((page - 1) * limit);

  const sortClause = SORT_CLAUSES[options.sort] ?? SORT_CLAUSES.featured;
  const orderBy = rankColumn ? `t.search_rank ASC, ${sortClause}` : sortClause;

  const sql = `
    SELECT *
      FROM (
        SELECT
          p.id,
          p.slug,
          p.name,
          p.brand,
          p.product_type,
          p.created_at,
          p.category_id,
          c.slug AS category_slug,
          c.name AS category_name,
          -- The price a shopper can actually pay today wins; a sold-out product
          -- still quotes its real price rather than going blank.
          COALESCE(agg.buyable_min, agg.active_min) AS price_min_minor,
          COALESCE(agg.buyable_max, agg.active_max) AS price_max_minor,
          COALESCE(agg.buyable_compare_at, agg.active_compare_at) AS compare_at_minor,
          agg.variant_count,
          agg.purchasable_count,
          COALESCE(agg.total_stock, 0) AS total_stock,
          COALESCE(rat.rating_average, 0) AS rating_average,
          COALESCE(rat.rating_count, 0) AS rating_count,
          agg.attributes,
          im.images,
          -- Unpaginated total, computed before LIMIT/OFFSET by the same window
          -- pass that produces the rows. Without it the view would have to guess
          -- "more pages may exist" from a short page, and page 7 of 6 would
          -- render as an empty-but-plausible result.
          count(*) OVER ()::int AS total_count
          ${rankColumn}
        FROM products p
        JOIN categories c ON c.id = p.category_id
        LEFT JOIN LATERAL (
          SELECT
            count(*) FILTER (WHERE v.is_active) AS variant_count,
            min(v.price) FILTER (WHERE v.is_active) AS active_min,
            max(v.price) FILTER (WHERE v.is_active) AS active_max,
            max(v.compare_at_price) FILTER (
              WHERE v.is_active AND v.compare_at_price IS NOT NULL
            ) AS active_compare_at,
            min(v.price) FILTER (WHERE ${PURCHASABLE}) AS buyable_min,
            max(v.price) FILTER (WHERE ${PURCHASABLE}) AS buyable_max,
            max(v.compare_at_price) FILTER (
              WHERE ${PURCHASABLE} AND v.compare_at_price IS NOT NULL
            ) AS buyable_compare_at,
            count(*) FILTER (WHERE ${PURCHASABLE}) AS purchasable_count,
            COALESCE(
              sum(GREATEST(COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0), 0))
                FILTER (WHERE v.is_active),
              0
            ) AS total_stock,
            -- The raw attribute MAP of every active variant, not the finished
            -- union. The view model turns it into one key -> sorted values map
            -- using productAttributes, the same function the detail page uses,
            -- so a listing and a detail page cannot disagree about which options
            -- a product offers. Doing the grouping in SQL would need a second
            -- nested aggregate here and would then have to be kept in step with
            -- the JavaScript copy by hand.
            COALESCE(
              json_agg(v.attributes) FILTER (WHERE v.is_active),
              '[]'::json
            ) AS attributes
          FROM product_variants v
          LEFT JOIN inventory i ON i.variant_id = v.id
          WHERE v.product_id = p.id
        ) agg ON TRUE
        LEFT JOIN LATERAL (
          SELECT round(avg(r.rating)::numeric, 1) AS rating_average,
                 count(*)::int AS rating_count
            FROM reviews r
           WHERE r.product_id = p.id AND r.status = 'APPROVED'
        ) rat ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            json_agg(json_build_object(
              'url', img.image_url,
              'alt', img.alt_text,
              'is_primary', img.is_primary
            ) ORDER BY img.rn),
            '[]'::json
          ) AS images
          FROM (
            SELECT pi.image_url, pi.alt_text, pi.is_primary,
                   ROW_NUMBER() OVER (
                     ORDER BY pi.is_primary DESC, pi.sort_order, pi.id
                   ) AS rn
              FROM product_images pi
             WHERE pi.product_id = p.id
          ) img
          WHERE img.rn <= ${galleryLimit}
        ) im ON TRUE
        WHERE ${predicate}
      ) t
      ORDER BY ${orderBy}
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
  `;

  const result = await execute(sql, params.values);
  const rows = result.rows;

  // A page past the end returns no rows, so there is no window to read the
  // total from. Reporting 0 there would tell the shopper a populated category
  // is empty. Counting is cheap next to a wrong page count, and this path only
  // happens on a mistyped or stale page number.
  if (rows.length === 0 && (page - 1) * limit > 0) {
    return { rows, total: await countProducts(filters, db) };
  }

  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

/* -------------------------------------------------------------------------- */
/* Product detail                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Loads one product for the detail page.
 *
 * Three queries regardless of how many variants, images or reviews it has. A
 * detail page is allowed to be rich; it is simply not allowed to be N+1.
 *
 * @param {string} slug
 * @param {{ query?: Function }} [db]
 * @returns {Promise<{ product: object|null, variants: object[], images: object[] }>}
 */
export async function findProductBySlug(slug, db = {}) {
  const execute = db.query ?? poolQuery;

  const productResult = await execute(
    `SELECT
       p.id, p.slug, p.name, p.brand, p.product_type, p.description, p.created_at,
       p.category_id,
       c.slug AS category_slug, c.name AS category_name, c.description AS category_description
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.slug = $1 AND p.status = 'ACTIVE'`,
    [slug]
  );

  const product = productResult.rows[0];
  if (!product) return { product: null, variants: [], images: [] };

  const idParam = [product.id];

  const variantsResult = await execute(
    `SELECT
       v.id, v.sku, v.price, v.compare_at_price, v.attributes, v.is_active,
       i.quantity,
       i.reserved_quantity,
       COALESCE(i.quantity - i.reserved_quantity, NULL) AS available
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE v.product_id = $1
     ORDER BY
       v.is_active DESC,
       v.price ASC NULLS LAST,
       v.attributes::text ASC,
       v.id ASC`,
    idParam
  );

  const imagesResult = await execute(
    `SELECT id, image_url, alt_text, sort_order, is_primary
       FROM product_images
      WHERE product_id = $1
      ORDER BY is_primary DESC, sort_order, id`,
    idParam
  );

  return {
    product,
    variants: variantsResult.rows,
    images: imagesResult.rows,
  };
}

/**
 * Related products for a detail page.
 *
 * Scored in tiers, because a shopper who opened a phone is far better served by
 * another phone than by a t-shirt. The tiers, in preference order:
 *
 *   0  same category
 *   1  sibling category (shares a parent)
 *   2  anywhere else in the catalogue
 *
 * Same-brand products are lifted within their tier. That is a proxy for "more like
 * this", and it is only ever applied AFTER the category tier, so it can never push
 * a different-category product above a direct sibling.
 *
 * FALLBACK TO THE WHOLE CATALOGUE IS DELIBERATE. A leaf category holding one
 * product has no siblings to suggest, and returning an empty rail there is worse
 * than returning something merely related. The tiers exist precisely so that the
 * wider results are used only when the narrower ones are exhausted.
 *
 * Not reusing `listProducts`: it pages, sorts and counts, none of which apply, so
 * borrowing it would mean either scanning the catalogue to pick four rows or
 * adding options whose combinations are all wrong. The aggregate columns are
 * duplicated instead, which is the cheaper kind of duplication — identical column
 * lists in two queries are visible to a reader, whereas a shared builder with a
 * dozen optional branches is not.
 *
 * @param {object} options
 * @param {string[]} options.categoryIds     the product's own category subtree
 * @param {string}   options.siblingCategoryIds categories sharing its parent
 * @param {string}   options.brand           the product's brand, when it has one
 * @param {string}   options.excludeProductId never returned
 * @param {number}   [options.limit]
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object[]>}
 */
export async function listRelatedProducts(
  { categoryIds, siblingCategoryIds = [], brand = null, excludeProductId, limit = 4 },
  db = {}
) {
  const execute = db.query ?? poolQuery;

  if (!Array.isArray(categoryIds) || categoryIds.length === 0) return [];
  if (!Array.isArray(siblingCategoryIds)) siblingCategoryIds = [];
  if (!excludeProductId) return [];

  const cap = Math.min(Math.max(Number(limit) || 4, 1), 12);

  const result = await execute(
    `SELECT
       p.id, p.slug, p.name, p.brand, p.product_type, p.created_at, p.category_id,
       c.slug AS category_slug, c.name AS category_name,
       COALESCE(agg.buyable_min, agg.active_min) AS price_min_minor,
       COALESCE(agg.buyable_max, agg.active_max) AS price_max_minor,
       COALESCE(agg.buyable_compare_at, agg.active_compare_at) AS compare_at_minor,
       agg.variant_count, agg.purchasable_count,
COALESCE(agg.total_stock, 0) AS total_stock,
        COALESCE(rat.rating_average, 0) AS rating_average,
        COALESCE(rat.rating_count, 0) AS rating_count,
        -- See the note on the same column in listProducts.
        agg.attributes,
        im.images
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE v.is_active) AS variant_count,
          min(v.price) FILTER (WHERE v.is_active) AS active_min,
          max(v.price) FILTER (WHERE v.is_active) AS active_max,
          max(v.compare_at_price) FILTER (
            WHERE v.is_active AND v.compare_at_price IS NOT NULL
          ) AS active_compare_at,
          min(v.price) FILTER (WHERE ${PURCHASABLE}) AS buyable_min,
          max(v.price) FILTER (WHERE ${PURCHASABLE}) AS buyable_max,
          max(v.compare_at_price) FILTER (
            WHERE ${PURCHASABLE} AND v.compare_at_price IS NOT NULL
          ) AS buyable_compare_at,
          count(*) FILTER (WHERE ${PURCHASABLE}) AS purchasable_count,
          COALESCE(
            sum(GREATEST(COALESCE(i.quantity, 0) - COALESCE(i.reserved_quantity, 0), 0))
              FILTER (WHERE v.is_active),
            0
          ) AS total_stock,
          COALESCE(
            json_agg(v.attributes) FILTER (WHERE v.is_active),
            '[]'::json
          ) AS attributes
        FROM product_variants v
        LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.product_id = p.id
      ) agg ON TRUE
     LEFT JOIN LATERAL (
       SELECT round(avg(r.rating)::numeric, 1) AS rating_average,
              count(*)::int AS rating_count
         FROM reviews r
        WHERE r.product_id = p.id AND r.status = 'APPROVED'
     ) rat ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         json_agg(json_build_object(
           'url', img.image_url, 'alt', img.alt_text, 'is_primary', img.is_primary
         ) ORDER BY img.rn),
         '[]'::json
       ) AS images
         FROM (
           SELECT pi.image_url, pi.alt_text, pi.is_primary,
                  ROW_NUMBER() OVER (
                    ORDER BY pi.is_primary DESC, pi.sort_order, pi.id
                  ) AS rn
             FROM product_images pi
            WHERE pi.product_id = p.id
         ) img
        WHERE img.rn <= 2
     ) im ON TRUE
     WHERE p.status = 'ACTIVE'
       AND p.id <> $2
     ORDER BY
       CASE
         WHEN p.category_id = ANY($1::uuid[])  THEN 0
         WHEN p.category_id = ANY($3::uuid[])  THEN 1
         ELSE 2
       END,
       -- Only within a tier. $4 is a parameter, so a NULL brand simply never
       -- matches and every product in the tier falls back to recency.
       CASE WHEN p.brand = $4 THEN 0 ELSE 1 END,
       p.created_at DESC,
       p.id
     LIMIT $5`,
    [categoryIds, excludeProductId, siblingCategoryIds, brand ?? null, cap]
  );

  return result.rows;
}

/**
 * Counts matching products without fetching any rows.
 *
 * Used by the category header, which needs "124 products" for a category that is
 * not the one being paged.
 *
 * @param {object} filters
 * @param {{ query?: Function }} [db]
 * @returns {Promise<number>}
 */
export async function countProducts(filters, db = {}) {
  const execute = db.query ?? poolQuery;
  const { clause, params } = compileProductFilters(filters);

  const result = await execute(
    `SELECT count(*)::int AS total FROM products p WHERE ${clause}`,
    params.values
  );
  return Number(result.rows[0]?.total ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Facets                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Builds the filter panel for a listing.
 *
 * Each dimension is counted with the others applied but itself omitted, which
 * is what makes a facet panel usable: options that would return zero results
 * still show their real counts, so a shopper can see what switching would give
 * them instead of a panel full of dead checkboxes.
 *
 * @param {object} filters validated filters
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object>}
 */
export async function buildFacets(filters, db = {}) {
  const execute = db.query ?? poolQuery;

  /* Brands -------------------------------------------------------------- */
  const brandFilter = compileProductFilters(filters, { skip: 'brand' });
  const brandResult = await execute(
    `SELECT p.brand, count(*)::int AS count
       FROM products p
      WHERE ${brandFilter.clause} AND p.brand IS NOT NULL
      GROUP BY p.brand
      ORDER BY p.brand ASC`,
    brandFilter.params.values
  );

  /* Dynamic attribute facets -------------------------------------------- */
  const attributeFilter = compileProductFilters(filters, { skip: 'attributes' });
  const attributeResult = await execute(
    `SELECT kv.key, kv.value, count(DISTINCT p.id)::int AS count
       FROM products p
       JOIN product_variants av ON av.product_id = p.id AND av.is_active
       CROSS JOIN LATERAL jsonb_each(av.attributes) AS kv(key, value)
      WHERE ${attributeFilter.clause}
      GROUP BY kv.key, kv.value
      ORDER BY kv.key ASC, kv.value ASC`,
    attributeFilter.params.values
  );

  /* Product types -------------------------------------------------------- */
  const typeFilter = compileProductFilters(filters, { skip: 'productType' });
  const typeResult = await execute(
    `SELECT p.product_type, count(*)::int AS count
       FROM products p
      WHERE ${typeFilter.clause}
      GROUP BY p.product_type
      ORDER BY p.product_type ASC`,
    typeFilter.params.values
  );

  /* Price bounds --------------------------------------------------------- */
  // Deliberately unfiltered by price: a panel whose slider cannot show the
  // range the shopper is currently looking at is a trap.
  const boundsResult = await execute(
    `SELECT COALESCE(min(v.price), 0)::bigint AS min_price,
            COALESCE(max(v.price), 0)::bigint AS max_price
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE p.status = 'ACTIVE' AND v.is_active`
  );

  /* Availability --------------------------------------------------------- */
  const availabilityFilter = compileProductFilters(filters, { skip: 'availability' });
  const availabilityResult = await execute(
    `SELECT
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM product_variants v
           LEFT JOIN inventory i ON i.variant_id = v.id
          WHERE v.product_id = p.id AND ${PURCHASABLE}
       ))::int AS in_stock,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM product_variants v
           LEFT JOIN inventory i ON i.variant_id = v.id
          WHERE v.product_id = p.id AND ${PURCHASABLE}
       ))::int AS out_of_stock
     FROM products p
     WHERE ${availabilityFilter.clause}`,
    availabilityFilter.params.values
  );

  /** attribute values grouped by key, in a shape the filter panel can render */
  const attributes = {};
  for (const row of attributeResult.rows) {
    const key = String(row.key);
    (attributes[key] ??= []).push({ value: String(row.value), count: Number(row.count) });
  }

  const bounds = boundsResult.rows[0] ?? {};
  const availability = availabilityResult.rows[0] ?? {};

  return {
    brands: brandResult.rows.map((row) => ({ value: row.brand, count: Number(row.count) })),
    attributes: Object.entries(attributes).map(([key, values]) => ({ key, values })),
    productTypes: typeResult.rows.map((row) => ({
      value: row.product_type,
      count: Number(row.count),
    })),
    price: {
      min_minor: Number(bounds.min_price ?? 0),
      max_minor: Number(bounds.max_price ?? 0),
    },
    availability: {
      in_stock: Number(availability.in_stock ?? 0),
      out_of_stock: Number(availability.out_of_stock ?? 0),
    },
  };
}

export default {
  listProducts,
  findProductBySlug,
  listRelatedProducts,
  countProducts,
  buildFacets,
  compileProductFilters,
  compileSearch,
  escapeLikePattern,
  SORT_CLAUSES,
  SORT_KEYS,
  CATEGORY_SORTS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  CARD_IMAGE_COUNT,
};
