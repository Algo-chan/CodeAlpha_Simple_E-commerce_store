# Roadmap

## Phase 1 — Architecture & Environment (done)

- [x] Repository inspected, README preserved
- [x] Workspace: root + backend + frontend workspaces
- [x] Tooling: ESLint, Prettier, EditorConfig, .gitignore, .env.example
- [x] Backend scaffold with layers (routes → controllers → services → repositories)
- [x] Express app with security middleware, JSON, CORS, rate limiting
- [x] API versioning (`/api/v1`), 404, centralized error handler, response envelope
- [x] Roles: `CUSTOMER`, `ADMIN`, `SELLER` prepared; auth middleware fails closed
- [x] Validation middleware (Zod) ready
- [x] PostgreSQL pool, health probe, migration runner, seed runner
- [x] Reference health check vertical slice
- [x] API placeholders for all planned resources (501)
- [x] Frontend scaffold: tokens, base, layout, utilities, component contract
- [x] Static dev server, API client, page/component conventions
- [x] Automated tests (health, 404, placeholders, error envelope)
- [x] Documentation: architecture, API, database plan, setup, roadmap

## Phase 2 — Database & Domain Foundation (done)

- [x] Draw ER diagrams for all 16 entities (`docs/database-erd.md`)
- [x] Settle conventions: `UUID` keys, money as `BIGINT` minor units, `TIMESTAMPTZ`,
      `VARCHAR` + `CHECK` over `ENUM`
- [x] Write 18 migrations (`backend/migrations/`): users, addresses, categories,
      products, images, variants, inventory, inventory_transactions, carts,
      cart_items, wishlists, wishlist_items, orders, order_items, payments, reviews
- [x] Constraints, foreign keys with deliberate delete behaviour, indexes
- [x] `set_updated_at` trigger on all 15 mutable tables
- [x] Add 7 seed files (`backend/seeds/`) with realistic, reproducible demo data
- [x] Verify: every migration and seed executes, plus 66 behavioural assertions
- [x] Documentation: ERD, design decisions, migration and seed conventions

Deferred from this phase, since it was scoped to the database only:

- [ ] Design brand identity (colours, typography, logo placeholder) → moves to the UI phase
- [ ] Refine `frontend/css/tokens.css` → moves to the UI phase

`npm run migrate && npm run seed` still needs a PostgreSQL server to run; both
have been validated against an in-process PostgreSQL (PGlite) instead. See
[setup.md](./setup.md) for the server requirement.

## Phase 3 — Frontend Design System & UI Foundation (done)

No business logic, no API calls: a design system and a set of reusable,
context-agnostic storefront primitives that later phases plug data into.

- [x] Centralised design tokens: colour, typography, spacing, layout, borders,
      shadows, motion, z-index (`frontend/styles/tokens.css`)
- [x] Typography: one display face plus one sans, non-blocking load
- [x] Mobile-first responsive system across six breakpoints
- [x] CSS foundation: reset, base, layout, utilities, animations, components
- [x] Storefront shell: announcement bar, sticky header, footer
- [x] Navigation: desktop dropdowns, mobile drawer, keyboard support
- [x] Search: predictive overlay, product and category suggestions, recent searches
- [x] `ProductCard` with badges, ratings, variants, wishlist, quick view, quick add
- [x] Product gallery: thumbnails, hover swap, swipe, zoom/fullscreen foundations
- [x] Flexible variant picker driven by attribute data, not product category
- [x] Cart drawer (side panel / bottom sheet) with mock state
- [x] Wishlist interactions and empty state
- [x] Toast system, modal/drawer/sheet/dropdown primitives with focus management
- [x] Button, form, rating, badge and price primitives
- [x] Skeleton, empty and error states
- [x] Motion system with `prefers-reduced-motion` support
- [x] Mock data matching the Phase 2 schema and the future API response shape
- [x] Documentation: [frontend-design-system.md](./frontend-design-system.md)

## Phase 4 — Storefront Experience (done)

The customer-facing storefront, built from the Phase 3 primitives. Still no
backend: mock data in, `localStorage` for cart and wishlist.

- [x] Homepage composed of reusable, data-driven sections: hero, category
      discovery, featured, new arrivals, editor's picks, editorial band, how it
      works, guarantees, newsletter
- [x] Collection page: facets, sorting, pagination, URL round-trip
- [x] Product page: gallery, variants, availability, related products
- [x] Cart and wishlist pages alongside the drawer
- [x] Search wired to mock data: scoring, suggestions, no-results, clear
- [x] Quick view functional against mock data, including variant availability
- [x] Cart state: add/remove/quantity/undo, stock ceilings, integer-only totals
- [x] Wishlist state with product ids and count badge
- [x] Responsive mobile experience: bottom sheets, compact header, touch targets
- [x] Loading, empty and error states on every data path
- [x] 154 frontend tests on the pure logic (`node:test`)
- [x] Accessibility pass: landmarks, focus management, live regions, reduced motion
- [x] No dead links: every footer and card action resolves to real content
- [x] Documentation: [frontend-storefront.md](./frontend-storefront.md)

Deferred from this phase, since it was scoped to the storefront UI:

- [ ] Real API integration → Phase 6, backend done, frontend pending
- [ ] Checkout, payment and orders → later phases
- [ ] Final brand identity → still placeholder, configurable in one file

## Phase 5 — Authentication & Users (core platform)

- [ ] User model, hashing with bcrypt, unique email
- [ ] Auth endpoints: register, login, refresh, logout
- [ ] Implement `authenticate` and `authorize` middleware with JWTs
- [ ] Profile, addresses, password change, password reset
- [ ] Admin-only user management
- [ ] Auth tests, rate-limited login
- [ ] Replace the account placeholder and merge the local wishlist into an account

## Phase 6 — Catalogue API (products & categories)

Backend complete and documented in
[product-discovery.md](./product-discovery.md). Frontend transition still pending.

- [x] Categories tree (parent/child) with descendant-inclusive counts, breadcrumbs
- [x] `GET /categories`, `/categories/:slug` — a category page is a listing scoped
      to its subtree, validated in two stages so the path slug wins over any
      `?category=` parameter
- [x] `GET /products`, `/products/:slug`, `/products/:slug/reviews`,
      `/products/:slug/related` — read-only, public, `Cache-Control: max-age=60`
- [x] Availability model: `stock` is `null` (untracked/digital) or an object with
      `available`; never `0`. `is_listable` is independent of purchasability, so a
      sold-out product stays in the grid
- [x] Editorial fields with no column behind them: `is_new` derived from
      `created_at`, `is_featured: false`, `display_order: 0`
- [x] Search, filtering, sorting, pagination — server-side, with facets counted
      per-dimension and sort keys matching the frontend spellings
- [x] Attribute filters: OR within a key, AND across keys; variant attributes are
      searchable so the filter panel never offers an option search cannot find
- [x] Review presenter with server-derived verified-purchase status, and no
      reviewer email or account id in the payload
- [x] 96 catalogue tests (59 HTTP through the full stack on PGlite, 37 unit)
- [x] Whole suite green: 191 backend, 154 frontend, lint and format clean
- [ ] Swap `mockApi` for `core/api.js` and move collection/search/category pages
      onto server-driven URL state; component contracts unchanged
- [x] Move `canSelectAttribute`/`findVariantFor` out of `mock/view.js` into
      `frontend/js/utils/product-view.js`, so components stop importing from
      `mock/`; badge vocabulary and the low-stock threshold moved with them
- [x] `cart.js`: read `variant.is_active` / `variant.is_purchasable` instead of the
      fixture-only `stock.is_active`, and treat `stock === null` as in stock
- [x] Drop the fabricated `stock.is_active: quantity > 0` from the fixtures and emit
      the backend's `is_tracked` instead, so "sold out" (`available === 0`) and "row
      inactive" stop being the same event
- [ ] Inventory write endpoints (quantity, reserved, transactions) — deferred, as
      the read model did not need them

## Phase 7 — Cart & Wishlist API

- [ ] Persistent cart per authenticated user
- [ ] Cart endpoints, server-side totals
- [ ] Wishlist add/remove/list
- [ ] Reconcile client cart state against the server on load

## Phase 8 — Checkout & Orders (sales)

- [ ] Checkout flow, address selection, shipping/payment
- [ ] Cash on Delivery (COD) first
- [ ] Order creation: atomic transaction (inventory reservation, order items)
- [ ] Order number, status, payment status
- [ ] Orders history + order details
- [ ] Order status updates

## Phase 9 — Payments (extensible)

- [ ] Payment intents structure, webhooks foundation
- [ ] Keep COD working, prepare Stripe/Paystack for later
- [ ] Payment statuses synchronized with orders

## Phase 10 — Reviews & Ratings

- [ ] Review submission (read-only fixtures today)
- [ ] One review per user per product
- [ ] Average rating + distribution
- [ ] Moderation status (pending/approved/rejected)

## Phase 11 — Admin Dashboard

- [ ] Admin layout, navigation, RBAC
- [ ] Product/inventory management
- [ ] Orders management, status updates
- [ ] Coupons, discounts
- [ ] Basic analytics (sales, orders, products)

## Phase 12 — Polish, QA & Deployment

- [ ] Performance: real product photography, image optimisation
- [ ] Accessibility audit with assistive technology
- [ ] Cross-browser QA
- [ ] API documentation expansion (OpenAPI/Swagger) if needed
- [ ] Final brand identity: name, wordmark, palette
- [ ] Security hardening, production `.env` checklist
- [ ] Deployment strategy (Render/Railway/Fly/Heroku, Vercel/Cloudflare Pages)
- [ ] CI (lint + test) if desired

### Notes

- Nothing business-specific was built in Phase 1 on purpose.
- Every new backend feature follows the same layering: route → controller →
  service → repository. The health check is the reference implementation.
- Phases 3 and 4 deliberately shipped no API calls: the storefront was built
  against fixtures shaped like the Phase 2 schema, so swapping in the real client
  is a change to `app.js` and not to any component.
- Keep the design original (inspired by Shopify/Wix in UX goals, not copied).
- Prefer clarity and maintainability over premature abstraction.
