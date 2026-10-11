# Documentation

| Document | Contents |
| -------- | -------- |

## Admin area (Phase 10)

A dedicated admin console lives at /admin.html (served as /admin). The UI is a hash-routed app (frontend/js/admin/_) built on the same design tokens, with its own layout and a gating entry that only renders for authenticated users with role ADMIN. Server-side, all /api/v1/admin/_ routes share a single gate (authenticate, authorize(ROLES.ADMIN),
equireSameOrigin) - hiding UI controls is not the boundary. The console covers products, variants, images (by URL), categories, inventory (with append-only ledger), orders (status graph only), customers (suspend/reactivate), reviews (moderation), payments, dashboard and audit logs. Money stays in minor units. See [api.md](./api.md#admin-endpoints-implemented) for the full list.

Still to come: the frontend swap of catalogue and search to core/api.js, real gateway adapters (the sandbox stands in), refund execution. The catalogue still runs on fixtures in frontend/js/mock/, shaped so the real client can replace them without any component changing; auth, the account page, cart, wishlist, checkout and orders already talk to the real API.

The Phase 1 infrastructure still in place:

- Express application with JSON parsing, CORS, Helmet, compression, rate limiting
- /api/v1 versioned routing with a real health check; the catalogue routes are implemented and the remaining resources are still 501 placeholders
- Centralized success/error envelope, 404 handling and safe error responses
- PostgreSQL connection pool, health probe, migration runner and seed runner
- Validated environment configuration (.env is git-ignored)
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
- ESLint, Prettier, automated tests for both workspaces (
  npm run verify)
  The catalogue runs on the real database. Cart, wishlist, checkout, orders and payments (COD plus the sandbox online flow) are implemented; real gateway adapters, refunds and the admin area remain.
