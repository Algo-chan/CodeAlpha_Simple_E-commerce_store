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
 * Images use placeholder URLs and label the angle, because the gallery
 * component reads is_primary, sort_order and alt_text to build thumbnails,
 * the main image and the zoom overlay. There is no cap on the number of images
 * per product, so the count varies deliberately.
 *
 * Prices live in 05_product_variants.seed.js - products intentionally have no
 * price column.
 */
const PLACEHOLDER = 'https://placehold.co/800x800/f4f4f7/1c1c21?text=';

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
    images: ['Front', 'Side', 'Back', 'Detail', 'Lifestyle'],
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
    images: ['Front', 'Back', 'Detail', 'Lifestyle'],
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
    images: ['Front', 'Side', 'Back', 'Detail'],
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
    images: ['Front', 'Back', 'Detail', 'Lifestyle'],
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
    images: ['Front', 'Side', 'Detail'],
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
    images: ['Front', 'Detail', 'Lifestyle'],
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
    images: ['Front', 'Detail'],
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
    images: ['Front', 'Detail', 'Lifestyle'],
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
    images: ['Front', 'Side', 'Detail'],
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
    imageUrl: `${PLACEHOLDER}${encodeURIComponent(`${product.slug}+${angle}`)}`,
    altText: `${product.name} - ${angle.toLowerCase()} view`,
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
