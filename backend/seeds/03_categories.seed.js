/**
 * 03_categories.seed.js — a three-level category tree.
 *
 *   Electronics ─┬─ Phones ─── Smartphones
 *                ├─ Laptops
 *                └─ Accessories
 *   Fashion ─────┬─ Men's Clothing
 *                ├─ Women's Clothing
 *                └─ Shoes
 *   Home & Living ─┬─ Kitchen & Dining
 *                  └─ Bulk Orders (inactive)
 *   Digital Downloads
 *
 * "Smartphones" exists to prove the self-referencing parent works at depth 3,
 * and "Bulk Orders" is inactive to prove is_active is honoured by listings.
 *
 * Ids are 001-013 with no gaps and no duplicates. The upsert below is keyed on
 * id, so a duplicated id here would silently overwrite one category with
 * another instead of failing.
 */
const CATEGORIES = [
  // --- top level -----------------------------------------------------------
  {
    id: '30000000-0000-4000-8000-000000000001',
    parentId: null,
    name: 'Electronics',
    slug: 'electronics',
    description: 'Phones, laptops and everything that plugs in.',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    parentId: null,
    name: 'Fashion',
    slug: 'fashion',
    description: 'Clothing and footwear for every season.',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    parentId: null,
    name: 'Home & Living',
    slug: 'home-and-living',
    description: 'Everyday items for the house.',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    parentId: null,
    name: 'Digital Downloads',
    slug: 'digital-downloads',
    description: 'Ebooks, design assets and software, delivered instantly.',
    sortOrder: 4,
    isActive: true,
  },

  // --- second level --------------------------------------------------------
  {
    id: '30000000-0000-4000-8000-000000000005',
    parentId: '30000000-0000-4000-8000-000000000001',
    name: 'Phones',
    slug: 'phones',
    description: 'Smartphones and feature phones.',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000006',
    parentId: '30000000-0000-4000-8000-000000000001',
    name: 'Laptops',
    slug: 'laptops',
    description: 'Notebooks for work, study and creative work.',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000007',
    parentId: '30000000-0000-4000-8000-000000000001',
    name: 'Accessories',
    slug: 'accessories',
    description: 'Cables, headphones and chargers.',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000008',
    parentId: '30000000-0000-4000-8000-000000000005', // Phones
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Android and iPhone handsets.',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000009',
    parentId: '30000000-0000-4000-8000-000000000002',
    name: "Men's Clothing",
    slug: 'mens-clothing',
    description: 'Shirts, t-shirts and trousers.',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000010',
    parentId: '30000000-0000-4000-8000-000000000002',
    name: "Women's Clothing",
    slug: 'womens-clothing',
    description: 'Dresses, shirts and knitwear.',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000011',
    parentId: '30000000-0000-4000-8000-000000000002',
    name: 'Shoes',
    slug: 'shoes',
    description: 'Sneakers, boots and sandals.',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000012',
    parentId: '30000000-0000-4000-8000-000000000003',
    name: 'Kitchen & Dining',
    slug: 'kitchen-and-dining',
    description: 'Cookware, tableware and glassware.',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: '30000000-0000-4000-8000-000000000013',
    parentId: '30000000-0000-4000-8000-000000000003',
    name: 'Bulk Orders',
    slug: 'bulk-orders',
    description: 'Wholesale quantities. Hidden until the B2B phase goes live.',
    sortOrder: 99,
    isActive: false,
  },
];

function categoryImage(slug) {
  return `https://placehold.co/600x600/f4f4f7/1c1c21?text=${encodeURIComponent(slug)}`;
}

export default async function up({ query }) {
  for (const category of CATEGORIES) {
    await query(
      `INSERT INTO categories
         (id, parent_id, name, slug, description, image_url, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         parent_id   = EXCLUDED.parent_id,
         name        = EXCLUDED.name,
         slug        = EXCLUDED.slug,
         description = EXCLUDED.description,
         image_url   = EXCLUDED.image_url,
         is_active   = EXCLUDED.is_active,
         sort_order  = EXCLUDED.sort_order`,
      [
        category.id,
        category.parentId,
        category.name,
        category.slug,
        category.description,
        categoryImage(category.slug),
        category.isActive,
        category.sortOrder,
      ]
    );
  }
}
