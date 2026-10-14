# Testing

How the test suite is organised, how to run it, and what each layer is
responsible for proving. The guiding rule is that tests run with **no external
services** — no PostgreSQL server, no network — so the suite is fast and
deterministic on any machine.

## Running the tests

From the repository root:

```bash
npm run test:backend     # node --test over backend/tests
npm run test:frontend    # node --test over frontend/tests
npm run lint             # eslint .
npm run format:check     # prettier --check .
npm run verify           # lint + format:check + backend + frontend
```

A single file, or a single test name:

```bash
node --test backend/tests/security.test.js
node --test --test-name-pattern="rate" backend/tests/security.test.js
```

Watch mode:

```bash
npm run test:watch --workspace @ecommerce/backend
npm run test:watch --workspace @ecommerce/frontend
```

There is no `build` step: the backend is plain ESM run by `node`, and the
frontend is served as static files. "Production checks" are therefore a runtime
smoke test (env fail-fast + response headers), not a compile.

## Backend suite

The backend uses the built-in `node:test` runner with `supertest` for HTTP, and
`@electric-sql/pglite` (a WASM build of PostgreSQL) as the database. Every
migration and seed file is executed for real against PGlite, so constraint and
query behaviour is genuinely tested — not mocked.

### Test infrastructure

| File                                | Purpose                                                                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/tests/setup.js`            | Sets `NODE_ENV=test`, `LOG_LEVEL=silent`, `PAYMENT_PROVIDER=MOCK`, a deterministic `PAYMENT_WEBHOOK_SECRET`, and a short DB connect timeout. **Imported first in every test file.**                                                         |
| `backend/tests/helpers/database.js` | `createMigratedDb()` (all migrations), `createSeededDb()` (migrations + seeds), `runSeeds()`, `expectRejected()` (assert a constraint refuses bad data), `fingerprint()` (hash a table's data ignoring timestamps to prove seeds converge). |
| `backend/tests/health.test.js`      | Baseline: health check, headers, 404 envelope.                                                                                                                                                                                              |

`createApp({ db })` accepts a query executor, so the full HTTP stack
(validation → controller → service → repository) can be exercised with no
PostgreSQL server. Repositories fall back to the `pg` pool in production and use
the injected executor in tests.

### What each file covers

| File                           | Area                  | Notes                                                                                      |
| ------------------------------ | --------------------- | ------------------------------------------------------------------------------------------ |
| `api-foundation.test.js`       | Foundation            | Health, routing, 404, error envelope, placeholders.                                        |
| `health.test.js`               | Foundation / headers  | Baseline security headers and CSP assertion.                                               |
| `auth.api.test.js`             | AUTH                  | Register, login, logout, sessions, password change, profile, addresses.                    |
| `cart.api.test.js`             | CART                  | Add/update/remove, guest cart, merge on login, ownership.                                  |
| `wishlist.api.test.js`         | CART / authorization  | Save/remove, idempotency, cross-user isolation.                                            |
| `checkout.api.test.js`         | CHECKOUT / ORDERS     | Address, coupon, totals, order creation and read-back, stock.                              |
| `coupon.api.test.js`           | CHECKOUT              | Validation, expiry, `max_uses`, discount maths.                                            |
| `review.api.test.js`           | REVIEWS               | Submit, one-per-line, reviewable list, moderation visibility.                              |
| `payments.api.test.js`         | PAYMENTS              | Initiate, signature verification, replay tolerance, amount/currency mismatch, idempotency. |
| `admin.api.test.js`            | ADMIN / AUTHORIZATION | Every admin route rejects a non-admin; RBAC gate.                                          |
| `catalogue.api.test.js`        | CATALOGUE             | Listing, filters, sort, pagination caps, product detail.                                   |
| `catalogue.repository.test.js` | CATALOGUE             | Repository-level query behaviour.                                                          |
| `catalogue.sql.test.js`        | CATALOGUE             | Raw SQL invariants.                                                                        |
| `database.constraints.test.js` | DATABASE              | FKs, checks, uniqueness.                                                                   |
| `database.data.test.js`        | DATABASE              | Seed convergence via `fingerprint`.                                                        |
| `database.hardening.test.js`   | DATABASE              | Migration 024 indexes + `coupons_used_within_max`.                                         |
| `inventory.repository.test.js` | INVENTORY             | Oversell guard, reserved stock, ledger sign rules.                                         |
| `security.test.js`             | SECURITY              | CSP, headers, CORS, cookie attributes, production error mapping, rate limiters.            |
| `cache.test.js`                | CACHING               | `no-store` default vs `public` catalogue override.                                         |
| `smoke.production.test.js`     | END-TO-END            | Guest, customer and admin journeys through the real HTTP stack.                            |

### Coverage map

- **AUTH** — happy path, wrong password, unknown email, expired/revoked session,
  suspension, password change revoking other sessions.
- **CART / WISHLIST** — CRUD, idempotent writes, guest-cart merge, and that one
  customer cannot touch another's cart or wishlist.
- **INVENTORY** — the conditional deduct cannot oversell; reserved quantity is
  respected; the ledger refuses a movement whose sign disagrees with its type.
- **CHECKOUT / ORDERS** — totals recomputed server-side, coupon rules, order
  read-back scoped to the owner.
- **PAYMENTS** — a forged signature, a stale timestamp, and a mismatched amount
  or currency are all rejected; a duplicate notification settles once.
- **ADMIN** — the RBAC gate applies to the whole surface, not per handler.
- **AUTHORIZATION** — cross-user and cross-role access is asserted, not assumed.
- **SECURITY regression** — the controls that are easy to weaken by accident
  (headers, CSP, CORS, cookies, error text, rate limits) are pinned.

## Frontend suite

The frontend also uses `node:test`. Tests import the ES modules directly and
drive DOM-facing helpers with a minimal fake `document` where needed, so no
browser or headless runtime is required.

| File                                                       | Area                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `catalogue.test.js`, `filters.test.js`                     | Catalogue rendering and filter logic.                                                                                                     |
| `cart.test.js`, `cart-sync.test.js`, `guest-merge.test.js` | Cart state, sync, guest merge.                                                                                                            |
| `wishlist.test.js`, `wishlist-sync.test.js`                | Wishlist state and sync.                                                                                                                  |
| `checkout.test.js`                                         | Checkout flow helpers.                                                                                                                    |
| `auth.test.js`                                             | Auth/session helpers.                                                                                                                     |
| `review.test.js`                                           | Review form helpers.                                                                                                                      |
| `store.test.js`, `format.test.js`, `mock-api.test.js`      | Store, money formatting, fixtures.                                                                                                        |
| `admin.test.js`                                            | Admin console helpers.                                                                                                                    |
| `csp.test.js`                                              | **Security:** no inline `<script>` or `on*=` in any `frontend/*.html`; deferred font stylesheet marked and loaded by `loadDeferredFonts`. |
| `config.test.js`                                           | **Production:** the API base URL is same-origin off localhost and honours `__APP_CONFIG__`.                                               |

## Conventions

- Import `./setup.js` **first** in any backend test that touches config, the
  app, or the database.
- Prefer a real migrated database (`createMigratedDb`) over hand-written schema;
  if you need seed data, use `createSeededDb`.
- Assert on the `{ success, error: { code } }` envelope and on
  `ERROR_CODES`, not on prose messages.
- When you add a constraint, add a `expectRejected(...)` test proving it refuses
  bad data — a constraint that silently accepts is worse than none.
- Keep limiters in tests explicit: mount `createXxxLimiter({ windowMs, limit })`
  with a tiny budget rather than driving the shared singleton.

## Real-PostgreSQL verification

The suite runs against PGlite, so it proves behaviour but not the network. Before
a release, run the complementary check against a real PostgreSQL (staging or a
throwaway database — never production):

```bash
npm run verify:db
```

It applies the migrations, checks the server version and every table/index/
constraint, and exercises the oversell guard with six concurrent connections. See
[deployment.md §4](./deployment.md) for details.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- **quality** — `npm ci`, `npm run lint`, `npm run format:check`, the backend and
  frontend suites.
- **database** — a real `postgres:16` service: `npm run migrate`, the seed runner,
  and `npm run verify:db`.

A red run blocks the release. Local parity is `npm run verify`; add `npm run
verify:db` against a real server when the schema changes.
