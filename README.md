# Roman Store

Roman Store is a professional, portfolio-quality single-vendor e-commerce
platform. Built with **vanilla HTML/CSS/JavaScript** (frontend) + **Node.js,
Express, PostgreSQL** (backend).

This repository contains the completed **Phase 1 — Architecture and
Development Environment**. No product, cart, checkout or admin functionality is
implemented yet by design. That keeps the foundation clean, modular and ready
for incremental development.

## Quick start

```bash
npm install
cp .env.example .env
# edit .env (set DB password etc.)
npm run db:create
npm run migrate
npm run verify
npm run dev
```

- Frontend: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:4000](http://localhost:4000)
- Health probe: [http://localhost:4000/health](http://localhost:4000/health)
- Health detail: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)

## Tech stack

| Layer    | Tech                                                               |
| -------- | ------------------------------------------------------------------ |
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+ modules)                     |
| Backend  | Node.js, Express.js 5                                              |
| Database | PostgreSQL                                                         |
| API      | RESTful, JSON                                                      |
| Tooling  | ESLint, Prettier, nodemon, `node:test` + supertest, npm workspaces |

## Architecture

Modular monolith with strict separation of concerns:

```
Browser → Frontend → REST API (/api/v1) → Routes → Controllers → Services → Repositories → PostgreSQL
```

Key principles: dependency direction downwards, parameterized queries only, safe
error envelopes, fail-closed auth, no framework overhead on the frontend.

See [docs/architecture.md](./docs/architecture.md) for details.

## What’s included (Phase 1)

- ✅ Backend layers, error handling, API versioning, 404s, response envelopes
- ✅ Health check vertical slice (reference implementation)
- ✅ All planned resource routes mounted as 501 placeholders
- ✅ Migration runner, seed runner, db creation script (no business tables yet)
- ✅ Frontend shell: design tokens, layout, partials, API client, component/page contract
- ✅ Automated tests for API foundation, linting, formatting
- ✅ Comprehensive documentation

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for upcoming phases (schema, auth,
catalogue, cart/wishlist, checkout/COD, orders, payments, reviews, admin).

## Documentation

| Document                                                       | Purpose                                             |
| -------------------------------------------------------------- | --------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)                 | Layers, request lifecycle, production architecture  |
| [docs/deployment.md](./docs/deployment.md)                     | Production deployment, env vars, DB, backups, CI/CD |
| [docs/production-checklist.md](./docs/production-checklist.md) | Final pre-launch checklist and smoke test           |
| [docs/api.md](./docs/api.md)                                   | Endpoints, envelope, error codes                    |
| [docs/database-plan.md](./docs/database-plan.md)               | Planned entities (no schema yet)                    |
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

Production release steps are in [docs/deployment.md](./docs/deployment.md).

## Contributing

This is an incremental learning project. New code must follow the existing layer
boundaries and conventions. Never commit secrets (`.env` is git-ignored). Use
parameterized SQL and the shared response envelope.
