# Architecture

## Style: modular monolith

One deployable Node.js application, one PostgreSQL database, one static
frontend. No microservices: at this scale they would add network calls,
deployment complexity and debugging overhead without any benefit. The code is
split into **modules** with strict dependency rules instead, so a module can be
extracted into its own service later if it ever needs to be.

## Layers

```
Browser
  │  fetch() + JSON
  ▼
Frontend (static HTML/CSS/JS)
  │  HTTP /api/v1/...
  ▼
Express application (src/app.js)
  │  middleware: helmet → cors → rate limit → json parser
  ▼
Routes            – map URLs to controllers. No business logic.
  ▼
Controllers       – read req, call a service, shape the response. No SQL, no rules.
  ▼
Services          – business logic (cart maths, stock checks, order creation).
  ▼
Repositories      – SQL only, parameterized queries only.
  ▼
PostgreSQL        – pool from src/config/db.js
```

### Dependency rules

- Routes → Controllers → Services → Repositories → `pg`.
- A layer may only import from the layer directly below it (plus `utils`,
  `config` and `middleware`).
- Controllers **never** write SQL. Services **never** touch `req`/`res`.
- Repositories **never** contain business rules.

## Request lifecycle (worked example: health check)

1. `GET /api/v1/health` arrives.
2. `app.js` middleware: security headers, CORS check, compression, JSON parser,
   rate limiter.
3. `routes/index.js` (mounted at `/api/v1`) → `routes/v1.routes.js` →
   `routes/health.routes.js` mounts `GET /`.
4. `controllers/health.controller.js` wraps the call in `asyncHandler` and calls
   `services/health.service.js`.
5. The service calls `repositories/health.repository.js`, which runs
   `SELECT 1` through `utils/database.js` (parameterized, pool-managed).
6. The controller sends the response through `utils/http-response.js`
   (`{ success: true, data: {...} }`).
7. Any thrown `AppError` lands in `middleware/error-handler.js` and becomes the
   standard error envelope.

This is the reference vertical slice. Every future feature copies this shape:

```
routes/x.routes.js  →  controllers/x.controller.js  →  services/x.service.js  →  repositories/x.repository.js
```

## Folder responsibilities

### Backend (`backend/`)

| Path                      | Responsibility                                                     |
| ------------------------- | ------------------------------------------------------------------ |
| `server.js`               | Process entry point: start listening, graceful shutdown            |
| `src/app.js`              | Builds the Express app (exported separately so tests can mount it) |
| `src/config/env.js`       | Loads and validates `.env`; fails fast with a readable message     |
| `src/config/db.js`        | Single `pg.Pool`, query logging, health probe, graceful close      |
| `src/config/constants.js` | API paths, roles, error codes, pagination limits                   |
| `src/routes/`             | URL → controller wiring, API versioning                            |
| `src/controllers/`        | HTTP in/out: validate flow, call service, respond                  |
| `src/services/`           | Business logic, framework-independent                              |
| `src/repositories/`       | Database access, parameterized SQL                                 |
| `src/middleware/`         | auth, authorization, validation, security, rate limit, 404, errors |
| `src/validators/`         | Zod schemas for request bodies/params/queries                      |
| `src/utils/`              | `AppError`, `asyncHandler`, response helpers, logger, DB helpers   |
| `migrations/`             | Ordered SQL files + runner (`npm run migrate`)                     |
| `seeds/`                  | Development demo data (`npm run seed`)                             |
| `scripts/`                | Maintenance scripts (`npm run db:create`)                          |
| `tests/`                  | `node:test` + supertest API tests                                  |

### Frontend (`frontend/`)

| Path                   | Responsibility                                              |
| ---------------------- | ----------------------------------------------------------- |
| `index.html`, `pages/` | One HTML file per route                                     |
| `partials/`            | Shared HTML fragments (navbar, footer) fetched at runtime   |
| `components/`          | One component per file, each a factory returning a DOM node |
| `css/tokens.css`       | Design tokens: color, spacing, radius, shadow, type, motion |
| `css/base.css`         | Reset, element defaults, accessibility defaults             |
| `css/layout.css`       | Container, grid, responsive breakpoints                     |
| `css/utilities.css`    | Small single-purpose helpers                                |
| `css/main.css`         | The only stylesheet pages load; imports the above           |
| `js/config.js`         | API base URL and runtime config                             |
| `js/core/api.js`       | `fetch` wrapper: envelope unwrapping, timeout, `ApiError`   |
| `js/core/dom.js`       | `el()`, `append()`, `loadPartial()`, `qs()`                 |
| `js/core/registry.js`  | Component registration convention                           |
| `js/main.js`           | Injects partials and boots the page module                  |
| `js/pages/`            | One module per page                                         |
| `server.js`            | Static dev server (`npm run dev:frontend`)                  |

### Docs and tooling

| Path                  | Responsibility                                          |
| --------------------- | ------------------------------------------------------- |
| `package.json` (root) | npm workspaces, shared scripts, lint/format/test        |
| `eslint.config.js`    | Flat config with separate Node and browser environments |
| `.prettierrc.json`    | One formatting standard for all file types              |
| `.env.example`        | Documented template for every environment variable      |

## Architectural decisions

1. **Express 5 + ES modules everywhere.** `type: "module"` in both workspaces,
   so the frontend and backend share one language standard and `import` syntax.
2. **Versioning in the router, not the URL strings.** `API_BASE_PATH` (`/api/v1`)
   is defined once in `config/constants.js`; `routes/v1.routes.js` holds v1
   endpoints, so `/api/v2` can be mounted later without touching v1.
3. **Placeholders return 501, not empty 200s.** Every planned resource is
   mounted and answers `NOT_IMPLEMENTED`, so the URL surface is visible and
   testable without shipping fake business logic.
4. **Authentication fails closed.** `authenticate` currently returns 501 rather
   than letting requests through; `authorize()` implements role checking
   properly because it is generic infrastructure.
5. **Hand-written migration runner.** ~150 lines of readable code instead of a
   framework dependency. It tracks files in `schema_migrations` with a checksum,
   and runs each file in a transaction.
6. **One pool per process.** `config/db.js` exports the only pool. Repositories
   import helpers from `utils/database.js`, so connection settings are changed in
   exactly one place.
7. **Parameterized queries only.** No string concatenation in SQL, anywhere.
   Identifiers that cannot be parameterized (migration file names, `CREATE
DATABASE`) are validated or read from our own config.
8. **Zod for validation.** One schema library for request validation and
   environment validation, with typed field errors returned to the client.
9. **Vanilla frontend with a component contract.** Each component is
   `(props) => HTMLElement` in its own file; `js/core/dom.js` and
   `js/core/api.js` replace framework conveniences without hiding the platform.
10. **Static frontend server on its own port.** CORS is real and exercised during
    development; in production the same folder can be served statically by
    Express (`env.isProduction`).
11. **Errors never leak internals.** `AppError` carries a safe message; the
    error handler logs stack traces server-side and returns generic text in
    production.
12. **npm workspaces.** One `npm install` at the root, one lockfile, shared
    tooling versions.

## Error handling

Success:

```json
{ "success": true, "data": {} }
```

Error:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Human-readable message" }
}
```

`middleware/error-handler.js` maps `AppError`, known PostgreSQL error codes
(unique/foreign-key/check violations), and everything else (logged with a stack
trace, answered with a generic message in production).

## Security foundation (prepared, not over-engineered)

| Concern          | Current state                                                      |
| ---------------- | ------------------------------------------------------------------ |
| Secrets          | `.env` git-ignored, `.env.example` committed, `.env.local` blocked |
| Env validation   | Zod schema, production requires a strong `JWT_SECRET`              |
| Password hashing | `BCRYPT_SALT_ROUNDS` configured; `bcrypt` used when auth is built  |
| Authentication   | `middleware/auth.js` structure, fails closed with 501              |
| Authorization    | `authorize(ROLES.ADMIN, ...)` implemented and role-checked         |
| Input validation | `middleware/validate.js` + Zod schemas                             |
| SQL injection    | Parameterized queries only, enforced by convention                 |
| HTTP headers     | Helmet on every response                                           |
| CORS             | Explicit origin allowlist from `FRONTEND_URL`                      |
| Rate limiting    | Global API limiter; stricter limiter ready for auth routes         |
| Error leakage    | Stack traces and internal messages never sent in production        |
| Body size        | JSON/urlencoded limited to 100 kB                                  |

## Testing strategy

`node:test` + `supertest`, no extra framework. The app is mounted in-process, so
tests need no running server and no database (the health check degrades
gracefully when PostgreSQL is absent).

```bash
npm test         # API tests
npm run verify   # lint + format check + tests
```
