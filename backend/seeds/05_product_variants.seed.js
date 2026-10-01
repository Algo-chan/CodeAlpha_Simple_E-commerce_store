/**
 * 05_product_variants.seed.js — variants, stock and the opening stock ledger.
 *
 * The variant is where price and stock live, so this is the file that makes
 * "Black / 42 is 4,700 ETB and 2 left" true. Prices are in ETB cents
 * (minor units): 470000 is 4,700.00 ETB.
 *
 * attributes is JSONB on purpose, so a shoe and a phone describe themselves
 * with the same column:
 *   {"color":"Black","size":"42"}          footwear
 *   {"storage":"256GB","ram":"8GB", ...}   phone
 *   {}                                      a product with no options
 *
 * DIGITAL products get no inventory row at all - that absence is the signal
 * that the item is not stock-tracked. The icon set has one variant (licence)
 * and still no stock; the ebook has no variant either.
 *
 * The opening ledger is balanced: the signed sum of the transactions below
 * equals every inventory quantity in this file. 07_orders_payments_reviews.seed.js
 * then records the SALE movements of the delivered demo order and decrements
 * the matching rows, so the ledger still explains the balance afterwards.
 */
const SUPPLIER_ID = '70000000-0000-4000-8000-000000000001';

const VARIANTS = [
  // --- Nike Air Max 270: 2 colours x 3 sizes --------------------------------
  {
    id: '50000000-0000-4000-8000-000000000001',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-BLK-40',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'Black', size: '40' },
    stock: { quantity: 12, reorderLevel: 5, restock: 12 },
  },
  {
    id: '50000000-0000-4000-8000-000000000002',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-BLK-41',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'Black', size: '41' },
    stock: { quantity: 8, reorderLevel: 5, restock: 8 },
  },
  {
    // Sold out by the demo order in 07, which is the point of choosing 2.
    id: '50000000-0000-4000-8000-000000000003',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-BLK-42',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'Black', size: '42' },
    stock: { quantity: 2, reorderLevel: 5, restock: 2 },
  },
  {
    id: '50000000-0000-4000-8000-000000000004',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-WHT-40',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'White', size: '40' },
    stock: { quantity: 15, reorderLevel: 5, restock: 15 },
  },
  {
    id: '50000000-0000-4000-8000-000000000005',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-WHT-41',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'White', size: '41' },
    stock: { quantity: 6, reorderLevel: 5, restock: 6 },
  },
  {
    id: '50000000-0000-4000-8000-000000000006',
    productId: '40000000-0000-4000-8000-000000000001',
    sku: 'NIKE-AM270-WHT-42',
    price: 470000,
    compareAtPrice: 520000,
    attributes: { color: 'White', size: '42' },
    stock: { quantity: 4, reorderLevel: 5, restock: 4 },
  },

  // --- Samsung Galaxy A55: storage x ram x colour --------------------------
  {
    id: '50000000-0000-4000-8000-000000000007',
    productId: '40000000-0000-4000-8000-000000000002',
    sku: 'SAM-A55-128-6-NAVY',
    price: 2850000,
    compareAtPrice: null,
    attributes: { storage: '128GB', ram: '6GB', color: 'Navy' },
    stock: { quantity: 25, reorderLevel: 10, restock: 25 },
  },
  {
    id: '50000000-0000-4000-8000-000000000008',
    productId: '40000000-0000-4000-8000-000000000002',
    sku: 'SAM-A55-128-6-WHT',
    price: 2850000,
    compareAtPrice: null,
    attributes: { storage: '128GB', ram: '6GB', color: 'White' },
    stock: { quantity: 18, reorderLevel: 10, restock: 18 },
  },
  {
    // Two of these are held for the pending guest order created in 07.
    id: '50000000-0000-4000-8000-000000000009',
    productId: '40000000-0000-4000-8000-000000000002',
    sku: 'SAM-A55-256-8-NAVY',
    price: 3050000,
    compareAtPrice: null,
    attributes: { storage: '256GB', ram: '8GB', color: 'Navy' },
    stock: { quantity: 9, reorderLevel: 10, restock: 9 },
  },
  {
    id: '50000000-0000-4000-8000-000000000010',
    productId: '40000000-0000-4000-8000-000000000002',
    sku: 'SAM-A55-256-8-BLK',
    price: 3050000,
    compareAtPrice: null,
    attributes: { storage: '256GB', ram: '8GB', color: 'Black' },
    stock: { quantity: 4, reorderLevel: 10, restock: 4 },
  },

  // --- Apple MacBook Air 13" (M3) -------------------------------------------
  {
    id: '50000000-0000-4000-8000-000000000011',
    productId: '40000000-0000-4000-8000-000000000003',
    sku: 'MBA13-M3-256-MID',
    price: 7800000,
    compareAtPrice: null,
    attributes: { storage: '256GB', color: 'Midnight' },
    stock: { quantity: 6, reorderLevel: 2, restock: 6 },
  },
  {
    id: '50000000-0000-4000-8000-000000000012',
    productId: '40000000-0000-4000-8000-000000000003',
    sku: 'MBA13-M3-512-MID',
    price: 9200000,
    compareAtPrice: null,
    attributes: { storage: '512GB', color: 'Midnight' },
    stock: { quantity: 3, reorderLevel: 2, restock: 3 },
  },
  {
    id: '50000000-0000-4000-8000-000000000013',
    productId: '40000000-0000-4000-8000-000000000003',
    sku: 'MBA13-M3-512-STR',
    price: 9200000,
    compareAtPrice: null,
    attributes: { storage: '512GB', color: 'Starlight' },
    stock: { quantity: 2, reorderLevel: 2, restock: 2 },
  },

  // --- Ethiopian Cotton T-Shirt ---------------------------------------------
  {
    id: '50000000-0000-4000-8000-000000000014',
    productId: '40000000-0000-4000-8000-000000000004',
    sku: 'TSHIRT-BLK-M',
    price: 95000,
    compareAtPrice: null,
    attributes: { color: 'Black', size: 'M' },
    stock: { quantity: 45, reorderLevel: 10, restock: 45 },
  },
  {
    id: '50000000-0000-4000-8000-000000000015',
    productId: '40000000-0000-4000-8000-000000000004',
    sku: 'TSHIRT-BLK-L',
    price: 95000,
    compareAtPrice: null,
    attributes: { color: 'Black', size: 'L' },
    // 38 received, 3 written off after a stock count.
    stock: { quantity: 35, reorderLevel: 10, restock: 38, adjustment: -3 },
  },
  {
    id: '50000000-0000-4000-8000-000000000016',
    productId: '40000000-0000-4000-8000-000000000004',
    sku: 'TSHIRT-WHT-XL',
    price: 95000,
    compareAtPrice: null,
    attributes: { color: 'White', size: 'XL' },
    // Never received stock, so it sits at 0 with no ledger entries at all.
    stock: { quantity: 0, reorderLevel: 10, restock: 0 },
  },

  // --- JBL Tune 510BT -------------------------------------------------------
  {
    id: '50000000-0000-4000-8000-000000000017',
    productId: '40000000-0000-4000-8000-000000000005',
    sku: 'JBL-510BT-BLK',
    price: 245000,
    compareAtPrice: 280000,
    attributes: { color: 'Black' },
    stock: { quantity: 20, reorderLevel: 5, restock: 20 },
  },
  {
    id: '50000000-0000-4000-8000-000000000018',
    productId: '40000000-0000-4000-8000-000000000005',
    sku: 'JBL-510BT-BLU',
    price: 245000,
    compareAtPrice: 280000,
    attributes: { color: 'Blue' },
    // 10 received, 3 lost to water damage in transit.
    stock: { quantity: 7, reorderLevel: 5, restock: 10, damage: -3 },
  },

  // --- Ceramic Coffee Set: a single default variant -------------------------
  {
    id: '50000000-0000-4000-8000-000000000019',
    productId: '40000000-0000-4000-8000-000000000006',
    sku: 'COFFEE-SET-4PC',
    price: 165000,
    compareAtPrice: null,
    attributes: {},
    stock: { quantity: 15, reorderLevel: 5, restock: 15 },
  },

  // --- Digital: licensed variant, deliberately not stock-tracked ------------
  {
    id: '50000000-0000-4000-8000-000000000020',
    productId: '40000000-0000-4000-8000-000000000008',
    sku: 'ICON-ADDIS-COM',
    price: 180000,
    compareAtPrice: null,
    attributes: { license: 'Commercial' },
    stock: null,
  },

  // --- Draft product, still stocked so the draft has realistic data --------
  {
    id: '50000000-0000-4000-8000-000000000021',
    productId: '40000000-0000-4000-8000-000000000009',
    sku: 'CHGPAD-15W-BLK',
    price: 120000,
    compareAtPrice: null,
    attributes: { color: 'Black' },
    stock: { quantity: 30, reorderLevel: 10, restock: 30 },
  },
];

/**
 * Transaction ids are derived from the variant position and the movement
 * position, never from a running counter, so re-running the seed updates the
 * existing ledger rows instead of appending duplicates.
 */
function transactionRows(variant, variantIndex) {
  if (!variant.stock) return [];
  const rows = [];

  const add = (transactionType, quantity, referenceType, note) => {
    rows.push({
      id:
        '60000000-0000-4000-8000-' +
        String(variantIndex).padStart(4, '0') +
        String(rows.length).padStart(8, '0'),
      variantId: variant.id,
      transactionType,
      quantity,
      referenceType,
      referenceId: referenceType === 'SUPPLIER' ? SUPPLIER_ID : null,
      note,
    });
  };

  if (variant.stock.restock > 0) {
    add('RESTOCK', variant.stock.restock, 'SUPPLIER', 'Opening stock');
  }
  if (variant.stock.damage) {
    add('DAMAGE', variant.stock.damage, 'MANUAL', 'Water damage in transit');
  }
  if (variant.stock.adjustment) {
    add('ADJUSTMENT', variant.stock.adjustment, 'MANUAL', 'Stock count correction');
  }

  return rows;
}

export default async function up({ query }) {
  for (const variant of VARIANTS) {
    await query(
      `INSERT INTO product_variants
         (id, product_id, sku, price, compare_at_price, attributes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6::JSONB, TRUE)
       ON CONFLICT (id) DO UPDATE SET
         product_id       = EXCLUDED.product_id,
         sku              = EXCLUDED.sku,
         price            = EXCLUDED.price,
         compare_at_price = EXCLUDED.compare_at_price,
         attributes       = EXCLUDED.attributes,
         is_active        = TRUE`,
      [
        variant.id,
        variant.productId,
        variant.sku,
        variant.price,
        variant.compareAtPrice,
        JSON.stringify(variant.attributes),
      ]
    );
  }

  for (const variant of VARIANTS) {
    if (!variant.stock) continue;
    await query(
      `INSERT INTO inventory (variant_id, quantity, reserved_quantity, reorder_level)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (variant_id) DO UPDATE SET
         quantity      = EXCLUDED.quantity,
         reorder_level = EXCLUDED.reorder_level`,
      [variant.id, variant.stock.quantity, variant.stock.reorderLevel]
    );
  }

  for (const [variantIndex, variant] of VARIANTS.entries()) {
    for (const transaction of transactionRows(variant, variantIndex + 1)) {
      await query(
        `INSERT INTO inventory_transactions
           (id, variant_id, transaction_type, quantity, reference_type, reference_id, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           transaction_type = EXCLUDED.transaction_type,
           quantity         = EXCLUDED.quantity,
           reference_type   = EXCLUDED.reference_type,
           reference_id     = EXCLUDED.reference_id,
           note             = EXCLUDED.note`,
        [
          transaction.id,
          transaction.variantId,
          transaction.transactionType,
          transaction.quantity,
          transaction.referenceType,
          transaction.referenceId,
          transaction.note,
        ]
      );
    }
  }
}
