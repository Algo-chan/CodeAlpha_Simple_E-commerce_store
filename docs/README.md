# Documentation

The project is a single-vendor e-commerce platform: a vanilla HTML/CSS/JS
storefront, an Express/Node.js API and PostgreSQL. All phases (architecture →
catalogue → cart → checkout → orders → payments → reviews → admin → hardening →
production) are implemented.

| Document                                                 | Purpose                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| [architecture.md](./architecture.md)                     | Layers, request lifecycle, production architecture, decisions |
| [setup.md](./setup.md)                                   | Local installation, PostgreSQL, commands, troubleshooting     |
| [api.md](./api.md)                                       | Endpoints, response envelope, error codes                     |
| [database-plan.md](./database-plan.md)                   | Entity model and schema intent                                |
| [security.md](./security.md)                             | Auth/sessions, headers, CSP, rate limits, payment security    |
| [performance.md](./performance.md)                       | Indexes, caching, pagination, frontend budget                 |
| [testing.md](./testing.md)                               | Test layout, how to run, coverage map                         |
| [deployment.md](./deployment.md)                         | Production architecture, env vars, database, backups, CI/CD   |
| [production-checklist.md](./production-checklist.md)     | Final pre-launch checklist and the end-to-end smoke test      |
| [roadmap.md](./roadmap.md)                               | Build phases                                                  |
| [frontend-design-system.md](./frontend-design-system.md) | Design tokens and component contract                          |

## What is implemented

- Catalogue (products, categories, variants, images, search) on the real database.
- Auth with server-side sessions, bcrypt passwords and RBAC.
- Cart, wishlist, checkout, orders and COD payments; an online **sandbox** provider.
- Reviews with moderation, coupons, inventory with an append-only ledger and audit logs.
- Admin console (products, variants, inventory, orders, customers, reviews,
  payments, coupons, audit) behind a server-side admin gate.

## Known gaps / next work

- The online payment **sandbox** (`MOCK`) stands in for a real gateway; only COD is
  production-safe today (see [deployment.md §7](./deployment.md)).
- Refund execution is modelled but not implemented.
- The catalogue UI still ships fixtures in `frontend/js/mock/` alongside the real
  client; the data layer is behind a seam so they can be swapped without component
  changes.
- Email is not wired in.
