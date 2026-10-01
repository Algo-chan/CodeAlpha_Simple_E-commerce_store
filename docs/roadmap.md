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

- [ ] Design brand identity (colors, typography, logo placeholder) → moves to the UI phase
- [ ] Refine `frontend/css/tokens.css` → moves to the UI phase

`npm run migrate && npm run seed` still needs a PostgreSQL server to run; both
have been validated against an in-process PostgreSQL (PGlite) instead. See
[setup.md](./setup.md) for the server requirement.

## Phase 3 — Authentication & Users (core platform)

- [ ] User model, hashing with bcrypt, unique email
- [ ] Auth endpoints: register, login, refresh, logout
- [ ] Implement `authenticate` and `authorize` middleware with JWTs
- [ ] Profile, addresses, password change, password reset
- [ ] Admin-only user management
- [ ] Auth tests, rate-limited login

## Phase 4 — Catalogue (products & categories)

- [ ] Categories tree (parent/child), breadcrumbs
- [ ] Products + product_variants + product_images
- [ ] Inventory tracking (quantity, reserved), transactions
- [ ] Search, filtering, sorting, pagination
- [ ] Product details page + product card component
- [ ] Catalogue API + frontend views

## Phase 5 — Cart & Wishlist

- [ ] Persistent cart per authenticated user
- [ ] Cart totals (subtotal, shipping placeholder, tax placeholder)
- [ ] Wishlist add/remove/list
- [ ] Cart drawer component, toast notifications

## Phase 6 — Checkout & Orders (sales)

- [ ] Checkout flow, address selection, shipping/payment
- [ ] Cash on Delivery (COD) first
- [ ] Order creation: atomic transaction (inventory reservation, order items)
- [ ] Order number, status, payment status
- [ ] Orders history + order details
- [ ] Order status updates

## Phase 7 — Payments (extensible)

- [ ] Payment intents structure, webhooks foundation
- [ ] Keep COD working, prepare Stripe/Paystack for later
- [ ] Payment statuses synchronized with orders

## Phase 8 — Reviews & Ratings

- [ ] Reviews: create/list, one per user per product
- [ ] Average rating + distribution
- [ ] Moderation status (pending/approved/rejected)

## Phase 9 — Admin Dashboard

- [ ] Admin layout, navigation, RBAC
- [ ] Product/inventory management
- [ ] Orders management, status updates
- [ ] Coupons, discounts
- [ ] Basic analytics (sales, orders, products)

## Phase 10 — Polish, QA & Deployment

- [ ] Performance: image optimization, lazy loading
- [ ] Accessibility: keyboard, ARIA, focus management
- [ ] Responsive QA (mobile/tablet/desktop)
- [ ] API documentation expansion (OpenAPI/Swagger) if needed
- [ ] Error boundaries, empty states, loading skeletons
- [ ] Security hardening, production `.env` checklist
- [ ] Deployment strategy (Render/Railway/Fly/Heroku, Vercel/Cloudflare Pages)
- [ ] CI (lint + test + build) if desired

### Notes

- Nothing business-specific was built in Phase 1 on purpose.
- Every new feature follows the same layering: route → controller → service →
  repository. The health check is the reference implementation.
- Keep the design original (inspired by Shopify/Wix in UX goals, not copied).
- Prefer clarity and maintainability over premature abstraction.
