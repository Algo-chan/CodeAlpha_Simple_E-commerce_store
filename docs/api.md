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

| Code                    | HTTP | Meaning                              |
| ----------------------- | ---- | ------------------------------------ |
| `VALIDATION_ERROR`      | 422  | Request failed schema validation     |
| `BAD_REQUEST`           | 400  | Malformed request                    |
| `UNAUTHORIZED`          | 401  | Missing or invalid credentials       |
| `FORBIDDEN`             | 403  | Authenticated but not allowed        |
| `NOT_FOUND`             | 404  | Route or resource does not exist     |
| `CONFLICT`              | 409  | Duplicate key / uniqueness violation |
| `UNPROCESSABLE_ENTITY`  | 422  | Semantically invalid data            |
| `RATE_LIMITED`          | 429  | Too many requests                    |
| `NOT_IMPLEMENTED`       | 501  | Endpoint is a planned placeholder    |
| `SERVICE_UNAVAILABLE`   | 503  | Dependency unavailable               |
| `INTERNAL_SERVER_ERROR` | 500  | Unexpected server error              |

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

## Planned endpoints (mounted, return 501)

These paths exist so the URL surface and CORS behaviour are testable today.
Every method on them answers:

```json
{
  "success": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Cart API is not implemented yet."
  }
}
```

| Path               | Planned responsibility                                     |
| ------------------ | ---------------------------------------------------------- |
| `/api/v1/cart`     | Add/update/remove items, totals                            |
| `/api/v1/wishlist` | Add/remove/list saved products                             |
| `/api/v1/orders`   | Checkout, order history, order status                      |
| `/api/v1/payments` | Cash on Delivery, online payment intents, webhooks         |
| `/api/v1/reviews`  | Create, moderate, aggregate ratings                        |
| `/api/v1/users`    | User administration (profile/addresses live under `/auth`) |
| `/api/v1/admin`    | Dashboard, products, inventory, coupons, analytics         |

Note that reading a product's reviews is implemented above; _writing_ one is not,
because it needs an account.

Planned route shapes (for reference, not implemented):

```
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/:id
DELETE /api/v1/cart/items/:id
POST   /api/v1/reviews
POST   /api/v1/orders            (checkout)
GET    /api/v1/orders
GET    /api/v1/orders/:id
GET    /api/v1/admin/analytics/overview
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
