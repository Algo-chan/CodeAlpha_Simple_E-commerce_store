/**
 * Category repository — category tree, breadcrumbs and per-category counts.
 *
 * The tree is read once as a flat ordered set and assembled in JavaScript. A
 * recursive query returning a nested shape would be marginally more compact,
 * but the storefront needs the flat list anyway (navigation, breadcrumbs,
 * related-category lookups), and building the hierarchy in one place means the
 * depth, path and descendant helpers can never disagree with each other.
 */
import { query as poolQuery } from '../config/db.js';

/**
 * Every active category with its direct product count.
 *
 * `is_active` is honoured here rather than in the caller: "Bulk Orders" is a
 * real row that the storefront must not link to, so hiding it belongs to the
 * query that feeds navigation.
 *
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object[]>}
 */
export async function listCategories(db = {}) {
  const execute = db.query ?? poolQuery;
  const result = await execute(
    `SELECT
       c.id, c.parent_id, c.name, c.slug, c.description, c.image_url, c.sort_order,
       COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE')::int AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id
     WHERE c.is_active
     GROUP BY c.id, c.parent_id, c.name, c.slug, c.description, c.image_url, c.sort_order
     ORDER BY c.sort_order, c.name`
  );
  return result.rows;
}

/**
 * Loads one category by slug.
 *
 * @param {string} slug
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object|null>}
 */
export async function findCategoryBySlug(slug, db = {}) {
  const execute = db.query ?? poolQuery;
  const result = await execute(
    `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.image_url, c.sort_order
       FROM categories c
      WHERE c.slug = $1 AND c.is_active`,
    [slug]
  );
  return result.rows[0] ?? null;
}

/**
 * Expands a category to itself plus every descendant, at any depth.
 *
 * `/category/electronics` must show the phones, laptops, accessories and
 * smartphones filed underneath it, not an empty page because those products sit
 * on the leaf rows. Recursive because the tree is three levels deep in the seed
 * and has no fixed maximum.
 *
 * Returns an empty array for an unknown slug, which is how the service tells
 * "no category filter" (null) from "a category that matched nothing" ([]).
 *
 * @param {string} slug
 * @param {{ query?: Function }} [db]
 * @returns {Promise<string[]>} category ids
 */
export async function listCategoryIds(slug, db = {}) {
  const execute = db.query ?? poolQuery;
  const result = await execute(
    `WITH RECURSIVE category_tree AS (
       SELECT id FROM categories WHERE slug = $1
       UNION ALL
       SELECT c.id FROM categories c JOIN category_tree t ON c.parent_id = t.id
     )
     SELECT id FROM category_tree`,
    [slug]
  );
  return result.rows.map((row) => String(row.id));
}

/**
 * Categories that share a parent with the given slug.
 *
 * The second tier of related-product ranking: a shopper looking at a phone should
 * see another phone before they see kitchenware, but a leaf category holding a
 * single product has no same-category siblings, and without this tier its related
 * rail would be empty.
 *
 * The category itself is excluded, so the result is strictly "siblings". An
 * unknown slug yields an empty list, which the caller reads as "no siblings" and
 * widens to the whole catalogue.
 *
 * @param {string} slug
 * @param {{ query?: Function }} [db]
 * @returns {Promise<string[]>} category ids
 */
export async function listSiblingCategoryIds(slug, db = {}) {
  const execute = db.query ?? poolQuery;
  const result = await execute(
    `SELECT c.id
       FROM categories c
       JOIN categories self ON self.parent_id = c.parent_id
      WHERE self.slug = $1
        AND c.id <> self.id
        AND c.is_active
      ORDER BY c.sort_order, c.name`,
    [slug]
  );
  return result.rows.map((row) => String(row.id));
}

/**
 * Categories that hold products, used to build related-category suggestions.
 *
 * @param {string[]} excludeIds
 * @param {{ query?: Function }} [db]
 * @returns {Promise<object[]>}
 */
export async function listSiblings(excludeIds, db = {}) {
  const execute = db.query ?? poolQuery;
  if (excludeIds.length === 0) return [];

  const result = await execute(
    `SELECT
       c.id, c.name, c.slug, c.description, c.image_url,
       COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE')::int AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id
     WHERE c.is_active AND NOT (c.id = ANY($1::uuid[]))
     GROUP BY c.id, c.name, c.slug, c.description, c.image_url
     HAVING COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE') > 0
     ORDER BY c.sort_order, c.name
     LIMIT 6`,
    [excludeIds]
  );
  return result.rows;
}

/**
 * Builds the nested tree the navigation and category grid render.
 *
 * Nodes gain `depth`, `path` (root-to-node slugs) and `product_count` including
 * descendants, which is what lets the homepage show "Electronics — 5 products"
 * without a query per node.
 *
 * @param {object[]} rows flat rows from `listCategories`
 * @returns {object[]}
 */
export function buildCategoryTree(rows) {
  const nodes = new Map(
    rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        parent_id: row.parent_id === null ? null : String(row.parent_id),
        name: row.name,
        slug: row.slug,
        description: row.description ?? null,
        image_url: row.image_url ?? null,
        sort_order: Number(row.sort_order ?? 0),
        direct_product_count: Number(row.product_count ?? 0),
        product_count: 0,
        depth: 0,
        path: [row.slug],
        children: [],
      },
    ])
  );

  const roots = [];

  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null;

    // An orphan (its parent is missing or inactive) is surfaced as a root rather
    // than dropped: hiding it would silently remove a category from the storefront.
    if (!parent) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const bySort = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
  const sortRecursively = (list) => {
    list.sort(bySort);
    for (const node of list) sortRecursively(node.children);
  };
  sortRecursively(roots);

  /**
   * Depth, path and inclusive counts in one pass.
   *
   * `visited` guards against a cycle. Migration 019 prevents cycles in the
   * database, but a tree walk that can hang on malformed data is a denial of
   * service waiting for a bad write, so the guard stays.
   */
  const annotate = (node, depth, path, visited) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);

    node.depth = depth;
    node.path = [...path, node.slug];

    const descendantCount = node.children.reduce((total, child) => {
      annotate(child, depth + 1, node.path, visited);
      return total + child.product_count;
    }, 0);

    node.product_count = node.direct_product_count + descendantCount;
  };

  const visited = new Set();
  for (const root of roots) annotate(root, 0, [], visited);

  return roots;
}

/**
 * Ancestor chain for a category, root first, excluding the category itself.
 *
 * Used for breadcrumbs, which must read Home / Electronics / Phones / Product.
 *
 * @param {object[]} flatRows
 * @param {string} categoryId
 * @returns {object[]}
 */
export function buildAncestry(flatRows, categoryId) {
  const byId = new Map(flatRows.map((row) => [String(row.id), row]));
  const chain = [];
  const seen = new Set();

  let current = byId.get(String(categoryId));
  while (current) {
    if (seen.has(String(current.id))) break; // cycle guard
    seen.add(String(current.id));
    chain.unshift(current);
    current = current.parent_id ? byId.get(String(current.parent_id)) : null;
  }

  return chain;
}

export default {
  listCategories,
  findCategoryBySlug,
  listCategoryIds,
  listSiblingCategoryIds,
  listSiblings,
  buildCategoryTree,
  buildAncestry,
};
