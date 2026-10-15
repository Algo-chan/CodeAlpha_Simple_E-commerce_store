# Roman Store

A single-vendor e-commerce platform: a **vanilla HTML/CSS/JavaScript** storefront
and admin console over a **Node.js + Express 5 + PostgreSQL** REST API.

The whole flow works end to end — browsing, search, cart, wishlist, checkout
(cash on delivery, plus a sandbox online provider), orders, accounts and an admin
console — with no frontend framework and no build step.

## Features

**Storefront** (11 pages, `frontend/`)

- Home with category tiles and product rails
- Collection pages with client-side filtering, sorting, faceting and pagination
- Product detail: gallery, variant picker, reviews, related products, quick view
- Predictive search overlay with recent-history
- Cart drawer and cart page, wishlist, guest → account cart merge
- Checkout and order history; cash on delivery and a sandbox online provider
- Register / login / account (opaque server-side sessions)

**Admin console** (`frontend/admin.html`)

- Dashboard with order and revenue summaries
- Products with variants, images and categories
- Inventory (low-stock), orders, customers and review moderation

**API** (`backend/`, `/api/v1`)

- Layered: routes → controllers → services → repositories → PostgreSQL
- Zod-validated input, shared success/error envelope, parameterized SQL only
- Session cookie auth, bcrypt hashing, same-origin CSRF checks, RBAC for admin
- Rate limiting, Helmet CSP, request logging, `/health` readiness probe

## Quick start

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL / DB_* and the secrets
npm run db:create             # create the database
npm run migrate               # apply the schema
npm run seed                  # load the demo catalogue, users and orders
npm run dev                   # frontend + backend together
```

- Storefront: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:4000](http://localhost:4000)
- Health probe: [http://localhost:4000/health](http://localhost:4000/health)

> The seed data is for development only. The runner refuses to load it into a
> `NODE_ENV=production` database unless `--force` is passed.

## Tech stack

| Layer    | Tech                                                               |
| -------- | ------------------------------------------------------------------ |
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES modules), no build step        |
| Backend  | Node.js 20+, Express 5                                             |
| Database | PostgreSQL 16                                                      |
| API      | RESTful, JSON, versioned (`/api/v1`)                               |
| Tooling  | ESLint, Prettier, nodemon, `node:test` + supertest, npm workspaces |
| Deploy   | Docker, Render Blueprint (managed PostgreSQL)                      |

## Architecture

Modular monolith with a strict, downward dependency direction:

```
Browser → Frontend → REST API (/api/v1) → Routes → Controllers → Services → Repositories → PostgreSQL
```

Key principles: dependency direction downwards, parameterized queries only, safe
error envelopes, fail-closed auth, and no framework overhead on the frontend.

In production the API also serves the static storefront from one origin, which is
what keeps the session cookie `SameSite=Lax` and the CSP `connect-src 'self'`.

See [docs/architecture.md](./docs/architecture.md) for details.

### Where the data comes from

By default the storefront reads everything from the API. For frontend work with
no backend running, append `?catalogue=mock` to the URL to read the catalogue
from in-browser fixtures instead (`frontend/js/mock/`). Auth, cart, wishlist,
checkout, orders and admin are always live API calls.

## Deployment

The repository ships a production `Dockerfile`, a `.dockerignore`, a Render
Blueprint (`render.yaml`) and a local `docker-compose.yml`.

**Render (managed PostgreSQL):** push the repository, then create a Blueprint
from it. Render reads `render.yaml`, provisions the database and the web service,
generates the secrets and injects `DATABASE_URL`. Migrations run on boot; the
service is served over HTTPS at `https://<name>.onrender.com`. The default origin
needs no CORS configuration — Render injects `RENDER_EXTERNAL_URL` and the app
trusts it. Add `PUBLIC_ORIGIN` only when using a custom domain.

**Any container host:**

```bash
docker build -t roman-store .
docker run --rm -p 4000:4000 --env-file backend/.env roman-store
```

**Local, production-shaped rehearsal:** `docker compose up --build`, then open
[http://localhost:4000](http://localhost:4000). Note the session cookie is
`Secure` in production, so sign-in and cart persistence need HTTPS (Render
provides it); browsing the catalogue works over plain HTTP.

The full walkthrough — environment variables, database, backups, CI/CD and the
pre-launch smoke test — is in [docs/deployment.md](./docs/deployment.md) and
[docs/production-checklist.md](./docs/production-checklist.md).

## Documentation

| Document                                                       | Purpose                                             |
| -------------------------------------------------------------- | --------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                 | Layers, request lifecycle, production architecture  |
| [docs/deployment.md](./docs/deployment.md)                     | Production deployment, env vars, DB, backups, CI/CD |
| [docs/production-checklist.md](./docs/production-checklist.md) | Final pre-launch checklist and smoke test           |
| [docs/api.md](./docs/api.md)                                   | Endpoints, envelope, error codes                    |
| [docs/database-plan.md](./docs/database-plan.md)               | Schema and entities                                 |
| [docs/setup.md](./docs/setup.md)                               | Installation, PostgreSQL, commands, troubleshooting |
| [docs/security.md](./docs/security.md)                         | Auth/sessions, headers, CSP, rate limits, payments  |
| [docs/testing.md](./docs/testing.md)                           | Test layout, how to run, coverage map               |
| [docs/performance.md](./docs/performance.md)                   | Indexes, caching, pagination, frontend budget       |
| [docs/roadmap.md](./docs/roadmap.md)                           | Build phases                                        |

## Scripts

| Command             | What                         |
| ------------------- | ---------------------------- |
| `npm run dev`       | Frontend + backend together  |
| `npm start`         | Backend in production mode   |
| `npm test`          | API + frontend tests         |
| `npm run verify`    | Lint + format check + tests  |
| `npm run lint`      | ESLint                       |
| `npm run format`    | Prettier write               |
| `npm run migrate`   | Run migrations               |
| `npm run seed`      | Run seeds                    |
| `npm run verify:db` | Real-PostgreSQL verification |
| `npm run db:create` | Create PostgreSQL database   |

## Contributing

New code must follow the existing layer boundaries and conventions. Never commit
secrets (`.env` is git-ignored). Use parameterized SQL and the shared response
envelope.
