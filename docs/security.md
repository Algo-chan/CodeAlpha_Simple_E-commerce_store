# Security

How the storefront and API defend themselves, what was reviewed in the Phase 11
hardening pass, and — importantly — which tradeoffs were accepted on purpose.

This is a working engineering document, not a compliance statement. Every claim
below points at the code that enforces it, so the reader can check the claim
rather than trust it.

## Threat model in one paragraph

The API is a single-origin JSON service consumed by a first-party vanilla-JS
storefront and a separate admin console. The assets worth protecting are
credentials, session cookies, a customer's own cart / wishlist / addresses /
orders / profile, and the admin surface (catalogue, inventory, orders, coupons,
customers, audit log). The trust boundary is the HTTP request: everything
outside it is untrusted, including headers, cookies, query strings, path
parameters, JSON bodies and provider webhooks. There is no server-rendered HTML
and no third-party script in the storefront, which is why a strict CSP is
practical here.

## Authentication and sessions

| Control                  | Implementation                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing         | `bcrypt` via `backend/src/services/password.js`; `BCRYPT_SALT_ROUNDS` defaults to 12 (env-clamped 4–15).                                      |
| Timing-attack resistance | `verifyPasswordTimingSafe` runs a dummy compare when the account does not exist, so "no such user" and "wrong password" take comparable time. |
| Credential error         | One message for both cases: `INVALID_CREDENTIALS_MESSAGE` = `Invalid email or password.`                                                      |
| Session token            | 32 random bytes (`crypto.randomBytes(32).toString('base64url')`) in the cookie; only the SHA-256 hash is stored (`user_sessions.token_hash`). |
| Cookie                   | `ecom_session`, `HttpOnly`, `SameSite=Lax`, `Secure` when the deployment is HTTPS, `Path=/`.                                                  |
| Session lifetime         | `SESSION_TTL_HOURS`, default 168 (7 days), enforced by `expires_at`.                                                                          |
| Logout                   | Deletes the session row for the presented token; idempotent (clears the cookie either way).                                                   |
| Logout everywhere        | `deleteAllForUser` revokes every other session — used on password change (`$2` excludes the current token).                                   |
| Suspension               | A suspended (`status != ACTIVE`) user does not resolve to `req.user`; the auth middleware fails closed.                                       |
| Brute force              | `authLimiter` on the credential endpoints (see the rate-limit table).                                                                         |

Sessions are server-side and opaque: the cookie is a bearer token whose value
has no meaning without the row it hashes to. Deleting the row is a real
revocation, which a stateless JWT could not offer as cheaply.

**Enumeration tradeoff (accepted):** registration returns `409` when an email is
already taken, which reveals that an account exists. Login does not leak. The
409 is kept because a "we sent you an email" flow does not exist yet, and
replacing a correct, actionable error with a vague one would hurt real users
without closing the hole (an attacker can also infer existence from the register
form regardless). The residual risk is documented under _Remaining risks_.

## Authorization

Every protected route is scoped; the boundary is server-side, never the UI.

- **Ownership scoping.** Cart, wishlist, addresses, profile, orders and reviews
  are all resolved from the authenticated session — `req.user.id` is the only
  source of identity. A customer-supplied `userId`, `cartId` or `orderId` is
  never trusted as an ownership claim.
- **Orders** are addressed by human-readable `orderNumber` and every query is
  scoped to the session user, so one customer cannot read another's order.
- **Admin surface.** All `/api/v1/admin/*` routes share one gate mounted once in
  `backend/src/routes/admin.routes.js`:
  `authenticate → authorize(ROLES.ADMIN) → requireSameOrigin`. Hiding an admin
  control in the UI is not a boundary; if the route exists it is gated.
- **Fail-closed.** `authenticate` returns 401 when no valid session resolves;
  `authorize` returns 403 when the role does not match.

Regression coverage lives in `backend/tests/admin.api.test.js`,
`backend/tests/cart.api.test.js`, `backend/tests/wishlist.api.test.js`,
`backend/tests/checkout.api.test.js` (which covers order read-back) and
`backend/tests/security.test.js`.

## Input validation

All external input is validated centrally before it reaches a handler, by
`validateRequest` (`backend/src/middleware/validate.js`) against Zod schemas.
Bodies use `.strip()` so unknown keys are dropped rather than mass-assigned;
this is the primary defence against over-posting (`role`, `status`,
`used_count`, `total`, …). Path parameters and query strings are coerced and
range-limited (see _Pagination_ below for the caps).

Money is an integer in **minor units** end to end. A price or total is never
read from a client payload; it is recomputed from the database at checkout.

## Cross-site scripting (XSS)

- The storefront renders user-generated content (review bodies, names, coupon
  codes) through the DOM API / `textContent`, not by interpolating strings into
  `innerHTML`.
- The production CSP forbids inline scripts and inline event handlers:
  `script-src 'self'` and `script-src-attr 'none'`. That is only possible
  because there is no inline `<script>` and no `on*=` attribute anywhere in
  `frontend/*.html` — a fact pinned by `frontend/tests/csp.test.js`.
- The deferred webfont swap that used to be an inline `onload` attribute now
  lives in `frontend/js/core/fonts.js` (`loadDeferredFonts`), preserving the
  loading behaviour without weakening the policy.

## Cross-site request forgery (CSRF)

Two independent layers:

1. **`SameSite=Lax`** on `ecom_session` — a cross-site form POST does not carry
   the cookie.
2. **`requireSameOrigin`** (`backend/src/middleware/csrf.js`) on state-changing
   routes (account, cart, wishlist, review, payment and admin). For unsafe
   methods it rejects a request whose `Origin` is neither the API's own host nor
   a configured frontend origin.

**Accepted tradeoff:** a request with **no** `Origin` header is allowed through,
because it is not browser-driven (curl, server-to-server). A browser always
sends `Origin` on unsafe cross-site requests, so this does not open a CSRF path
in practice; it does mean the check is defence-in-depth rather than the sole
gate.

## Rate limiting

All limiters are skipped when `NODE_ENV=test` so the suite can exercise logic
without tripping them; limits are configurable and apply to the production
window `RATE_LIMIT_WINDOW_MS` (default 15 minutes) per client IP.

| Limiter         | Default budget                | Window | Applied to                     |
| --------------- | ----------------------------- | ------ | ------------------------------ |
| `apiLimiter`    | 300 (`RATE_LIMIT_MAX`)        | 15 min | Every `/api/v1/*` request      |
| `authLimiter`   | 20 (`AUTH_RATE_LIMIT_MAX`)    | 15 min | Login, register                |
| `writeLimiter`  | 60 (`WRITE_RATE_LIMIT_MAX`)   | 15 min | Review submit, password change |
| `searchLimiter` | 200 (`SEARCH_RATE_LIMIT_MAX`) | 15 min | `/search`, `/search/suggest`   |

The write and search limiters are deliberately looser than the credential
limiter: a shopper may legitimately write several reviews, and type-ahead fires
per keystroke. The goal is to stop the endpoint being a free amplifier, not to
interrupt normal shopping. `app.set('trust proxy', 1)` lets the limiter see the
real client IP behind a single reverse proxy.

## Security headers and CSP

Helmet is mounted globally. In **production** the following are enforced
(`CSP_DIRECTIVES` in `backend/src/middleware/security.js`):

| Header / directive             | Value                                 | Why                                                          |
| ------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| `Content-Security-Policy`      | see below                             | Restrict script/style/img/connect origins                    |
| `Strict-Transport-Security`    | `max-age=31536000; includeSubDomains` | Force HTTPS                                                  |
| `X-Content-Type-Options`       | `nosniff`                             | No MIME sniffing                                             |
| `Referrer-Policy`              | `strict-origin-when-cross-origin`     | Limit referrer leakage                                       |
| `X-Frame-Options`              | `SAMEORIGIN`                          | Clickjacking (Helmet default; also `frame-ancestors 'self'`) |
| `Cross-Origin-Resource-Policy` | `cross-origin`                        | Allows the frontend to load images/media                     |

Content-Security-Policy (production):

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'self';
form-action 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https:;
img-src 'self' data: https:;
connect-src 'self' <configured API/frontend origins>;
manifest-src 'self';
worker-src 'self';
upgrade-insecure-requests
```

Why not stricter, and why not looser:

- `img-src https:` — product images are admin-entered absolute URLs and the seed
  data uses an external placeholder host; `'self' data:` alone breaks every
  product image.
- `style-src 'unsafe-inline'` — the design system sets per-element inline styles
  at runtime; without it the UI breaks. Script inline is still forbidden.
- `connect-src` includes `'self'` plus any configured API/frontend origin, so
  the same policy works both when the API serves the frontend and when it is a
  separate origin.

**CSP is disabled outside production.** The dev server runs over plain HTTP on
localhost and the test client does not execute the frontend, so enabling the
policy there adds only noise. `backend/tests/security.test.js` mounts the
production policy directly to assert it, rather than reading it off a dev
server.

## CORS

`corsOptions` allows only origins listed in `FRONTEND_URL` (comma-separated),
plus requests with no `Origin` (tooling / server-side). Credentials are enabled
because auth is cookie-based. An unknown origin is rejected with `403
FORBIDDEN` — verified by `backend/tests/security.test.js`.

## Error handling and information disclosure

`backend/src/middleware/error-handler.js` is the single place responses are
shaped.

- In production, `mapPostgresError(err, { isProduction: true })` collapses a
  raw driver error (unique violation, FK violation, check violation) into a
  generic client-facing message. Table names, constraint names and SQL state
  never reach the client.
- Stack traces are logged server-side (with `LOG_LEVEL`) and never serialized
  into the response.
- The 404 handler returns the JSON envelope, not an HTML error page, so a path
  probe cannot fingerprint the framework.
- Secrets (`JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, database credentials) are
  validated at boot and are never logged. Production fail-fast refuses to start
  with a weak JWT secret or a live payment provider with no signing secret.

## Payments

The online-payment path treats the gateway as untrusted.

- **Signature.** Each notification is verified against an HMAC over the **raw**
  request body (`req.rawBody`, captured before JSON parsing) using
  `crypto.timingSafeEqual`, in `backend/src/payments/signature.js`. A
  re-serialised body would not verify, because JSON whitespace and key order are
  not stable.
- **Replay protection.** The signed timestamp must be within
  `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` (default 300), so an old, genuine
  notification cannot be replayed.
- **Amount and currency.** The provider's claimed amount and currency are
  compared to the order's own stored total and currency; a mismatch is refused.
  The client is never the authority on what was paid.
- **Idempotency.** Settlement is a conditional update guarded by
  `WHERE status = 'PENDING'`, so a duplicate delivery is a no-op rather than a
  double-credit (see `backend/src/repositories/payment.repository.js`).
- **Order state.** An order only becomes paid after a signature-verified
  notification; a client-supplied "I paid" flag is ignored.
- **Expiry.** A `PENDING` online attempt older than
  `PAYMENT_PENDING_TIMEOUT_MINUTES` (default 30) is expired.

There is no live third-party gateway wired in; `MOCK` is a sandbox that
implements the same contract. This is a known residual risk (below).

## Database integrity

Constraints are treated as part of the security boundary, not just hygiene:

- Foreign keys with deliberate `ON DELETE` behaviour, money as `BIGINT` minor
  units, `CHECK` constraints on enums, and an append-only
  `inventory_transactions` ledger.
- Migration `024_add_indexes_and_integrity.sql` adds the indexes the workload
  depends on (see `docs/performance.md`) and one missing rule:
  `coupons_used_within_max CHECK (max_uses IS NULL OR used_count <= max_uses)`.
- Inventory cannot be oversold: deduction is a single conditional
  `UPDATE ... WHERE quantity - reserved_quantity >= $n`, so two attempts at the
  last unit cannot both succeed. Pinned by
  `backend/tests/inventory.repository.test.js`.
- The admin coupon service returns a friendly `422` when an admin tries to lower
  `max_uses` below `used_count`, rather than surfacing a raw constraint error.

## Cache privacy

The API is **default-deny**: `backend/src/middleware/cache.js` sets
`Cache-Control: no-store` on every response unless a route deliberately
overrides it. Only the catalogue, categories and search routes opt into
`public, max-age=60, stale-while-revalidate=120`, and they are public precisely
because they contain no per-user data. Static assets served in production get a
short public lifetime; HTML is `no-cache`.

## Accepted tradeoffs and remaining risks

These are deliberate, documented decisions — not oversights.

| Item                                            | Status             | Rationale / residual risk                                                                                                                                                                        |
| ----------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Register reveals existing email (`409`)         | Accepted           | See _Authentication_; no email-verification flow to hide behind.                                                                                                                                 |
| `requireSameOrigin` allows no-`Origin` requests | Accepted           | Non-browser clients; `SameSite=Lax` remains the primary CSRF defence.                                                                                                                            |
| `trust proxy = 1`                               | Accepted           | Correct behind one reverse proxy; a direct-to-node deployment would let a client spoof `X-Forwarded-For` to evade IP rate limits. Set to `false` (or a precise hop count) if not behind a proxy. |
| CSP disabled in dev/test                        | Accepted           | Policy is asserted directly in tests; enabling on plain-HTTP localhost only adds noise.                                                                                                          |
| `style-src 'unsafe-inline'`                     | Accepted           | Inline styles are used for dynamic values; tightening requires a nonce/hash workstream.                                                                                                          |
| `img-src https:`                                | Accepted           | Admin-entered external image URLs; a pinned CDN allowlist would be stronger.                                                                                                                     |
| Address `remove()` is two statements            | Accepted           | A partial unique index is the safety net; a single-statement rewrite is deferred.                                                                                                                |
| No live payment gateway                         | **Remaining risk** | `MOCK` only; real adapters and refund execution are not implemented. Webhook hardening is in place but untested against a real provider.                                                         |
| Refunds are architecture-only                   | **Remaining risk** | The data model supports them; the execution path is not built.                                                                                                                                   |
| Frontend API base URL                           | **Resolved**       | `frontend/js/config.js` derives a same-origin `<origin>/api/v1` on any non-local HTTP(S) host, and still honours `window.__APP_CONFIG__` for a split deployment.                                 |
| No WAF / bot mitigation                         | Remaining risk     | Out of scope; rate limiting is the only automated abuse control.                                                                                                                                 |
| No automated dependency audit in CI             | Remaining risk     | Run `npm audit` and keep dependencies current manually.                                                                                                                                          |
