/**
 * 06_carts_wishlists.seed.js — guest cart, customer carts, the login merge, and
 * wishlists.
 *
 * Guest carts
 *   The guest cart is identified by session_token, an opaque random value from
 *   an httpOnly cookie (>= 32 characters). The tokens below are fixed demo
 *   strings so the seeds stay re-runnable - they are NOT secrets and grant no
 *   access to anything. The real value is generated per visitor with a CSPRNG
 *   by the cart API in a later phase.
 *
 * The login merge
 *   Cart 4 is a guest cart that has already been merged into Abebe's cart when
 *   he signed in. It is kept as status CONVERTED with merged_into_cart_id
 *   pointing at the surviving cart, so the merge is traceable and a retried
 *   merge cannot duplicate lines. Its items now live in Abebe's cart.
 *
 * Carts store no price. A line is a variant and a quantity; the cart service
 * reads product_variants.price to build totals.
 *
 * Wishlists reference the PRODUCT, because a shopper saves "the shoes" and
 * picks a size later.
 */
import { daysAfterNow } from './_reference_time.js';

const GUEST_SESSION_TOKEN_A =
  'demo0000000000000000000000000000000000000000000000000000000000guestA';
const GUEST_SESSION_TOKEN_B =
  'demo0000000000000000000000000000000000000000000000000000000000guestB';

const CARTS = [
  {
    id: '80000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000002', // Abebe
    sessionToken: null,
    status: 'ACTIVE',
    mergedIntoCartId: null,
    expiresAt: null,
  },
  {
    id: '80000000-0000-4000-8000-000000000002',
    userId: '10000000-0000-4000-8000-000000000003', // Sara
    sessionToken: null,
    status: 'ACTIVE',
    mergedIntoCartId: null,
    expiresAt: null,
  },
  {
    id: '80000000-0000-4000-8000-000000000003',
    userId: null,
    sessionToken: GUEST_SESSION_TOKEN_A,
    status: 'ACTIVE',
    mergedIntoCartId: null,
    // Guest carts are disposable: they expire.
    expiresAt: daysAfterNow(30),
  },
  {
    id: '80000000-0000-4000-8000-000000000004',
    userId: null,
    sessionToken: GUEST_SESSION_TOKEN_B,
    status: 'CONVERTED',
    mergedIntoCartId: '80000000-0000-4000-8000-000000000001',
    expiresAt: null,
  },
];

const CART_ITEMS = [
  {
    id: '82000000-0000-4000-8000-000000000001',
    cartId: '80000000-0000-4000-8000-000000000001',
    variantId: '50000000-0000-4000-8000-000000000002',
    quantity: 1,
  }, // Abebe: Black / 41
  {
    id: '82000000-0000-4000-8000-000000000002',
    cartId: '80000000-0000-4000-8000-000000000001',
    variantId: '50000000-0000-4000-8000-000000000015',
    quantity: 2,
  }, // Abebe: Black / L x2
  {
    id: '82000000-0000-4000-8000-000000000003',
    cartId: '80000000-0000-4000-8000-000000000002',
    variantId: '50000000-0000-4000-8000-000000000008',
    quantity: 1,
  }, // Sara: 128GB / 6GB / White
  {
    id: '82000000-0000-4000-8000-000000000004',
    cartId: '80000000-0000-4000-8000-000000000003',
    variantId: '50000000-0000-4000-8000-000000000012',
    quantity: 1,
  }, // guest: 512GB / Midnight
  {
    id: '82000000-0000-4000-8000-000000000005',
    cartId: '80000000-0000-4000-8000-000000000003',
    variantId: '50000000-0000-4000-8000-000000000019',
    quantity: 1,
  }, // guest: coffee set
];

const WISHLISTS = [
  {
    id: '81000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000002',
    name: 'My Wishlist',
  },
  {
    id: '81000000-0000-4000-8000-000000000002',
    userId: '10000000-0000-4000-8000-000000000003',
    name: 'Saved for Later',
  },
];

const WISHLIST_ITEMS = [
  {
    id: '83000000-0000-4000-8000-000000000001',
    wishlistId: '81000000-0000-4000-8000-000000000001',
    productId: '40000000-0000-4000-8000-000000000001',
  }, // Nike Air Max 270
  {
    id: '83000000-0000-4000-8000-000000000002',
    wishlistId: '81000000-0000-4000-8000-000000000001',
    productId: '40000000-0000-4000-8000-000000000007',
  }, // Ebook
  {
    id: '83000000-0000-4000-8000-000000000003',
    wishlistId: '81000000-0000-4000-8000-000000000002',
    productId: '40000000-0000-4000-8000-000000000003',
  }, // MacBook Air
  {
    id: '83000000-0000-4000-8000-000000000004',
    wishlistId: '81000000-0000-4000-8000-000000000002',
    productId: '40000000-0000-4000-8000-000000000008',
  }, // Icon Set
];

export default async function up({ query }) {
  for (const cart of CARTS) {
    await query(
      `INSERT INTO carts
         (id, user_id, session_token, status, merged_into_cart_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         status              = EXCLUDED.status,
         merged_into_cart_id = EXCLUDED.merged_into_cart_id,
         expires_at          = EXCLUDED.expires_at`,
      [cart.id, cart.userId, cart.sessionToken, cart.status, cart.mergedIntoCartId, cart.expiresAt]
    );
  }

  for (const item of CART_ITEMS) {
    await query(
      `INSERT INTO cart_items (id, cart_id, variant_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [item.id, item.cartId, item.variantId, item.quantity]
    );
  }

  for (const wishlist of WISHLISTS) {
    await query(
      `INSERT INTO wishlists (id, user_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [wishlist.id, wishlist.userId, wishlist.name]
    );
  }

  for (const item of WISHLIST_ITEMS) {
    await query(
      `INSERT INTO wishlist_items (id, wishlist_id, product_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET product_id = EXCLUDED.product_id`,
      [item.id, item.wishlistId, item.productId]
    );
  }
}
