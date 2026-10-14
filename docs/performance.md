# Performance

Where the time goes and what Phase 11 changed to reduce it. This is a working
map of the deliberate choices, not a benchmark report; the numbers below are the
defaults in code and are the place to start tuning.

## Database

### Indexes

Indexes are chosen from the query workload, not added speculatively. Migration
`024_add_indexes_and_integrity.sql` adds the four that were missing:

| Index                                                                  | Query it serves                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_products_active_created_at` (partial, `WHERE status = 'ACTIVE'`)  | The storefront's default "featured" sort: `ORDER BY created_at DESC` over active products. Migration 005 indexed `status` and `(status, category_id)` but never `created_at`, so the home page and an unfiltered collection sorted a full scan. |
| `idx_reviews_moderated_by` (partial, `WHERE moderated_by IS NOT NULL`) | Admin moderation filters.                                                                                                                                                                                                                       |
| `idx_inventory_transactions_created_by` (partial)                      | Ledger "who made this movement".                                                                                                                                                                                                                |
| `idx_carts_merged_into_cart_id` (partial)                              | The `ON DELETE SET NULL` FK from a merged guest cart; without an index, deleting a parent scans the whole child table.                                                                                                                          |

The storefront's listing predicate always carries `status = 'ACTIVE'`, so the
partial index can both match the filter and satisfy the sort. Confirmed present
by `backend/tests/database.hardening.test.js`.

The rest of the schema already carried the indexes the workload needs:
`idx_products_status_category_id`, `idx_products_brand`, `idx_reviews_product_id`
/ `(status, created_at DESC)`, `idx_carts_one_active_per_user/session`
(unique), `idx_orders_user_id` / `(created_at DESC)`, `idx_audit_logs_*`,
`idx_coupons_active_window`, and the FK indexes on order/cart/wishlist items.

### Avoiding N+1

The product listing is a **single statement**. A `LEFT JOIN LATERAL` computes
per-product variant aggregates (price min/max, purchasable count, total stock) and
a bounded image array (`CARD_IMAGE_COUNT = 2` — the card and its hover image, not
the full gallery). Rating average/count come from an aggregate join.
`count(*) OVER ()` produces the unpaginated total in the same pass, so paging
needs no second COUNT query and the UI never has to guess whether more pages
exist. No per-row query is issued to build a listing.

### Bounded pagination

Every list endpoint is capped, so no endpoint can be asked for the whole table:

| Surface                                                 | Default | Max |
| ------------------------------------------------------- | ------- | --- |
| General pagination (`PAGINATION`) — orders, admin lists | 20      | 100 |
| Storefront catalogue cards                              | 24      | 60  |

`limit` is coerced and clamped in the validator, not trusted from the client. The
related-products endpoint caps at 12 (default 4).

### Money and types

Money is `BIGINT` minor units throughout, so there is no floating-point
rounding work and comparisons are integer. Timestamps are `TIMESTAMPTZ`.

## Caching

The API is **default-deny** (`backend/src/middleware/cache.js`): every response
is `Cache-Control: no-store` unless a route opts in. That is a privacy control
first, but it also means caches never hold a stale, user-specific response.

Public, identical-for-everyone routes opt in explicitly:

| Route                                       | Header                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `/api/v1/products*` (`catalogue.routes.js`) | `public, max-age=60, stale-while-revalidate=120` |
| `/api/v1/categories`                        | `public, max-age=60, stale-while-revalidate=120` |
| `/api/v1/search`, `/search/suggest`         | `public, max-age=60, stale-while-revalidate=120` |

Sixty seconds is short enough that a price change reaches the storefront quickly
and long enough that a page view does not re-query the database on every
navigation. `stale-while-revalidate` lets the page paint from cache while one
request refreshes it in the background.

Serving the frontend from the backend in production is split deliberately
(`backend/src/app.js`):

- **HTML** → `Cache-Control: no-cache` (revalidate every navigation), so a
  deploy is visible immediately.
- **Everything else** (JS, CSS, images) → `public, max-age=3600`, with ETag /
  Last-Modified so a revalidation after the hour is a cheap `304`. The window is
  short on purpose because filenames are **not** content-hashed; a long
  `immutable` max-age would keep serving a stale bundle after a deploy.

Never cached: carts, wishlists, orders, profile, sessions, admin responses.

## HTTP layer

- **Compression** (`compression()`) is global, so JSON and text responses are
  gzipped.
- **Body size limit** is 100 kB for both JSON and urlencoded, which bounds the
  work a single request can force.
- **CORS preflight** is cached for 24 h (`maxAge: 86400`), so the browser does
  not re-ask on every call.

## Frontend

- **Deferred webfonts.** Each page links Google Fonts with `media="print"` and
  swaps to `media="all"` once loaded (`frontend/js/core/fonts.js`), so the font
  request never blocks first paint. The swap moved out of an inline `onload`
  handler to satisfy the CSP.
- **Lazy images.** Product cards, the gallery, search results and cart lines use
  `loading="lazy"`; the primary image is `eager` with `fetchpriority="high"`. A
  short circuit in `product-card.js` only eager-loads the first screenful, since
  eager-loading 24 images delays the ones actually visible.
- **IntersectionObserver, not scroll listeners.** `app.js` uses an
  `IntersectionObserver` for reveal-on-scroll, which runs off the main thread and
  avoids a per-scroll handler.
- **No third-party script.** The storefront ships no analytics or tracking
  snippet, so there is no blocking external JS.
- **Skeletons, not layout shift.** Loading states render fixed-size skeleton
  blocks, so content does not jump when data arrives (`components/feedback/`).

## How to profile locally

- **Query plans:** prefix a repository query with `EXPLAIN (ANALYZE, BUFFERS)`
  against a seeded database (`npm run migrate && npm run seed`) and check the
  listing, storefront sort and admin list queries use the indexes above rather
  than a `Seq Scan`.
- **Payload size:** inspect `Content-Encoding` and `Content-Length` on a
  `/api/v1/products?limit=60` response; compression should be present.
- **Frontend:** open DevTools → Network, sort by size, and confirm images are
  lazy below the fold and that no inline script is present (which would also be
  a CSP failure).

## Known gaps (Phase 12)

- Product imagery is seeded from an external placeholder host; real photography
  and image optimisation (responsive `srcset`, modern formats) are not done.
- Frontend JS is not bundled or minified — it is served as source modules.
- No production build step, so there is no content hashing (hence the short
  static cache window).
- The list endpoints have no keyset/cursor pagination; deep pages use
  `OFFSET`, which is fine at the current scale but degrades on very large
  offset values.
