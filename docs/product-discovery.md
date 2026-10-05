# Product Discovery

How the catalogue, search, category and product-detail endpoints work, and the
decisions behind them. Read this before adding an endpoint or changing a query.

## Shape of the surface

All read-only, all public, all under `/api/v1`.

| Method | Path                      | Purpose                                             |
| ------ | ------------------------- | --------------------------------------------------- |
| GET    | `/products`               | Filtered, sorted, paged listing with facets         |
| GET    | `/products/:slug`         | Detail payload, plus related rail by default        |
| GET    | `/products/:slug/reviews` | Approved reviews, paged                             |
| GET    | `/products/:slug/related` | Related rail on its own                             |
| GET    | `/categories`             | Nested tree (`?flat=1` for rows, `?includeEmpty=0`) |
| GET    | `/categories/:slug`       | Category node plus its scoped listing               |
| GET    | `/search`                 | Results page                                        |
| GET    | `/search/suggest`         | Predictive hits for the overlay                     |

No write method is routed on any of them. Cart, wishlist, orders, payments, reviews
writes and admin are still 501 placeholders — an endpoint that genuinely does not
exist should say so rather than pretend.

## Layers

```
route  ->  validateRequest(schema)  ->  controller  ->  service  ->  repository  ->  SQL
```

Each layer refuses to do the next one's job.

- **Route** declares the path, the schema and the cache header. Order matters:
  static segments are declared before parameterised ones.
- **`validateRequest`** coerces and validates, then replaces the raw values. A
  controller never sees an unvalidated number.
- **Controller** reads the validated request, calls the service, writes a status
  code. A product decision in a controller is in the wrong layer.
- **Service** decides _what_ the answer is, resolves slugs to ids, assembles the
  envelope, runs independent reads with `Promise.all`.
- **Repository** owns SQL and returns raw rows. It knows about `purchasable`, not
  about the storefront.

The split that matters most: **the repository never decides what a shopper should
see.** `status = 'ACTIVE'` is the only visibility rule that lives in SQL.

## The envelope

Success:

```json
{ "success": true, "data": {} }
```

Failure, from the central error handler:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": { "errors": [] } }
}
```

The frontend branches on `success`. `httpResponse.success` and `errorHandler`
already agree on this shape, so no route handler builds it by hand.

Catalogue responses send `Cache-Control: public, max-age=60,
stale-while-revalidate=120`. Public is safe precisely because nothing in this
surface is per-user — no cart, no account, no wishlist.

## Listing payload

```jsonc
{
  "products": [/* listing view models */],
  "pagination": {
    "page": 1,
    "limit": 24,
    "total": 8,
    "total_pages": 1,
    "has_more": false,
    "has_previous": false,
    "from": 1,
    "to": 8,
  },
  "facets": { "brands": [], "categories": [], "product_types": [], "attributes": [] },
  "applied_filters": { "categories": ["fashion"], "category_ids": ["..."] },
  "sort": "featured",
  "total": 8,
}
```

`facets` is `null` when `includeFacets=0`, which is what a filter change wants:
the panel already holds the counts and recounting them per keystroke is the most
expensive thing this endpoint could do.

`applied_filters` echoes slugs, not ids. A shopper recognises "shoes"; a UUID in a
"showing results for" line means nothing to them.

## Availability: the distinction everything turns on

`stock` is **either `null` or an object.** Never `0`.

| Case                  | `stock`             | `is_purchasable` | Badge         |
| --------------------- | ------------------- | ---------------- | ------------- |
| Digital, no inventory | `null`              | `true`           | none          |
| Physical, 10 units    | `{ available: 10 }` | `true`           | none          |
| Physical, 10 reserved | `{ available: 0 }`  | `false`          | `sold-out`    |
| No variants at all    | `null`              | `false`          | `unavailable` |

Collapsing `null` and `0` marks every download sold out. A product with no variant
rows is not "sold out" — that is a claim about inventory the data does not support,
so it reports `unavailable` and a null price instead.

`is_listable` is **independent of purchasability**. A sold-out product stays in the
grid: hiding it makes a shopper conclude the shop does not stock it, when the truth
is it is temporarily out of stock.

## Editorial fields

Four fields the storefront reads with no column behind them.

| Field           | Value                   | Why                                                                   |
| --------------- | ----------------------- | --------------------------------------------------------------------- |
| `is_featured`   | always `false`          | No merchandising flag exists. "Featured" would be a fabricated claim. |
| `is_new`        | `created_at` within 30d | Recency is a fact.                                                    |
| `display_order` | always `0`              | No hand-set rank exists. `0` sorts honestly instead of arbitrarily.   |

They are emitted rather than omitted because a missing key reads as "undecided" in
the UI, while `false` and `0` read as "decided".

`sort=featured` therefore means newest-first. That is a placeholder ranking, not a
merchandising one, and it is the first thing to change when a real flag ships.

## Filtering

| Parameter             | Shape                               | Notes                                    |
| --------------------- | ----------------------------------- | ---------------------------------------- |
| `category`            | repeatable or comma-separated slugs | Expands to the whole subtree             |
| `brand`               | repeatable or comma-separated       |                                          |
| `productType`         | repeatable, enum                    | `PHYSICAL` / `DIGITAL` / `SERVICE`       |
| `minPrice` `maxPrice` | integer minor units                 | No floats. Crossed ranges are a 422.     |
| `availability`        | `in_stock` / `out_of_stock`         |                                          |
| `attr.<key>`          | repeatable or comma-separated       | e.g. `attr.color=Black&attr.color=White` |
| `sort`                | enum, see below                     |                                          |
| `page` `limit`        | integers                            | `limit` capped at 60                     |
| `includeFacets`       | `0` / `1`                           |                                          |

**Sort keys are the frontend spellings:** `featured`, `newest`, `price-asc`,
`price-desc`, `name-asc`, `name-desc`. Not `price_asc`. The UI's vocabulary is the
contract; renaming the keys server-side to match an internal style would push a
translation into every caller.

**OR within an attribute key, AND across keys.** `attr.color=Black&attr.color=White`
is "black or white", because a shopper ticking two swatches means either. Adding
`attr.size=40` narrows further, because they also chose a size.

**`null` versus `[]` is load-bearing.** A missing `category` means "no filter";
`category_ids: []` means "the filter matched nothing" and must return zero rows.
Testing `.length` collapses both, and a deleted category link then returns the entire
shop — a silent, confident, completely wrong answer.

Every rejected query returns 422 with per-field errors rather than being silently
clamped. A filter that quietly ignores what you asked for is worse than a refusal.

### Facets

Each facet is counted with every **other** dimension applied but its own omitted.
Tick "Nike" and the brands panel still shows Adidas would return 4, instead of every
other brand collapsing to zero the moment one is selected.

## Search

`ILIKE` with an explicit `ESCAPE`, one escaped pattern bound per word and reused
across every column. Requirements:

- Every word must match something. "max black" must not return every black product
  on the strength of "max".
- `%`, `_` and `\` in the term are **literal**. Without escaping, `?q=%` matches
  everything and the search box becomes a catalogue dump while looking like it
  worked.
- Variant attributes are searched, at the weakest rank. "black" lives only in a
  variant attribute; a search that cannot find it while the filter panel offers it
  is incoherent.
- Category names are searched, so "shoes" offers the Shoes category.

Ranking is field-weighted `CASE` — exact name, prefix, slug, SKU, name mention,
brand, attribute — not a search engine. Contained in one function so swapping in
`ts_rank` or a trigram index is a change to one place.

## Category pages

`GET /categories/:slug` validates in **two stages**: the path slug first, then a
query schema built from that slug. The query schema injects the category filter,
because a category page is a listing scoped to a subtree.

A client sending `?category=shoes` on `/categories/electronics` is overridden, not
rejected. The path is the resource; a query parameter cannot relocate it.

An unknown **category filter** on `/products` gives zero results, not a 404 — a
stale link should say "nothing matches". An unknown category **path** is a 404,
because there the category is the resource.

## Related products

Tiers, in preference order:

1. same category
2. sibling categories (sharing a parent)
3. anywhere in the catalogue

Same-brand products are lifted _within_ a tier, never across one. Falling back to the
whole catalogue is deliberate: a leaf category holding one product would otherwise
render an empty rail, which is a visible hole in the page.

Related rows are **listing view models**, so a related card renders through the same
`ProductCard` as a grid row. One card component, no drift.

## Money

Integer minor units (ETB cents) end to end. `services/money.js` divides by nothing
and accepts no float price.

`discountPercent` divides by the **compare-at** price. "Was 10,000, now 7,500" is
25%. Dividing by the sale price gives 33% — true as a ratio, wrong as an "off", and
easy to miss because the result is still a plausible integer. Rounded **down**, so a
saving is never overstated.

No discount is `null`, not `0`, so a badge can be rendered from truthiness.

`MAX_PRICE_MINOR` (10 billion ETB) matches the `product_variants_price_sane` check
from migration 007. `?minPrice=` beyond it is a 422 rather than a `BIGINT`
comparison the database has to defend.

## Reviews

Read-only. Creating a review needs an account, and exposing a POST would mean
accepting an unverified author.

Verified-purchase is **derived server-side** from a delivered order line. The UI
never decides it.

`reviewer_name` → `author` and `comment` → `body` in `catalogue.view.js`. The SQL
speaks the schema's language; the view model speaks the UI's. A column rename is a
repository edit; a UI redesign is a view edit.

Reviews never carry `user_id` or the reviewer's email. `status` is emitted even
though the query filters to `APPROVED`, because the UI re-filters on it and relying
on a missing field to pass is leaving meaning to chance.

## Testing

```bash
npm run test:backend        # 191 tests
node --test tests/catalogue.api.test.js         # HTTP, whole stack
node --test tests/catalogue.repository.test.js  # pure layer, no DB
```

`catalogue.api.test.js` runs the real Express app against PGlite — routing,
validation, service, SQL and the error envelope together. A service-level test passes
while `?page=0` returns 500; only a request catches that.

`catalogue.repository.test.js` covers what a query cannot: the `null`/`[]`
distinction, LIKE escaping, integer money, and NULL stock. Each has a paired test
that fails only when that specific mistake is made.

`createApp({ db })` attaches an executor as `req.db`. Without it the repositories
fall back to the `pg` pool, so the indirection is what makes this layer testable at
all.

## Known limitations

- **No editorial ranking.** `sort=featured` is newest-first; `is_featured` is always
  false. A real merchandising flag is the first schema change Phase 6 should make.
- **No image angles.** There is no `angle` column and no separate thumbnail URL, so
  `angle` is null, `thumb_url` reuses the full URL, and the gallery labels
  thumbnails by position. Inventing "Front / Side / Back" from an index would be a
  claim about the photograph that the database does not make.
- **Search is `ILIKE`.** Correct and dependency-free, but no trigram index, so a very
  large catalogue would want one.
- **Facets are exact counts.** They do not narrow as a shopper types in a facet box.
- **`is_new` on seed data.** The seed inserts every product at once, so all of it
  reads as new in a test database. Real data has real `created_at` values.
