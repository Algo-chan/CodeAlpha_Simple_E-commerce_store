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

| Path               | Planned responsibility                             |
| ------------------ | -------------------------------------------------- |
| `/api/v1/auth`     | Register, login, refresh, logout, password reset   |
| `/api/v1/cart`     | Add/update/remove items, totals                    |
| `/api/v1/wishlist` | Add/remove/list saved products                     |
| `/api/v1/orders`   | Checkout, order history, order status              |
| `/api/v1/payments` | Cash on Delivery, online payment intents, webhooks |
| `/api/v1/reviews`  | Create, moderate, aggregate ratings                |
| `/api/v1/users`    | Profile, addresses, password                       |
| `/api/v1/admin`    | Dashboard, products, inventory, coupons, analytics |

Note that reading a product's reviews is implemented above; _writing_ one is not,
because it needs an account.

Planned route shapes (for reference, not implemented):

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
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
repository.

## Authentication (design)

- `POST /auth/login` returns an access token (short-lived) and a refresh token.
- Access token: sent as `Authorization: Bearer <token>`; verified by
  `middleware/auth.js`.
- Role-based access: `authorize(ROLES.ADMIN)` on admin routes; roles are
  `CUSTOMER`, `ADMIN`, and `SELLER` (reserved).
- Refresh tokens are stored hashed server-side and rotated on use.

This design is prepared in code but **not implemented** — the middleware returns
`501 NOT_IMPLEMENTED` until the user system exists.
