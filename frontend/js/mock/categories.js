/**
 * Mock categories.
 *
 * These mirror `backend/seeds/03_categories.seed.js` id for id. Keeping the
 * UUIDs identical means that when the API replaces this module, no consumer has
 * to change - only the loader in `mock/api.js`.
 *
 * The tree shape here matches what the API returns: categories arrive flat with
 * a `parent_id`, and `buildTree` assembles them. Storing them flat keeps the
 * ordering rules (sort_order, then name) in one obvious place.
 */

/** @type {Array<object>} */
const CATEGORIES = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    parent_id: null,
    name: 'Electronics',
    slug: 'electronics',
    description: 'Phones, laptops and everything that plugs in.',
    sort_order: 1,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    parent_id: null,
    name: 'Fashion',
    slug: 'fashion',
    description: 'Clothing and footwear for every season.',
    sort_order: 2,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    parent_id: null,
    name: 'Home & Living',
    slug: 'home-and-living',
    description: 'Everyday items for the house.',
    sort_order: 3,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    parent_id: null,
    name: 'Digital Downloads',
    slug: 'digital-downloads',
    description: 'Ebooks, design assets and software, delivered instantly.',
    sort_order: 4,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    parent_id: '30000000-0000-4000-8000-000000000001',
    name: 'Phones',
    slug: 'phones',
    description: 'Smartphones and feature phones.',
    sort_order: 1,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000006',
    parent_id: '30000000-0000-4000-8000-000000000001',
    name: 'Laptops',
    slug: 'laptops',
    description: 'Notebooks for work, study and creative work.',
    sort_order: 2,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000007',
    parent_id: '30000000-0000-4000-8000-000000000001',
    name: 'Accessories',
    slug: 'accessories',
    description: 'Cables, headphones and chargers.',
    sort_order: 3,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000008',
    parent_id: '30000000-0000-4000-8000-000000000005',
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Android and iPhone handsets.',
    sort_order: 1,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000009',
    parent_id: '30000000-0000-4000-8000-000000000002',
    name: "Men's Clothing",
    slug: 'mens-clothing',
    description: 'Shirts, t-shirts and trousers.',
    sort_order: 1,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000010',
    parent_id: '30000000-0000-4000-8000-000000000002',
    name: "Women's Clothing",
    slug: 'womens-clothing',
    description: 'Dresses, shirts and knitwear.',
    sort_order: 2,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000011',
    parent_id: '30000000-0000-4000-8000-000000000002',
    name: 'Shoes',
    slug: 'shoes',
    description: 'Sneakers, boots and sandals.',
    sort_order: 3,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000012',
    parent_id: '30000000-0000-4000-8000-000000000003',
    name: 'Kitchen & Dining',
    slug: 'kitchen-and-dining',
    description: 'Cookware, tableware and glassware.',
    sort_order: 1,
    is_active: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000013',
    parent_id: '30000000-0000-4000-8000-000000000003',
    name: 'Bulk Orders',
    slug: 'bulk-orders',
    description: 'Wholesale quantities. Hidden until the B2B phase goes live.',
    sort_order: 99,
    // Inactive, exactly as in the seed. The storefront must not surface it,
    // which is what proves is_active is honoured rather than assumed.
    is_active: false,
  },
];

/**
 * Assembles the flat list into a tree.
 *
 * @param {object[]} categories flat rows with parent_id
 * @param {{ includeInactive?: boolean }} [options]
 * @returns {object[]} roots, each with a `children` array
 */
export function buildTree(categories, { includeInactive = false } = {}) {
  const nodes = new Map();
  for (const category of categories) {
    if (!includeInactive && !category.is_active) continue;
    nodes.set(String(category.id), { ...category, children: [] });
  }

  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(String(node.parent_id)) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const bySortOrder = (a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

  const sortDeep = (list) => {
    list.sort(bySortOrder);
    for (const item of list) sortDeep(item.children);
    return list;
  };

  return sortDeep(roots);
}

/** Read-only copy of the raw category rows. */
export function listCategories() {
  return CATEGORIES.map((category) => ({ ...category }));
}

export default { listCategories, buildTree };