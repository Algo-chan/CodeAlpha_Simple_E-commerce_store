/**
 * Mock products and variants.
 *
 * Mirrors `backend/seeds/04_products.seed.js` and
 * `backend/seeds/05_product_variants.seed.js`, including the UUIDs, SKUs, ETB
 * minor-unit prices and JSONB attribute shapes.
 *
 * TWO DELIBERATE DIVERGENCES FROM THE SEED, both documented inline:
 *
 *  1. STOCK IS POST-ORDER. The seed file states opening levels; the delivered
 *     demo order in `07_orders_payments_reviews.seed.js` then decrements six of
 *     them. A storefront that still showed the opening levels would claim stock
 *     that no longer exists - notably the Nike Black/42, which is the whole
 *     point of that order. `INVENTORY_AFTER_ORDERS` is applied below.
 *
 *  2. `is_featured`, `short_description`, `tags`, `created_at` and the review
 *     fixture have no column yet. They are presentation inputs the Phase 3 UI
 *     needs and Phase 4 will serve. They are namespaced in this file so it is
 *     obvious what has to be added server-side.
 *
 * AVAILABLE QUANTITY IS `quantity - reserved_quantity`. Reserved units are
 * committed to other orders, so quoting them as "in stock" would be a lie that
 * turns into an oversell at checkout.
 */

/** Post-order levels from seed 07, keyed by variant id. */
const INVENTORY_AFTER_ORDERS = new Map([
  ['50000000-0000-4000-8000-000000000003', { quantity: 0, reserved_quantity: 0 }],
  ['50000000-0000-4000-8000-000000000006', { quantity: 3, reserved_quantity: 0 }],
  ['50000000-0000-4000-8000-000000000017', { quantity: 19, reserved_quantity: 0 }],
  ['50000000-0000-4000-8000-000000000019', { quantity: 14, reserved_quantity: 0 }],
  ['50000000-0000-4000-8000-000000000009', { quantity: 9, reserved_quantity: 1 }],
  ['50000000-0000-4000-8000-000000000014', { quantity: 45, reserved_quantity: 2 }],
]);

const NIKE = '40000000-0000-4000-8000-000000000001';
const SAMSUNG = '40000000-0000-4000-8000-000000000002';
const MACBOOK = '40000000-0000-4000-8000-000000000003';
const TSHIRT = '40000000-0000-4000-8000-000000000004';
const JBL = '40000000-0000-4000-8000-000000000005';
const COFFEE = '40000000-0000-4000-8000-000000000006';
const EBOOK = '40000000-0000-4000-8000-000000000007';
const ICONS = '40000000-0000-4000-8000-000000000008';
const PROTOTYPE = '40000000-0000-4000-8000-000000000009';

/* -------------------------------------------------------------------------- */
/* Products                                                                     */
/* -------------------------------------------------------------------------- */

/** @type {Array<object>} */
const PRODUCTS = [
  {
    id: NIKE,
    category_id: '30000000-0000-4000-8000-000000000011',
    name: 'Nike Air Max 270',
    slug: 'nike-air-max-270',
    brand: 'Nike',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'Everyday running shoe with a large visible Air heel unit. Mesh upper, foam ' +
      'midsole and a rubber outsole built for daily wear on concrete.',
    short_description: 'Visible Air unit, mesh upper, foam midsole.',
    images: ['Front', 'Side', 'Back', 'Detail', 'Lifestyle'],
    is_featured: true,
    tags: ['running', 'everyday'],
    created_at: '2026-08-14T09:12:00.000Z',
  },
  {
    id: SAMSUNG,
    category_id: '30000000-0000-4000-8000-000000000008',
    name: 'Samsung Galaxy A55',
    slug: 'samsung-galaxy-a55',
    brand: 'Samsung',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '6.6" Super AMOLED display, 50MP main camera and a 5000mAh battery. ' +
      'IP67 rated, with four years of OS updates.',
    short_description: '6.6" AMOLED, 50MP camera, 5000mAh battery.',
    images: ['Front', 'Back', 'Detail', 'Lifestyle'],
    is_featured: true,
    tags: ['phone', 'android'],
    created_at: '2026-09-02T11:40:00.000Z',
  },
  {
    id: MACBOOK,
    category_id: '30000000-0000-4000-8000-000000000006',
    name: 'Apple MacBook Air 13" (M3)',
    slug: 'apple-macbook-air-13-m3',
    brand: 'Apple',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '13.6" Liquid Retina display with the M3 chip, 8GB unified memory and a ' +
      'fanless design that stays silent under load.',
    short_description: 'M3 chip, fanless, 13.6" Liquid Retina display.',
    images: ['Front', 'Side', 'Back', 'Detail'],
    is_featured: true,
    tags: ['laptop', 'work', 'study'],
    created_at: '2026-07-28T14:05:00.000Z',
  },
  {
    id: TSHIRT,
    category_id: '30000000-0000-4000-8000-000000000009',
    name: 'Ethiopian Cotton T-Shirt',
    slug: 'ethiopian-cotton-t-shirt',
    brand: 'Addis Cotton',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      '180gsm combed cotton, pre-shrunk, with a soft-print logo on the chest. ' +
      'Everyday weight for Addis weather.',
    short_description: '180gsm combed cotton, pre-shrunk, soft print.',
    images: ['Front', 'Back', 'Detail', 'Lifestyle'],
    is_featured: false,
    tags: ['cotton', 'basics'],
    created_at: '2026-06-11T08:20:00.000Z',
  },
  {
    id: JBL,
    category_id: '30000000-0000-4000-8000-000000000007',
    name: 'JBL Tune 510BT',
    slug: 'jbl-tune-510bt',
    brand: 'JBL',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'On-ear wireless headphones with 40mm drivers, Pure Bass sound and 40 hours ' +
      'of battery. Foldable, with a 3.5mm cable in the box.',
    short_description: '40mm drivers, 40-hour battery, foldable.',
    images: ['Front', 'Side', 'Detail'],
    is_featured: true,
    tags: ['audio', 'wireless'],
    created_at: '2026-09-18T16:30:00.000Z',
  },
  {
    id: COFFEE,
    category_id: '30000000-0000-4000-8000-000000000012',
    name: 'Ceramic Coffee Set (4 piece)',
    slug: 'ceramic-coffee-set-4-piece',
    brand: 'Habesha Home',
    product_type: 'PHYSICAL',
    status: 'ACTIVE',
    description:
      'Stoneware set for four: four cups, four saucers, a sugar bowl and a ' +
      '250ml serving pot. Dishwasher and microwave safe.',
    short_description: 'Stoneware for four: cups, saucers, sugar bowl, pot.',
    images: ['Front', 'Detail', 'Lifestyle'],
    is_featured: false,
    tags: ['tableware', 'kitchen'],
    created_at: '2026-05-30T10:00:00.000Z',
  },
  {
    id: EBOOK,
    category_id: '30000000-0000-4000-8000-000000000004',
    name: 'Ebook: Building REST APIs with Node.js',
    slug: 'ebook-building-rest-apis-with-nodejs',
    brand: 'Store Press',
    product_type: 'DIGITAL',
    status: 'ACTIVE',
    description:
      '180-page guide to production Node.js APIs: routing, validation, ' +
      'transactions, migrations, authentication and deployment. EPUB and PDF.',
    short_description: '180 pages on production Node.js APIs. EPUB and PDF.',
    images: ['Front', 'Detail'],
    is_featured: false,
    tags: ['ebook', 'engineering'],
    created_at: '2026-03-19T13:25:00.000Z',
  },
  {
    id: ICONS,
    category_id: '30000000-0000-4000-8000-000000000004',
    name: 'Icon Set: Addis City',
    slug: 'icon-set-addis-city',
    brand: 'Store Press',
    product_type: 'DIGITAL',
    status: 'ACTIVE',
    description:
      '120 hand-drawn vector icons inspired by Addis landmarks, delivered as SVG ' +
      'and PNG at three sizes.',
    short_description: '120 landmarks-inspired vectors. SVG and PNG.',
    images: ['Front', 'Detail', 'Lifestyle'],
    is_featured: false,
    tags: ['design', 'icons'],
    created_at: '2026-04-08T09:45:00.000Z',
  },
  {
    id: PROTOTYPE,
    category_id: '30000000-0000-4000-8000-000000000007',
    name: 'Wireless Charging Pad (prototype)',
    slug: 'wireless-charging-pad-prototype',
    brand: 'Store Lab',
    product_type: 'PHYSICAL',
    // DRAFT: must never reach a listing. Kept so the storefront can be proven
    // to filter on status, not just on is_active.
    status: 'DRAFT',
    description:
      '15W fast wireless charging pad. Not yet priced for sale - kept as a DRAFT so ' +
      'the catalogue can be tested with unpublished products.',
    short_description: '15W fast charging pad. Not yet on sale.',
    images: ['Front', 'Side', 'Detail'],
    is_featured: false,
    tags: ['prototype'],
    created_at: '2026-09-25T12:00:00.000Z',
  },
];

/* -------------------------------------------------------------------------- */
/* Variants                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `price` and `compare_at_price` are ETB minor units.
 * `stock: null` means the variant is not stock-tracked (digital goods).
 * @type {Array<object>}
 */
const VARIANTS = [
  // Nike Air Max 270: 2 colours x 3 sizes
  { id: '50000000-0000-4000-8000-000000000001', product_id: NIKE, sku: 'NIKE-AM270-BLK-40', price: 470000, compare_at_price: 520000, attributes: { color: 'Black', size: '40' }, stock: { quantity: 12, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000002', product_id: NIKE, sku: 'NIKE-AM270-BLK-41', price: 470000, compare_at_price: 520000, attributes: { color: 'Black', size: '41' }, stock: { quantity: 8, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000003', product_id: NIKE, sku: 'NIKE-AM270-BLK-42', price: 470000, compare_at_price: 520000, attributes: { color: 'Black', size: '42' }, stock: { quantity: 2, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000004', product_id: NIKE, sku: 'NIKE-AM270-WHT-40', price: 470000, compare_at_price: 520000, attributes: { color: 'White', size: '40' }, stock: { quantity: 15, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000005', product_id: NIKE, sku: 'NIKE-AM270-WHT-41', price: 470000, compare_at_price: 520000, attributes: { color: 'White', size: '41' }, stock: { quantity: 6, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000006', product_id: NIKE, sku: 'NIKE-AM270-WHT-42', price: 470000, compare_at_price: 520000, attributes: { color: 'White', size: '42' }, stock: { quantity: 4, reorder_level: 5 } },

  // Samsung Galaxy A55: storage x ram x colour
  { id: '50000000-0000-4000-8000-000000000007', product_id: SAMSUNG, sku: 'SAM-A55-128-6-NAVY', price: 2850000, compare_at_price: null, attributes: { storage: '128GB', ram: '6GB', color: 'Navy' }, stock: { quantity: 25, reorder_level: 10 } },
  { id: '50000000-0000-4000-8000-000000000008', product_id: SAMSUNG, sku: 'SAM-A55-128-6-WHT', price: 2850000, compare_at_price: null, attributes: { storage: '128GB', ram: '6GB', color: 'White' }, stock: { quantity: 18, reorder_level: 10 } },
  { id: '50000000-0000-4000-8000-000000000009', product_id: SAMSUNG, sku: 'SAM-A55-256-8-NAVY', price: 3050000, compare_at_price: null, attributes: { storage: '256GB', ram: '8GB', color: 'Navy' }, stock: { quantity: 9, reorder_level: 10 } },
  { id: '50000000-0000-4000-8000-000000000010', product_id: SAMSUNG, sku: 'SAM-A55-256-8-BLK', price: 3050000, compare_at_price: null, attributes: { storage: '256GB', ram: '8GB', color: 'Black' }, stock: { quantity: 4, reorder_level: 10 } },

  // Apple MacBook Air 13" (M3)
  { id: '50000000-0000-4000-8000-000000000011', product_id: MACBOOK, sku: 'MBA13-M3-256-MID', price: 7800000, compare_at_price: null, attributes: { storage: '256GB', color: 'Midnight' }, stock: { quantity: 6, reorder_level: 2 } },
  { id: '50000000-0000-4000-8000-000000000012', product_id: MACBOOK, sku: 'MBA13-M3-512-MID', price: 9200000, compare_at_price: null, attributes: { storage: '512GB', color: 'Midnight' }, stock: { quantity: 3, reorder_level: 2 } },
  { id: '50000000-0000-4000-8000-000000000013', product_id: MACBOOK, sku: 'MBA13-M3-512-STR', price: 9200000, compare_at_price: null, attributes: { storage: '512GB', color: 'Starlight' }, stock: { quantity: 2, reorder_level: 2 } },

  // Ethiopian Cotton T-Shirt
  { id: '50000000-0000-4000-8000-000000000014', product_id: TSHIRT, sku: 'TSHIRT-BLK-M', price: 95000, compare_at_price: null, attributes: { color: 'Black', size: 'M' }, stock: { quantity: 45, reorder_level: 10 } },
  { id: '50000000-0000-4000-8000-000000000015', product_id: TSHIRT, sku: 'TSHIRT-BLK-L', price: 95000, compare_at_price: null, attributes: { color: 'Black', size: 'L' }, stock: { quantity: 35, reorder_level: 10 } },
  { id: '50000000-0000-4000-8000-000000000016', product_id: TSHIRT, sku: 'TSHIRT-WHT-XL', price: 95000, compare_at_price: null, attributes: { color: 'White', size: 'XL' }, stock: { quantity: 0, reorder_level: 10 } },

  // JBL Tune 510BT
  { id: '50000000-0000-4000-8000-000000000017', product_id: JBL, sku: 'JBL-510BT-BLK', price: 245000, compare_at_price: 280000, attributes: { color: 'Black' }, stock: { quantity: 20, reorder_level: 5 } },
  { id: '50000000-0000-4000-8000-000000000018', product_id: JBL, sku: 'JBL-510BT-BLU', price: 245000, compare_at_price: 280000, attributes: { color: 'Blue' }, stock: { quantity: 7, reorder_level: 5 } },

  // Ceramic Coffee Set: a single default variant
  { id: '50000000-0000-4000-8000-000000000019', product_id: COFFEE, sku: 'COFFEE-SET-4PC', price: 165000, compare_at_price: null, attributes: {}, stock: { quantity: 15, reorder_level: 5 } },

  // Digital: licensed variant, deliberately not stock-tracked
  { id: '50000000-0000-4000-8000-000000000020', product_id: ICONS, sku: 'ICON-ADDIS-COM', price: 180000, compare_at_price: null, attributes: { license: 'Commercial' }, stock: null },

  // Draft product, still stocked so the draft has realistic data
  { id: '50000000-0000-4000-8000-000000000021', product_id: PROTOTYPE, sku: 'CHGPAD-15W-BLK', price: 120000, compare_at_price: null, attributes: { color: 'Black' }, stock: { quantity: 30, reorder_level: 10 } },
];

/* -------------------------------------------------------------------------- */
/* Reviews (Phase 3 fixture)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The seed contains exactly one review (the Nike one from the delivered order).
 * A storefront where only one product has a rating is a poor demonstration of
 * the rating UI, so this adds clearly-labelled fixtures. When the reviews API
 * lands in Phase 4 this array is deleted and the aggregate comes from the DB.
 *
 * @type {Array<{product_id:string, rating:number, title:string, body:string,
 *                author:string, days_ago:number}>}
 */
const REVIEWS = [
  { product_id: NIKE, rating: 5, title: 'Comfortable straight out of the box', body: 'Wore them for two weeks straight during the rainy season and they still look new. The size chart is accurate — I am usually between sizes and took my usual.', author: 'Abebe T.', days_ago: 4, verified: true },
  { product_id: NIKE, rating: 4, title: 'Great shoe, narrow through the middle', body: 'The Air unit looks better in person. Midsole is firmer than I expected, which I like for walking all day.', author: 'Selam G.', days_ago: 21, verified: true },
  { product_id: NIKE, rating: 5, title: 'Third pair I have bought', body: 'Wore the previous two into the ground. Same fit, same comfort, and delivery took two days.', author: 'Dawit K.', days_ago: 46, verified: false },

  { product_id: SAMSUNG, rating: 5, title: 'Battery genuinely lasts two days', body: 'I charge it every other morning and still have 30% at night. The screen is bright enough to read in direct sun.', author: 'Marta B.', days_ago: 9, verified: true },
  { product_id: SAMSUNG, rating: 4, title: 'Excellent phone, camera is fine not great', body: 'Software has been smooth for four months. Night photos are usable but nothing special.', author: 'Yonas A.', days_ago: 33, verified: true },

  { product_id: MACBOOK, rating: 5, title: 'Silent and cold, exactly as promised', body: 'Under a sustained compile load it stays at the same temperature as when idle. Fans never spun up once.', author: 'Hana M.', days_ago: 15, verified: true },
  { product_id: MACBOOK, rating: 4, title: 'Excellent, but the memory is tight', body: '8GB is fine for everything I do. If you are running two VMs at once, buy the 512GB and step up.', author: 'Tewodros L.', days_ago: 52, verified: false },

  { product_id: TSHIRT, rating: 5, title: 'Soft, and it has survived ten washes', body: 'No shrinkage, no fading at the neck. The print is soft enough that it does not crack.', author: 'Rahel N.', days_ago: 18, verified: true },
  { product_id: TSHIRT, rating: 4, title: 'Good weight for the price', body: 'Not thick enough for a cold night, but perfect for Addis weather in the dry season.', author: 'Eyob F.', days_ago: 40, verified: true },

  { product_id: JBL, rating: 5, title: 'Battery claim is accurate', body: 'Forty hours is real — I get closer to forty-five. The bass is not subtle but that is the JBL house sound.', author: 'Saron E.', days_ago: 12, verified: true },
  { product_id: JBL, rating: 4, title: 'Comfortable, slightly warm on the ears', body: 'Fine for an hour at a time. The clamp is light, which is rare at this price.', author: 'Nahom D.', days_ago: 29, verified: false },

  { product_id: COFFEE, rating: 5, title: 'Glaze has not crazed after months', body: 'The pot keeps heat well and nothing has stuck yet. Worth the price for the set.', author: 'Liya S.', days_ago: 25, verified: true },
  { product_id: COFFEE, rating: 3, title: 'Beautiful, smaller than I pictured', body: 'Cup size is closer to an espresso than a mug. Check the dimensions before ordering.', author: 'Kalkidan T.', days_ago: 61, verified: false },

  { product_id: EBOOK, rating: 4, title: 'Dense and worth it', body: 'Assumes you already know your way around Express. The migrations chapter alone justified the price.', author: 'Meron Z.', days_ago: 30, verified: true },
  { product_id: ICONS, rating: 5, title: 'Consistent line weight throughout', body: 'You can tell they were drawn as a set. The PNG exports are correctly sized at all three scales.', author: 'Dagmawi H.', days_ago: 7, verified: true },
];

/* -------------------------------------------------------------------------- */
/* Read API                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * All variant rows, normalised to the view-model field names the UI uses.
 *
 * @returns {Array<{id:string, product_id:string, sku:string, price_minor:number,
 *   compare_at_price_minor:number|null, attributes:object, is_active:boolean,
 *   stock:{quantity:number, reserved_quantity:number, available:number,
 *          reorder_level:number, is_active:boolean}|null}>}
 */
export function listVariants() {
  return VARIANTS.map((variant) => {
    const base = variant.stock;
    const adjustment = base ? INVENTORY_AFTER_ORDERS.get(variant.id) : undefined;
    const quantity = adjustment ? adjustment.quantity : (base?.quantity ?? null);
    const reserved = adjustment ? adjustment.reserved_quantity : 0;

    return {
      id: variant.id,
      product_id: variant.product_id,
      sku: variant.sku,
      price_minor: variant.price,
      compare_at_price_minor: variant.compare_at_price,
      attributes: variant.attributes ?? {},
      is_active: true,
      // `stock: null` is the signal that this variant is not stock-tracked.
      stock:
        quantity === null
          ? null
          : {
              quantity,
              reserved_quantity: reserved,
              available: Math.max(0, quantity - reserved),
              reorder_level: base?.reorder_level ?? 0,
              is_active: quantity > 0,
            },
    };
  });
}

/** @returns {object[]} deep-ish copy of the product rows */
export function listProducts() {
  return PRODUCTS.map((product) => ({ ...product, images: [...product.images] }));
}

/** @returns {Array<object>} review rows, newest first */
export function listReviews() {
  const now = Date.now();
  return REVIEWS.map((review, index) => ({
    id: `95000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    product_id: review.product_id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    author: review.author,
    is_verified_purchase: review.verified ?? false,
    status: 'APPROVED',
    created_at: new Date(now - review.days_ago * 86400000).toISOString(),
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export default { listProducts, listVariants, listReviews };