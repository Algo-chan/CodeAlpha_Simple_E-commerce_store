# Backend

Express.js REST API, PostgreSQL data access, no business features yet.

```
backend/
├── server.js                 process entry point (listen + graceful shutdown)
├── scripts/create-database.js
├── migrations/               ordered SQL + runner (npm run migrate)
├── seeds/                    demo data runner (npm run seed)
├── tests/                    node:test + supertest
└── src/
    ├── app.js                builds the Express app
    ├── config/
    │   ├── env.js            .env loading + Zod validation
    │   ├── db.js             single pg.Pool + query logging + health probe
    │   └── constants.js      API paths, roles, error codes
    ├── routes/               URL → controller wiring
    │   ├── index.js
    │   ├── v1.routes.js
    │   ├── health.routes.js
    │   └── placeholder.routes.js
    ├── controllers/
    │   ├── health.controller.js
    │   └── placeholder.routes.js (factory used by placeholder.routes)
    ├── services/
    │   └── health.service.js
    ├── repositories/
    │   └── health.repository.js
    ├── middleware/
    │   ├── auth.js           authenticate / authorize (fail-closed)
    │   ├── security.js       helmet, CORS, rate limiters
    │   ├── validate.js       Zod request validation
    │   ├── not-found.js      404 handler
    │   └── error-handler.js  centralized error handler
    ├── validators/
    │   └── common.schema.js  shared Zod building blocks
    └── utils/
        ├── app-error.js      AppError (operational errors)
        ├── async-handler.js  async route wrapper
        ├── http-response.js  success/error envelope
        ├── database.js       select/execute/withTransaction/ping
        └── logger.js         levelled logger
```

## Request flow

```
route → controller → service → repository → PostgreSQL
```

Rules:

1. Routes only map URLs to controllers.
2. Controllers read the request, call a service, shape the response.
3. Services hold business logic and know nothing about HTTP.
4. Repositories contain SQL only, always parameterized.

`src/repositories/health.repository.js` → `src/services/health.service.js` →
`src/controllers/health.controller.js` → `src/routes/health.routes.js` is the
reference implementation to copy for every feature.

## Commands

```bash
npm run start            # production-style start
npm run dev              # nodemon watch mode
npm run db:create        # create the database if missing
npm run migrate          # apply migrations
npm run migrate:status   # applied / pending
npm run seed             # demo data
npm test                 # API tests
```

## Endpoints

- `GET /` — service banner
- `GET /api/v1/health` — API + database status
- `/api/v1/{auth,products,categories,cart,wishlist,orders,payments,reviews,users,admin}`
  — mounted placeholders returning `501 NOT_IMPLEMENTED`

See `docs/api.md` for the full contract.
