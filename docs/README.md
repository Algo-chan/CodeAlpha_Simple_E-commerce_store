# Documentation

| Document                               | Contents                                                             |
| -------------------------------------- | -------------------------------------------------------------------- |
| [architecture.md](./architecture.md)   | Layers, request lifecycle, folder responsibilities, design decisions |
| [api.md](./api.md)                     | Versioning, response envelope, error codes, current endpoints        |
| [database-plan.md](./database-plan.md) | Design decisions, what is built, what is deferred                    |
| [database-erd.md](./database-erd.md)   | ER diagrams, column reference, enforced rules                        |
| [setup.md](./setup.md)                 | Prerequisites, install, PostgreSQL, run commands, troubleshooting    |
| [roadmap.md](./roadmap.md)             | Build phases and what is deliberately deferred                       |

Other useful references:

- `frontend/README.md` — frontend folder map and component contract
- `frontend/components/README.md` — component conventions and planned components
- `frontend/pages/README.md` — route → file mapping
- `backend/migrations/README.md` — migration conventions and current file list
- `backend/seeds/README.md` — seed file format and re-runnability rules

## Current phase

**Phase 2 — database and domain foundation (complete).**

Phase 1 remains in place, plus:

- 18 migrations building 16 tables, with constraints, indexes and triggers
- 7 seed files loading reproducible demo data (re-runnable)
- Mermaid ERD and design documentation in `docs/database-erd.md`

Still to come: services and APIs, authentication, the storefront UI, checkout
and the admin area.

The Phase 1 infrastructure still in place:

- Express application with JSON parsing, CORS, Helmet, compression, rate limiting
- `/api/v1` versioned routing with a real health check and 501 placeholders
- Centralized success/error envelope, 404 handling and safe error responses
- PostgreSQL connection pool, health probe, migration runner and seed runner
- Validated environment configuration (`.env` is git-ignored)
- Frontend shell: design tokens, static dev server, API client, page/component conventions
- ESLint, Prettier, automated tests (`npm run verify`)

The database layer is done, but no product logic runs on it yet: there are no
repositories, services or endpoints for the catalogue, cart, checkout, orders or
admin.
