# Documentation

| Document                                                 | Contents                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                     | Layers, request lifecycle, folder responsibilities, design decisions  |
| [api.md](./api.md)                                       | Versioning, response envelope, error codes, current endpoints         |
| [database-plan.md](./database-plan.md)                   | Design decisions, what is built, what is deferred                     |
| [database-erd.md](./database-erd.md)                     | ER diagrams, column reference, enforced rules                         |
| [frontend-design-system.md](./frontend-design-system.md) | Design tokens, typography, spacing, components, motion, accessibility |
| [frontend-storefront.md](./frontend-storefront.md)       | Homepage architecture, state, cart, search, API integration points    |
| [product-discovery.md](./product-discovery.md)           | Catalogue, search, category and detail endpoints, and the decisions   |
| [setup.md](./setup.md)                                   | Prerequisites, install, PostgreSQL, run commands, troubleshooting     |
| [roadmap.md](./roadmap.md)                               | Build phases and what is deliberately deferred                        |

Other useful references:

- `frontend/README.md` — frontend folder map and how the storefront boots
- `frontend/js/components/README.md` — component conventions
- `frontend/pages/README.md` — route → file mapping
- `frontend/tests/README.md` — what the frontend tests cover, and what they do not
- `backend/migrations/README.md` — migration conventions and current file list
- `backend/seeds/README.md` — seed file format and re-runnability rules

## Current phase

**Phase 9 — online payments architecture (backend complete).**

Phase 1 remains in place, plus:

- 18 migrations building 16 tables, with constraints, indexes and triggers
- 7 seed files loading reproducible demo data (re-runnable)
- Mermaid ERD and design documentation in `docs/database-erd.md`

Phase 3 added the frontend foundation:

- Centralised design tokens and a mobile-first CSS architecture
- Storefront shell, navigation, search, product card, gallery, variant picker
- Cart drawer, wishlist, toasts, and reusable modal/drawer/sheet primitives
- Skeleton, empty and error states; motion system honouring reduced-motion
- Mock data shaped like the Phase 2 schema and the future API response

Phase 4 built the storefront on top of it:

- Homepage, collection, product, cart and wishlist pages
- Functional search, quick view, variant selection, cart and wishlist state
- 153 frontend tests over the pure logic

Phase 5 built the read-only catalogue on the real database:

- `GET /products` with server-side filtering, sorting, pagination and facets
- `GET /products/:slug` plus `/reviews` and `/related`
- `GET /categories` and `/categories/:slug`, scoped to the whole subtree
- `GET /search` and `/search/suggest`, reaching variant attributes
- Availability modelled as `stock: null` (untracked) versus `stock.available: 0`
  (sold out), with `is_listable` independent of purchasability
- 96 catalogue tests: 59 through the whole stack on PGlite, 37 unit

See [product-discovery.md](./product-discovery.md) for the endpoint contracts and the
reasoning behind the filter, money and availability rules.

Authentication shipped as its own phase ahead of the catalogue API:

- Session-cookie identity: opaque random tokens stored as SHA-256, bcrypt
  password hashing, logout and password changes revoke sessions for real
- `register`, `login`, `logout`, `me`, `profile`, `password` plus a full
  address book, all behind `SameSite=Lax` + `requireSameOrigin` CSRF defence
- Storefront sign-in/registration/account pages with an auth-aware header and a
  one-time guest-basket transition (snapshot at sign-in, settled at boot)
- 36 backend auth tests and 8 auth-interface + 7 guest-merge frontend tests

See [roadmap.md](./roadmap.md) Phase 5 and the authentication section of
[api.md](./api.md) for the endpoints and the security decisions.

Also shipped:

- Phase 7: a server-backed cart (guest cookie or customer account) and wishlist,
  with the storefront adopting the server view on load
- Phase 8: checkout (atomic order creation, Cash on Delivery) and customer order
  history, surfaced by the `checkout.html` and `orders.html` pages
- Phase 9: an online-payment architecture that keeps COD default — a provider
  registry in `backend/src/payments/` (`INTERNAL` COD adapter plus a `MOCK`
  sandbox), signed and idempotent webhook settlement, payment/order status
  synchronisation (PAID confirms the order), intent creation, stale-intent
  expiry, and delivery ETA/availability estimates in every order view

See the payments section of [api.md](./api.md) for the endpoints and the
signature/verification rules.

Still to come: the frontend swap of catalogue and search to `core/api.js`,
real gateway adapters (the sandbox stands in), refund execution, and the admin
area. The catalogue still runs on fixtures in
`frontend/js/mock/`, shaped so the real client can replace them without any
component changing; auth, the account page, cart, wishlist, checkout and orders
already talk to the real API.

The Phase 1 infrastructure still in place:

- Express application with JSON parsing, CORS, Helmet, compression, rate limiting
- `/api/v1` versioned routing with a real health check; the catalogue routes are
  implemented and the remaining resources are still 501 placeholders
- Centralized success/error envelope, 404 handling and safe error responses
- PostgreSQL connection pool, health probe, migration runner and seed runner
- Validated environment configuration (`.env` is git-ignored)
- ESLint, Prettier, automated tests for both workspaces (`npm run verify`)

The catalogue runs on the real database. Cart, wishlist, checkout, orders and
payments (COD plus the sandbox online flow) are implemented; real gateway
adapters, refunds and the admin area remain.
