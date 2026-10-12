# API Reference (v1)

Base URL (development): `http://localhost:4000/api/v1`

## Conventions

- All requests and responses are `application/json`.
- Requests use HTTP verbs meaningfully: `GET` reads, `POST` creates, `PUT`
  replaces, `PATCH` updates partially, `DELETE` removes.
- List endpoints will accept `?page=&limit=&sort=&order=&search=` (see
  `paginationSchema` in `backend/src/validators/common.schema.js`).
- Resource URLs are plural nouns (`/products`, `/orders`).
- Dates are ISO 8601 strings (`2026-01-31T12:00:00.000Z`).
- Money is sent as integer minor units (e.g. `1999` = 19.99) plus an ISO
  currency code — never as floats.

## Response envelope

Success:

```json
{
  "success": true,
  "data": {}
}
```

Optional `message` and `meta` (pagination) keys may accompany `data`.

Error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

`error.details` may contain field-level validation errors (development only).

## Error codes

| Code                        | HTTP | Meaning                                      |
| --------------------------- | ---- | -------------------------------------------- |
| `VALIDATION_ERROR`          | 422  | Request failed schema validation             |
| `BAD_REQUEST`               | 400  | Malformed request                            |
| `UNAUTHORIZED`              | 401  | Missing or invalid credentials               |
| `FORBIDDEN`                 | 403  | Authenticated but not allowed                |
| `NOT_FOUND`                 | 404  | Route or resource does not exist             |
| `CONFLICT`                  | 409  | Duplicate key / uniqueness violation         |
| `UNPROCESSABLE_ENTITY`      | 422  | Semantically invalid data                    |
| `RATE_LIMITED`              | 429  | Too many requests                            |
| `NOT_IMPLEMENTED`           | 501  | Endpoint is a planned placeholder            |
| `SERVICE_UNAVAILABLE`       | 503  | Dependency unavailable                       |
| `INTERNAL_SERVER_ERROR`     | 500  | Unexpected server error                      |
| `PAYMENT_NOT_REQUIRED`      | 409  | A COD order cannot start online payment      |
| `DELIVERY_UNAVAILABLE`      | 422  | The destination is outside delivery areas    |
| `INVALID_STATUS_TRANSITION` | 422  | An order status change the lifecycle forbids |

## Implemented endpoints

### `GET /api/v1/health`

Verifies the API process and the PostgreSQL connection. A database failure is
reported, never thrown.

```bash
curl http://localhost:4000/api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "api": "healthy",
    "database": "connected",
    "environment": "development",
    "timestamp": "2026-01-31T12:00:00.000Z",
    "uptime": 128
  }
}
```

`status` is `healthy` when PostgreSQL answers and `degraded` when it does not.

### `GET /`

Service banner: name, API version, health path.

## Catalogue endpoints (implemented)

Read-only and public. Full contracts, filter semantics and the reasoning behind the
availability and money rules are in
[product-discovery.md](./product-discovery.md).

| Method | Path                             |
| ------ | -------------------------------- |
| GET    | `/api/v1/products`               |
| GET    | `/api/v1/products/:slug`         |
| GET    | `/api/v1/products/:slug/reviews` |
| GET    | `/api/v1/products/:slug/related` |
| GET    | `/api/v1/categories`             |
| GET    | `/api/v1/categories/:slug`       |
| GET    | `/api/v1/search`                 |
| GET    | `/api/v1/search/suggest`         |

Listing query parameters: `category`, `brand`, `productType`, `minPrice`,
`maxPrice`, `availability`, `attr.<key>`, `sort`, `page`, `limit`, `q`,
`includeFacets`. Repeated and comma-separated parameters are both accepted.

Sort keys are `featured`, `newest`, `price-asc`, `price-desc`, `name-asc`,
`name-desc`. Anything else is a 422.

Responses send `Cache-Control: public, max-age=60, stale-while-revalidate=120`.
Public is safe because nothing in this surface is per-user.

A malformed parameter is a 422 with per-field errors, never a silent clamp:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": {
      "errors": [
        {
          "field": "page",
          "message": "page must be 1 or more",
          "code": "too_small",
          "source": "query"
        }
      ]
    }
  }
}
```

## Authentication endpoints (implemented)

Identity is a session cookie, not a token. Registration and login exchange
credentials for `Set-Cookie: ecom_session=...` (`HttpOnly`, `SameSite=Lax`,
`Path=/`, `Max-Age` from `SESSION_TTL_HOURS`). The cookie value is an opaque
random token; the server persists only its SHA-256 hash, so a database dump
leaks nothing usable. Sessions are revoked at logout and by a password change
(the latter also revokes every other session). There is deliberately no
access/refresh-token pair and no `/refresh` endpoint.

Passwords are hashed with bcrypt. An unknown email and a wrong password both
answer 401 `UNAUTHORIZED` with the same message, so sign-in never confirms which
accounts exist. There is no email verification or password reset yet.

| Method | Path                                 | Auth    | Purpose                                          |
| ------ | ------------------------------------ | ------- | ------------------------------------------------ |
| POST   | `/api/v1/auth/register`              | public  | Create an account; sets a session                |
| POST   | `/api/v1/auth/login`                 | public  | Sign in; sets a session                          |
| POST   | `/api/v1/auth/logout`                | public  | Revoke the session and clear the cookie          |
| GET    | `/api/v1/auth/me`                    | session | Resolve the session to a user                    |
| PATCH  | `/api/v1/auth/profile`               | session | Update `name` / `phone`                          |
| POST   | `/api/v1/auth/password`              | session | Change password (revokes every other session)    |
| GET    | `/api/v1/auth/addresses`             | session | List addresses, default first                    |
| POST   | `/api/v1/auth/addresses`             | session | Create an address; the first becomes the default |
| PATCH  | `/api/v1/auth/addresses/:id`         | session | Edit an address                                  |
| DELETE | `/api/v1/auth/addresses/:id`         | session | Delete; default promotes the oldest remaining    |
| POST   | `/api/v1/auth/addresses/:id/default` | session | Make this address the single default             |

Registration body: `name` (min 2), `email` (lowercased), `phone`
(`^\+?[0-9]{9,15}$`), `password` (8+ characters plus lowercase, uppercase, digit
and symbol), `passwordConfirmation`. Login body: `email`, `password`. Password
change body: `currentPassword`, `newPassword`, `newPasswordConfirmation`.

Register and login sit behind a stricter per-IP limiter. Every mutating auth
call also requires `requireSameOrigin` (SameSite=Lax plus an `Origin` check
against the configured frontend origins), so a cross-site form can never drive a
signed-in browser into a state change. A suspended account cannot log in and
answers 403 `FORBIDDEN`.

A user serialises as `{ id, name, email, phone, role, status, last_login_at,
password_changed_at, created_at, updated_at }`; privileged fields are stripped
in the service. Register answers 201 `{ data: { user } }`; login, `/me` and
profile return `{ data: { user } }`; password change returns a message and no
`data`. Addresses return `{ data: { addresses } }` (each with `is_default`) and
address mutations `{ data: { address } }`. `/me` with a missing, forged or
expired cookie is a plain 401 — the storefront reads that as "guest", not
"error".

## Checkout & orders (implemented)

Checkout is transactional: the order and its lines, its payment record, the
stock deduction and the ledger entries either all commit or none do. Prices,
totals, statuses and the owning user are computed inside that transaction and
never read from the request — the body carries fulfilment details only.

| Method | Path                          | Auth     | Purpose                           |
| ------ | ----------------------------- | -------- | --------------------------------- |
| POST   | `/api/v1/checkout`            | optional | Place an order from the cart      |
| GET    | `/api/v1/orders`              | session  | The caller's orders, newest first |
| GET    | `/api/v1/orders/:orderNumber` | session  | One order, scoped to its owner    |

`POST /checkout` accepts a flat body, matching the address book the customer has
already used: `full_name`, `email`, `phone`, `label`, `city`, `area`, `street`,
`landmark`, `additional_notes`, `customer_notes`, `payment_method`.
`payment_method` is `COD` (default) or `ONLINE`; `city`, `area` and `street` are
required. A guest must supply `full_name`, `email` and `phone`; a signed-in
customer may omit them and the account's values are used. An `ONLINE` order is
created `PENDING` with the configured provider and stays `PENDING` until a
verified notification arrives — checkout never asserts that money moved.

The cart is identified exactly as the cart layer identifies it: the session user
when present, otherwise the `ecom_cart` cookie. Identity never comes from the
body. On success the response is 201 with the finished order (the confirmation
payload) and the cart is emptied; the cart cookie survives, so the next visit
starts from an empty basket rather than a new guest.

An order serialises as `{ orderNumber, status, paymentStatus, paymentMethod,
currency, subtotal, deliveryFee, discountTotal, total, itemCount, items,
customer, shippingAddress, customerNotes, payment, placedAt, updatedAt }`, with
no internal ids. `items` carry purchase-time snapshots (`productName`, `sku`,
`variantAttributes`, `unitPrice`, `quantity`, `subtotal`). Order history is
`{ data: { orders }, meta: { pagination } }`, where each order is the same shape
minus payment detail; it is scoped by the session user in SQL, so another
customer's order reads as a 404 rather than a 403.

Failures on checkout:

| Code                  | HTTP | When                                                 |
| --------------------- | ---- | ---------------------------------------------------- |
| `CART_EMPTY`          | 409  | The cart is empty or missing                         |
| `PRODUCT_UNAVAILABLE` | 409  | A line's product is not `ACTIVE` or its variant off  |
| `INSUFFICIENT_STOCK`  | 409  | A line exceeds available stock (`details` closes it) |
| `SERVICE_UNAVAILABLE` | 503  | The day's order numbers are exhausted                |

`GET /api/v1/orders` paginates via `?page=&limit=` (default 20, max 100). Order
detail is addressed by the human-readable `orderNumber`, never a UUID.

## Payments (implemented)

Online payment flows through three surfaces. COD still starts and ends at
checkout — it never touches this layer.

| Method | Path                                 | Auth    | Purpose                                      |
| ------ | ------------------------------------ | ------- | -------------------------------------------- |
| POST   | `/api/v1/payments`                   | session | Create a payment intent for one of my orders |
| GET    | `/api/v1/payments/methods`           | public  | Which providers are configured (no secrets)  |
| POST   | `/api/v1/payments/webhook/:provider` | signed  | Gateway callback; verified by signature      |

### Initiation — `POST /api/v1/payments`

Body: `{ "order_number": "ORD-YYYYMMDD-NNNN" }`. The order must belong to the
signed-in shopper (a stranger's order is a 404), must have been checked out
with `payment_method: ONLINE` (a COD order is 409 `PAYMENT_NOT_REQUIRED`), and
must not already be settled (409 `CONFLICT`). Stale PENDING attempts on the
order are expired first. When `PAYMENT_PROVIDER=NONE` or the configured provider
is not online, this answers 503 `SERVICE_UNAVAILABLE`.

The response is 201 with the intent plus where to send the shopper:

```json
{
  "success": true,
  "data": {
    "payment": {
      "orderNumber": "ORD-20261011-0001",
      "provider": "MOCK",
      "method": "ONLINE",
      "status": "PENDING",
      "amount": 150000,
      "currency": "ETB",
      "reference": "MOCK-…",
      "paidAt": null,
      "failureReason": null
    },
    "nextAction": { "type": "redirect", "url": "…" },
    "sandbox": true
  }
}
```

`reference` is the provider's transaction id, stored so the webhook can find the
row. `MOCK` is the sandbox adapter enabled by `PAYMENT_PROVIDER=MOCK`; naming
`TELEBIRR`/`STRIPE`/`PAYSTACK` in that variable is how a real gateway is switched
on (with an adapter added under `backend/src/payments/`).

### Settlement — `POST /api/v1/payments/webhook/:provider`

The provider posts a signed JSON notification. The server:

1. **verifies the signature** over the **raw request body** (`x-payment-signature`
   is HMAC-SHA256 of `` `${x-payment-timestamp}.${body}` `` using
   `PAYMENT_WEBHOOK_SECRET`; timestamps older than
   `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` are rejected) — 401 on mismatch,
   so a forged gateway cannot settle anything;
2. **resolves the payment row** by the claimed transaction reference — an unknown
   transaction is 404;
3. **cross-checks** the amount and currency against the store's own order total
   (422 `VALIDATION_ERROR` on mismatch, `details` says what was expected);
4. **settles atomically** inside a transaction: the payment row moves
   `PENDING → PAID/FAILED` (with `paid_at` for PAID, `failure_reason` for FAILED)
   and the order's `payment_status` follows it. A PAID online order also advances
   `status` to `CONFIRMED` — the single point where a payment confirms an order.

Replays are idempotent: an already-settled status is a 200 with
`"duplicate": true` and touches nothing, and the partial unique index on
`transaction_reference` makes two payment rows for one transaction impossible.
A FAILED notification leaves the order `PENDING` so the shopper can start a fresh
intent, which gets a new reference and is settled on its own merits.

Payment states: `PENDING`, `PAID`, `FAILED`, `REFUNDED` (refunds declared but not
executable yet — the provider contract exposes the capability, `refundPayment`
answers 501 `NOT_IMPLEMENTED`). Stale PENDING intents are expired as FAILED after
`PAYMENT_PENDING_TIMEOUT_MINUTES` (exposed as `expireStalePending` on the service
for a future scheduled job).

### Delivery estimates

The delivery rules stay config-driven in `backend/src/services/delivery.service.js`
(`DELIVERY` in `constants.js`): a flat `DEFAULT_FEE_MINOR` waived at or above
`FREE_THRESHOLD_MINOR`, an ordered `ZONES` list that a future per-area tariff can
populate with fees, ETA windows (`etaMinDays`/`etaMaxDays`) and an `available`
flag, and a default 2–5 day window. Every order view carries the derived estimate
as `delivery: { zone, available, fee, estimatedDelivery, estimatedDeliveryDays }`.

## Reviews (implemented)

Reading a product's published reviews is public (see the catalogue surface
above). Writing one needs an account, because a review must be anchored to a
purchase that can be proved.

| Method | Path                         | Auth    | Purpose                                   |
| ------ | ---------------------------- | ------- | ----------------------------------------- |
| GET    | `/api/v1/reviews/reviewable` | session | The caller's delivered, un-reviewed lines |
| POST   | `/api/v1/reviews`            | session | Submit a review for one purchased line    |

A review is EARNED, not asserted. The submit body is `{ order_item_id, rating,
title?, comment? }`; `rating` is a whole number 1–5, and at least one of `title`
or `comment` must be non-blank. There is no `product_id` field — the product is
derived from the purchased line, so a review can never be aimed at something the
customer did not buy.

Eligibility is the predicate from migration 017: the line belongs to the
signed-in reviewer (`orders.user_id`), the order is `DELIVERED`, and the line has
not already been reviewed. A guest order has `user_id NULL` and can never
qualify. Anything else is 422 `REVIEW_NOT_ELIGIBLE`. Duplicates are refused with
409 `REVIEW_ALREADY_SUBMITTED` — once per purchase line and once per product per
customer, mirroring the two unique constraints.

A new review is ALWAYS created `PENDING` moderation, so it does not appear on the
public product read or count towards the average until an administrator approves
it through `/admin/reviews/:id/status`. `reviewable` returns
`{ items: [{ orderItemId, product: { id, name, slug }, variantLabel, orderNumber,
purchasedAt }] }`, newest purchase first.

## Admin endpoints (implemented)

The store-management surface. The whole tree sits behind one gate — mounted on
the router, so every path beneath `/admin` inherits it and no endpoint can be
added without it:

```
authenticate            a valid session cookie resolves an ACTIVE user, or 401
authorize(ADMIN)        that user's role is ADMIN, or 403
requireSameOrigin       a state-changing call carries a same-origin Origin
```

A CUSTOMER who calls any of these by hand is stopped by `authorize` before the
controller runs; hiding the UI is a courtesy, never the boundary. Responses reuse
the standard envelope (`{ success, data }`, with `meta.pagination` on lists), and
money stays in minor units.

| Method | Path                                        | Responsibility                                                     |
| ------ | ------------------------------------------- | ------------------------------------------------------------------ |
| GET    | `/api/v1/admin/dashboard`                   | Orders, revenue, products, low stock, customers                    |
| GET    | `/api/v1/admin/products`                    | List (filter: `status`, `productType`, `categoryId`, `search`)     |
| POST   | `/api/v1/admin/products`                    | Create a product                                                   |
| GET    | `/api/v1/admin/products/:id`                | One product                                                        |
| PATCH  | `/api/v1/admin/products/:id`                | Update a product                                                   |
| POST   | `/api/v1/admin/products/:id/archive`        | Archive (never hard-delete)                                        |
| GET    | `/api/v1/admin/products/:id/variants`       | List variants                                                      |
| POST   | `/api/v1/admin/products/:id/variants`       | Create a variant                                                   |
| PATCH  | `/api/v1/admin/variants/:variantId`         | Update a variant                                                   |
| DELETE | `/api/v1/admin/variants/:variantId`         | Deactivate a variant                                               |
| GET    | `/api/v1/admin/products/:id/images`         | List images                                                        |
| POST   | `/api/v1/admin/products/:id/images`         | Add an image by URL                                                |
| PATCH  | `/api/v1/admin/images/:imageId`             | Update an image                                                    |
| DELETE | `/api/v1/admin/images/:imageId`             | Remove an image                                                    |
| GET    | `/api/v1/admin/categories`                  | List categories + tree                                             |
| POST   | `/api/v1/admin/categories`                  | Create a category                                                  |
| GET    | `/api/v1/admin/categories/:id`              | One category                                                       |
| PATCH  | `/api/v1/admin/categories/:id`              | Update a category                                                  |
| POST   | `/api/v1/admin/categories/:id/archive`      | Archive a category                                                 |
| GET    | `/api/v1/admin/inventory`                   | List stock (filter: `search`, `lowStock`)                          |
| GET    | `/api/v1/admin/inventory/:variantId/ledger` | Movement ledger for a variant                                      |
| POST   | `/api/v1/admin/inventory/:variantId/adjust` | Restock / return / damage / adjustment                             |
| PATCH  | `/api/v1/admin/inventory/:variantId`        | Set the reorder level                                              |
| GET    | `/api/v1/admin/orders`                      | List (filter: `status`, `paymentStatus`, `search`)                 |
| GET    | `/api/v1/admin/orders/:orderNumber`         | One order (addressed by number, not id)                            |
| PATCH  | `/api/v1/admin/orders/:orderNumber/status`  | Move to an allowed status                                          |
| GET    | `/api/v1/admin/customers`                   | List (filter: `status`, `role`, `search`)                          |
| GET    | `/api/v1/admin/customers/:id`               | One customer (no auth material)                                    |
| PATCH  | `/api/v1/admin/customers/:id/status`        | Suspend / reactivate                                               |
| GET    | `/api/v1/admin/reviews`                     | List (filter: `status`)                                            |
| GET    | `/api/v1/admin/reviews/:id`                 | One review                                                         |
| PATCH  | `/api/v1/admin/reviews/:id/status`          | Moderate; author content is never edited                           |
| GET    | `/api/v1/admin/payments`                    | List (filter: `status`, `method`, `provider`)                      |
| GET    | `/api/v1/admin/payments/:id`                | One payment (no provider secrets)                                  |
| GET    | `/api/v1/admin/audit-logs`                  | Sensitive-action trail (filter: `entityType`, `action`, `actorId`) |

Decisions worth recording:

- **Archive, do not delete.** Products, categories and variants are archived or
  deactivated so historical orders still resolve. There is no DELETE for a
  product or category.
- **Images are URLs.** `image_url` is a text field; the console adds one by URL.
  There is no multipart upload. Setting a new primary image promotes it in the
  same transaction.
- **Inventory is append-only.** Every manual change writes an
  `inventory_transactions` row whose type fixes the sign (RESTOCK/RETURN add,
  DAMAGE removes, ADJUSTMENT is signed); an adjustment that would drive stock
  negative is rejected 422. Cancelling an order restocks each tracked line and
  writes a `RETURN` row.
- **Orders follow a graph.** `PENDING → CONFIRMED|CANCELLED`,
  `CONFIRMED → PROCESSING|CANCELLED`, `PROCESSING → SHIPPED|CANCELLED`,
  `SHIPPED → DELIVERED`; `DELIVERED` and `CANCELLED` are terminal. Anything else
  is 422 `INVALID_STATUS_TRANSITION`, and resending the same status is 422.
- **No secrets in views.** Customer payloads never carry `password_hash` or
  session data; a staff account cannot be suspended.
- **Audit foundation.** Sensitive actions (product/variant/image/category edits,
  inventory adjustments, order/customer/review status changes) append an
  `audit_logs` row, readable through `/admin/audit-logs`.

## Planned endpoints (mounted, return 501)

These paths exist so the URL surface and CORS behaviour are testable today.
Every method on them answers:

```json
{
  "success": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Users API is not implemented yet."
  }
}
```

| Path            | Planned responsibility                                     |
| --------------- | ---------------------------------------------------------- |
| `/api/v1/users` | User administration (profile/addresses live under `/auth`) |

Planned route shapes (for reference, not implemented):

```
GET  /api/v1/users
POST /api/v1/users/:id/suspend
```

Each will follow the same layering: route → validation → controller → service →
repository. Account and address management is already live under `/auth` (see the
authentication section above); `/api/v1/users` is reserved for staff-side user
administration.

## Authentication (design choices)

The implementation lives in `backend/src/{controllers,services,middleware}/*auth*`
and `backend/src/utils/cookies.js`. The defaults it chose over the earlier
token sketch:

- **Session cookie, no JWT.** `ecom_session` holds an opaque random token; the
  server keeps only its SHA-256 hash. A leaked database cannot mint sessions, a
  leaked header cannot be replayed after revoke, and there is no refresh-token
  rotation to get wrong.
- **Server-side revocation.** Logout deletes the row, so a stolen cookie stops
  working immediately; password change takes every other session with it.
- **`authenticate` fails closed.** Missing, malformed, expired, revoked or
  suspended sessions all answer 401/403; nobody is let through "just to see".
- **`authorize(ROLES.ADMIN, ...)`** for staff routes; roles are `CUSTOMER`,
  `ADMIN`, and `SELLER` (reserved).
- **CSRF defense** via SameSite=Lax plus `requireSameOrigin`, and a stricter
  per-IP limiter on the credential endpoints.
