/**
 * 04_products.seed.js — demo catalogue and image galleries.
 *
 * Covers the shapes the catalogue has to handle:
 *   - three-level category placement (Smartphones lives under Phones)
 *   - a product with many variants (shoes: 2 colours x 3 sizes)
 *   - a product with a single default variant and empty attributes
 *   - DIGITAL products with no variant at all
 *   - a DRAFT product that must not appear in the storefront
 *
 * Images point at the photos committed with the storefront under
 * `frontend/assets/images/products/<slug>/<angle>.webp`, and carry the angle in
 * `alt_text`, because the gallery component reads is_primary, sort_order and
 * alt_text to build thumbnails, the main image and the zoom overlay. The URL is
 * deliberately RELATIVE: it resolves against the storefront's own origin whether
 * the frontend runs on its dev server (:5173) or is served by the API in
 * production, and it survives a domain move.
 *
 * The angles listed per product are exactly the files that exist for it. A URL
 * naming a photo that was never committed is a broken frame in the gallery, so
 * the count varies deliberately and is not padded to a fixed five.
 *
 * Prices live in 05_product_variants.seed.js - products intentionally have no
 * price column.
 */
const PRODUCTS = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    categoryId: '30000000-0000-4000-8000-000000000011', // Shoes
    name: 'Nike Air Max 270',
    slug: 'nike-air-max-270',
    brand: 'Nike',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'Everyday running shoe with a large visible Air heel unit. Mesh upper, foam ' +
      'midsole and a rubber outsole built for daily wear on concrete.',
    images: ['front', 'side', 'back'],
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    categoryId: '30000000-0000-4000-8000-000000000008', // Smartphones
    name: 'Samsung Galaxy A55',
    slug: 'samsung-galaxy-a55',
    brand: 'Samsung',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '6.6" Super AMOLED display, 50MP main camera and a 5000mAh battery. ' +
      'IP67 rated, with four years of OS updates.',
    images: ['front', 'detail', 'lifestyle'],
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    categoryId: '30000000-0000-4000-8000-000000000006', // Laptops
    name: 'Apple MacBook Air 13" (M3)',
    slug: 'apple-macbook-air-13-m3',
    brand: 'Apple',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '13.6" Liquid Retina display with the M3 chip, 8GB unified memory and a ' +
      'fanless design that stays silent under load.',
    images: ['front', 'side', 'detail'],
  },
  {
    id: '40000000-0000-4000-8000-000000000004',
    categoryId: '30000000-0000-4000-8000-000000000009', // Men's Clothing
    name: 'Ethiopian Cotton T-Shirt',
    slug: 'ethiopian-cotton-t-shirt',
    brand: 'Addis Cotton',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '180gsm combed cotton, pre-shrunk, with a soft-print logo on the chest. ' +
      'Everyday weight for Addis weather.',
    images: ['front', 'detail', 'lifestyle'],
  },
  {
    id: '40000000-0000-4000-8000-000000000005',
    categoryId: '30000000-0000-4000-8000-000000000007', // Accessories
    name: 'JBL Tune 510BT',
    slug: 'jbl-tune-510bt',
    brand: 'JBL',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'On-ear wireless headphones with 40mm drivers, Pure Bass sound and 40 hours ' +
      'of battery. Foldable, with a 3.5mm cable in the box.',
    images: ['front', 'detail', 'lifestyle'],
  },
  {
    id: '40000000-0000-4000-8000-000000000006',
    categoryId: '30000000-0000-4000-8000-000000000012', // Kitchen & Dining
    name: 'Ceramic Coffee Set (4 piece)',
    slug: 'ceramic-coffee-set-4-piece',
    brand: 'Habesha Home',
    productType: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'Stoneware set for four: four cups, four saucers, a sugar bowl and a ' +
      '250ml serving pot. Dishwasher and microwave safe.',
    images: ['front', 'detail', 'lifestyle'],
  },
  {
    id: '40000000-0000-4000-8000-000000000007',
    categoryId: '30000000-0000-4000-8000-000000000004', // Digital Downloads
    name: 'Ebook: Building REST APIs with Node.js',
    slug: 'ebook-building-rest-apis-with-nodejs',
    brand: 'Store Press',
    productType: 'DIGITAL',
    status: 'ACTIVE',
    description:
      '180-page guide to production Node.js APIs: routing, validation, ' +
      'transactions, migrations, authentication and deployment. EPUB and PDF.',
    // No variants at all: the product itself is the deliverable.
    images: ['front', 'detail', 'sample-spread'],
  },
  {
    id: '40000000-0000-4000-8000-000000000008',
    categoryId: '30000000-0000-4000-8000-000000000004', // Digital Downloads
    name: 'Icon Set: Addis City',
    slug: 'icon-set-addis-city',
    brand: 'Store Press',
    productType: 'DIGITAL',
    status: 'ACTIVE',
    description:
      '120 hand-drawn vector icons inspired by Addis landmarks, delivered as SVG ' +
      'and PNG at three sizes.',
    // A digital product that is licensed: one variant, license is the option.
    images: ['front', 'detail', 'lifestyle'],
  },
  {
    id: '40000000-0000-4000-8000-000000000009',
    categoryId: '30000000-0000-4000-8000-000000000007', // Accessories
    name: 'Wireless Charging Pad (prototype)',
    slug: 'wireless-charging-pad-prototype',
    brand: 'Store Lab',
    productType: 'PHYSICAL',
    status: 'DRAFT',
    description:
      '15W fast wireless charging pad. Not yet priced for sale - kept as a DRAFT so ' +
      'the catalogue can be tested with unpublished products.',
    images: ['front', 'side', 'detail'],
  },
];

/**
 * Image ids are derived from the product position and the image position, never
 * from a running counter. A counter would give a fresh id on every re-run, and
 * the re-run would then insert duplicate images instead of updating the existing
 * ones (and trip the one-primary-image-per-product index).
 */
function imageRows(product, productIndex) {
  return product.images.map((angle, imageIndex) => ({
    id:
      '41000000-0000-4000-8000-' +
      String(productIndex).padStart(4, '0') +
      String(imageIndex).padStart(8, '0'),
    productId: product.id,
    imageUrl: `/assets/images/products/${product.slug}/${angle}.webp`,
    altText: `${product.name} - ${angle} view`,
    sortOrder: imageIndex,
    isPrimary: imageIndex === 0,
  }));
}

export default async function up({ query }) {
  for (const product of PRODUCTS) {
    await query(
      `INSERT INTO products
         (id, category_id, name, slug, description, product_type, brand, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         category_id  = EXCLUDED.category_id,
         name         = EXCLUDED.name,
         slug         = EXCLUDED.slug,
         description  = EXCLUDED.description,
         product_type = EXCLUDED.product_type,
         brand        = EXCLUDED.brand,
         status       = EXCLUDED.status`,
      [
        product.id,
        product.categoryId,
        product.name,
        product.slug,
        product.description,
        product.productType,
        product.brand,
        product.status,
      ]
    );
  }

  for (const [productIndex, product] of PRODUCTS.entries()) {
    for (const image of imageRows(product, productIndex + 1)) {
      await query(
        `INSERT INTO product_images
           (id, product_id, image_url, alt_text, sort_order, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           image_url  = EXCLUDED.image_url,
           alt_text   = EXCLUDED.alt_text,
           sort_order = EXCLUDED.sort_order,
           is_primary = EXCLUDED.is_primary`,
        [image.id, image.productId, image.imageUrl, image.altText, image.sortOrder, image.isPrimary]
      );
    }
  }
}
