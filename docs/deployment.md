# Deployment

This guide takes the repository from a clean checkout to a running production
deployment, and covers the parts a release depends on: architecture, environment,
database, storage, payments, monitoring, backups and rollback.

It assumes **no unnecessary infrastructure**: one Node.js process, one managed
PostgreSQL database, and object storage for images. That is enough for a small
team to operate, and every piece has a managed option.

---

## 1. Production architecture

```
                          ┌──────────────────────────────┐
   Customer ── HTTPS ────▶ │  Platform edge / CDN / TLS    │
                          └──────────────┬───────────────┘
                                         │
                        ┌────────────────┴─────────────────┐
                        │                                  │
                        ▼                                  ▼
            ┌───────────────────────┐          ┌────────────────────────┐
            │  Static storefront    │          │  Express / Node.js API │
            │  HTML · CSS · JS      │  fetch   │  /api/v1/*  /health    │
            │  (served by Express   │─────────▶│  sessions · CSRF       │
            │   in production, or   │          │  rate limits · CSP     │
            │   by a static host)   │          └───────────┬────────────┘
            └───────────────────────┘                      │ pg pool
                                                           ▼
                                              ┌────────────────────────┐
                                              │      PostgreSQL        │
                                              │  data · ledger · audit │
                                              └────────────────────────┘

   Supporting services
   -------------------
   Images         object storage + CDN — the API stores only URLs
   Payments       a provider adapter (COD and a sandbox exist today)
   Email          optional; none is wired in yet
   Logs/metrics   the platform log drain + uptime monitor on /health
```

The contract in one line: **the browser only ever talks HTTPS to one origin**
(the storefront and `/api/v1`), which is why the production cookie is
`Secure` + `SameSite=Lax` and why the CSP only allows `connect-src 'self'`.

The Express process is a **modular monolith** — routes → controllers → services →
repositories — so there is nothing to coordinate between services. This app
deliberately does **not** add a queue, a cache tier, a separate search engine or
a microservice: at this scale each would add an operational failure mode without
removing work.

---

## 2. Hosting requirements

| Component     | Requirement                                                                    |
| ------------- | ------------------------------------------------------------------------------ |
| Node.js       | **20 LTS or newer** (the workspace declares `engines.node >= 20`)              |
| PostgreSQL    | **13 or newer**; 15/16 recommended. `gen_random_uuid()` is built in from 13    |
| Memory        | 256–512 MB is comfortable for the API; the storefront is static                |
| Storage       | none on the app host — images live in object storage, not on the server's disk |
| TLS           | terminated by the platform or a reverse proxy; the app never serves plain HTTP |
| Process model | one web process; the platform may run 1–N replicas (stateless except the DB)   |

No build toolchain is required: the frontend is plain HTML/CSS/JS with no compile
step, and the backend runs on Node directly.

---

## 3. Environment variables

Every variable is documented in [`.env.example`](../.env.example). **Copy nothing
into the repo.** Set values through the hosting platform's secret manager /
environment panel; `.env` is git-ignored and must never be uploaded or baked into
an image.

Minimum production set:

| Variable                 | Production value                                                                 |
| ------------------------ | -------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production` (enables CSP, `Secure` cookies, generic errors, fail-fast checks)   |
| `PORT`                   | the port the platform routes to (often injected by the host)                     |
| `FRONTEND_URL`           | the exact HTTPS storefront origin, e.g. `https://shop.example.com` — never `*`   |
| `PUBLIC_ORIGIN`          | the deployment's own origin when a custom domain fronts it (Render: automatic)   |
| `DATABASE_URL`           | `postgres://user:pass@host:5432/db?sslmode=require` (or the `DB_*` parts)        |
| `DB_SSL`                 | `true` for any managed database                                                  |
| `DB_POOL_MAX`            | `10` (see §5 — keep `instances × max < server max_connections`)                  |
| `JWT_SECRET`             | ≥ 32 random chars (required by the env schema even though sessions are the auth) |
| `JWT_REFRESH_SECRET`     | ≥ 32 random chars, different from `JWT_SECRET`                                   |
| `PAYMENT_PROVIDER`       | `NONE` for a COD-only launch (see §7)                                            |
| `PAYMENT_WEBHOOK_SECRET` | ≥ 16 random chars whenever `PAYMENT_PROVIDER` is not `NONE`                      |
| `LOG_LEVEL`              | `info`                                                                           |
| `API_BASE_URL`           | public API URL, used to build the CSP `connect-src` when it is not same-origin   |

Generate secrets locally and paste only the result into the platform:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

The config layer validates the environment with Zod and the process **exits on
start** if a production rule is broken (a weak `JWT_SECRET`, an active payment
provider without a webhook secret, etc.). A failed deploy is far cheaper than a
misconfigured one.

---

## 4. Database deployment

### Create

On a managed host the database already exists; skip `db:create`. Self-hosted:

```bash
npm run db:create      # creates the database if missing
```

### Migrate

Migrations are ordered SQL files applied in a transaction, tracked in
`schema_migrations` with a checksum. Run them as a **release step**, before the
new process takes traffic:

```bash
npm run migrate        # apply pending migrations
npm run migrate:status # list applied / pending
```

Rules:

- Never edit an applied migration — add a new one.
- `DB_POOL_MAX` during a migration can be `1`; migrations are sequential.
- A failed migration rolls that file back and stops the run.

### Seeds

`backend/seeds/` loads **demo** users, products, orders and payments. It is for
development only. The runner refuses to run when `NODE_ENV=production` unless
`--force` is passed; a production launch should not use it at all unless you
intentionally want the demo catalogue:

```bash
node backend/seeds/run.js            # dev: loads demo data
node backend/seeds/run.js --force    # explicitly, in production
```

Call the runner directly, as above. The root shortcut
`npm run seed -- --force` does **not** work: npm appends the extra argument to
the nested workspace script, where the inner `npm` consumes `--force` as one of
its own flags. The seed is then refused, with nothing to say the flag went
missing.

#### Seeding a host that has no shell

Render's free plan provides neither Shell access nor one-off jobs, so there is
no way to run the command above by hand. `SEED_DEMO_DATA=true` makes the
container's start command seed after migrating and before it serves:

```bash
docker run ... -e SEED_DEMO_DATA=true roman-store
```

This is what `render.yaml` sets. The seeds converge, so the cost is one pass on
the first boot and a cheap no-op afterwards, including after the platform
recreates the database. Leave the flag unset to deploy an empty catalogue, and
consider a paid instance — which restores Shell access — when you need to seed
deliberately.

### Verify against real PostgreSQL

The automated suite runs on **PGlite** (PostgreSQL compiled to WebAssembly), so
it needs no server. Before a release, run the complementary verification against
a real, networked PostgreSQL — a staging or throwaway database, never production:

```bash
npm run verify:db
```

It checks the server version (≥ 13), applies the migrations, and asserts that
every table and index exists, that the coupon-cap constraint and the category
cycle trigger reject bad data, and that **six concurrent deductions for the last
unit produce exactly one winner and never a negative balance**. That last check
is the oversell guard exercised over real connections and real row locks.

### Indexes, constraints and transactions

- Inventories are guarded by a single conditional `UPDATE ... WHERE quantity -
reserved_quantity >= n`, so the check and the decrement are atomic. Checkout
  runs inside `runInTransaction`; stock, the ledger and the order commit or roll
  back together.
- Foreign keys use `ON DELETE CASCADE` where children cannot outlive the parent
  (variants, inventory, cart items) and `ON DELETE RESTRICT` where deletion would
  lose history (a product's category).
- `024_add_indexes_and_integrity.sql` adds the query-path indexes and the
  `coupons_used_within_max` CHECK.

---

## 5. Connection pooling and failures

One pool is created per process in `backend/src/config/db.js` and reused for every
request — the app never opens a per-request connection.

| Variable                   | Default | Notes                                   |
| -------------------------- | ------- | --------------------------------------- |
| `DB_POOL_MAX`              | 10      | max clients per process                 |
| `DB_POOL_IDLE_TIMEOUT_MS`  | 30000   | idle clients are closed                 |
| `DB_CONNECTION_TIMEOUT_MS` | 5000    | fail a query instead of hanging forever |

Sizing rule: `replicas × DB_POOL_MAX < database max_connections` (managed
PostgreSQL often caps at 20–100). Growing the pool past that is how a healthy
deploy starts refusing connections.

Failure behaviour:

- A **connection failure at startup** is logged and the API still starts; `/health`
  reports `degraded` until the database answers. This keeps the process alive for
  an orchestrator to observe rather than crash-looping.
- A **query failure** returns the standard error envelope; the database error is
  logged server-side and never leaked to the client.
- **Graceful shutdown**: `SIGTERM`/`SIGINT` stops accepting connections, drains
  in-flight requests, ends the pool, and exits. The platform should send `SIGTERM`
  and wait before force-killing.

---

## 6. File and image storage

**The API does not accept uploads.** A product or category image is a URL
(`imageUrl`) pointing at object storage or a CDN; the database stores the URL, and
the request validator now requires an **absolute `http(s)` URL**, rejecting
`javascript:`, `data:` and scheme-less paths so no executable value can reach an
`<img src>`.

This is deliberate: durable user content must never live on the app host's disk,
because that disk is replaced on every deploy and is not shared between replicas.

If an upload surface is added later, it must:

1. put bytes in object storage (S3-compatible, or the platform's blob store), never
   on the local filesystem;
2. validate the **file type by content** (magic bytes), not the extension, plus a
   size limit and a sanitised/generated filename;
3. serve through the CDN, keep the API out of the byte path, and store only the
   resulting URL.

---

## 7. Payment configuration

`PAYMENT_PROVIDER` selects the online gateway adapter. **Today only two adapters
exist: `COD` (internal, always available) and `MOCK` (a sandbox).** There is no
real provider adapter registered yet, so:

- For a **COD-only production launch, set `PAYMENT_PROVIDER=NONE`.** Online
  checkout is then refused cleanly; a shopper sees COD only.
- **Do not run production traffic on `MOCK`** — it issues fake intents and fake
  signed webhooks, so a shopper could "pay" with nothing. The config layer allows
  it (it needs a webhook secret), which is exactly why it must be a conscious
  choice: leave it unset/`NONE` on a real launch.

When a real adapter is added (register it in `src/payments/index.js`), enable it
only after all of these hold:

| Check                    | Where it lives                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Credentials              | platform secret manager, never the repo                                                   |
| Webhook over HTTPS       | `FRONTEND_URL`/`API_BASE_URL` are HTTPS; webhook URL uses the same                        |
| Signature validation     | HMAC over the **raw** request body (the app keeps `req.rawBody`)                          |
| Timestamp / replay guard | `PAYMENT_WEBHOOK_TOLERANCE_SECONDS` (default 300)                                         |
| Idempotency              | the provider event id is stored; a repeat is a no-op, not a second sale                   |
| Amount + currency        | re-read from the order and compared to the signed payload, never trusted from the request |

The payment status is **never taken from a client**. A checkout creates a
`PENDING` intent; only a signature-verified notification moves it to `PAID`, in a
transaction that also records the order transition.

---

## 8. Domain, HTTPS and CORS

- Terminate TLS at the platform edge or reverse proxy; never serve auth over HTTP.
- Set `FRONTEND_URL` to the **exact** HTTPS origin. CORS reflects only allowed
  origins; `*` is refused.
- A browser sends an `Origin` header even on a **same-origin** write, so the origin
  the app is itself served from must also be allowed. `PUBLIC_ORIGIN` covers a
  custom domain; on Render, `RENDER_EXTERNAL_URL` is injected and trusted
  automatically, so the default `*.onrender.com` origin needs no configuration.
- In production the auth cookie is set `Secure`, `HttpOnly`, `SameSite=Lax`, so it
  is transmitted only over HTTPS.
- The storefront served by Express is same-origin with the API; a split deployment
  (static host + separate API host) must inject `window.__APP_CONFIG__` and add the
  API origin to `API_BASE_URL` for the CSP `connect-src`.

---

## 9. Logging and monitoring

| Signal             | Source                                         | Suggested alert          |
| ------------------ | ---------------------------------------------- | ------------------------ |
| Liveness/readiness | `GET /health` (503 when the DB is unreachable) | `status != ok` for 2 min |
| App health detail  | `GET /api/v1/health`                           | informational            |
| Application errors | server logs (`LOG_LEVEL=info`), 5xx rate       | 5xx spike                |
| Database errors    | server logs                                    | any sustained error      |
| Payment failures   | server logs / `payments` table (`FAILED`)      | any                      |
| Failed orders      | `orders` with an error transition              | any                      |

`/health` is mounted outside `/api/v1` and **before** the rate limiter, so a
monitor polling every few seconds neither exhausts the public budget nor throttles
itself. It returns only `status`, `database` and `uptime` — never a version, a
connection string or a stack trace.

Logs are levelled and line-oriented (`debug|info|warn|error|silent`); a real
deployment swaps `utils/logger.js` for pino/winston without touching call sites.
**Never log secrets, session tokens, card data or full request bodies.** Point the
platform log drain at stdout/stderr; the app does not write log files.

---

## 10. Backups

| Aspect    | Recommendation                                                        |
| --------- | --------------------------------------------------------------------- |
| Method    | managed provider's automated snapshots / PITR; else nightly `pg_dump` |
| Frequency | daily full + continuous WAL/PITR where available                      |
| Retention | 7 daily, 4 weekly, 12 monthly (adjust to policy)                      |
| Storage   | a different region/bucket from the database, encrypted at rest        |
| Restore   | **tested** — an untested backup is not a backup                       |

Restore procedure (self-managed example):

```bash
# 1. provision a fresh database
createdb ecommerce_store_restore
# 2. restore the dump
pg_restore --dbname=ecommerce_store_restore --clean --no-owner backup.dump
# 3. apply any migrations newer than the dump
DATABASE_URL=postgres://.../ecommerce_store_restore npm run migrate
# 4. point a staging app at it and run the smoke test
DATABASE_URL=postgres://.../ecommerce_store_restore npm run verify:db
```

Record the result of the last restore drill (date, who, duration) in your runbook.

---

## 11. Deployment, rollback and CI/CD

### Deployment

The repository ships the artifacts for a container deploy, so a platform only
has to build and run them:

- **Docker image** — `Dockerfile` builds a two-stage image (production
  dependencies only), runs as the unprivileged `node` user, exposes `/health` as a
  `HEALTHCHECK`, and applies migrations before starting the server. `.dockerignore`
  keeps `node_modules`, `.git` and every `.env` out of the build context.
- **Render Blueprint** — `render.yaml` provisions the Docker web service _and_ a
  managed PostgreSQL, binds `DATABASE_URL`, generates `JWT_SECRET` and
  `JWT_REFRESH_SECRET`, and points Render's health check at `/health`. Create a
  Blueprint from the repository and Render applies the file; no credentials live in
  it.
- **Local rehearsal** — `docker compose up --build` runs the same image against a
  throwaway PostgreSQL on [http://localhost:4000](http://localhost:4000).

Manual options, if you would rather wire it yourself:

- **PaaS (Railway / Fly.io / Heroku):** build from the `Dockerfile`, or connect
  the repo and run `npm ci && npm run migrate` as the release command, `npm start`
  as the web command. The database and object storage are add-ons.
- **VPS + reverse proxy:** `npm ci --omit=dev`, run migrations, supervise
  `npm start` with systemd, terminate TLS at nginx/Caddy.

Migration runs on every boot and is idempotent, so a restart or a redeploy is a
cheap no-op. The storefront is served by the API in production
(`env.isProduction`), so there is one artifact and one origin — no separate
frontend deploy to keep in sync.

### Rollback

- **Application:** redeploy the previous release / image tag. The process is
  stateless, so this is instant.
- **Database:** migrations are forward-only. There is no automatic down script.
  To undo a schema change, ship a **new migration** that reverses it — or, for a
  catastrophic change, restore the pre-deploy backup (§10) and redeploy the old
  app version against it.

Because migrations run before the new process starts, an app rollback does **not**
auto-revert the schema. Keep migrations backward-compatible for one release
(add nullable columns first; drop them a release later).

### CI/CD

`.github/workflows/ci.yml` runs on every push/PR:

- **quality** — `npm ci`, lint, format check, the full backend and frontend tests;
- **database** — a real `postgres:16` service, migrations, seeds, and
  `npm run verify:db`.

A red CI run must block the deploy. The platform (or a follow-up workflow) deploys
only from a green `main`. Keep staging and production on separate databases and
separate secret sets.

---

## 12. Production release checklist

The full checklist lives in [production-checklist.md](./production-checklist.md).
The short version: green CI, migrations applied, `NODE_ENV=production`, HTTPS +
`Secure` cookies, secrets in the platform, `PAYMENT_PROVIDER=NONE` (or a verified
adapter), `/health` green, backups configured and a restore tested, and the
customer journey in §"Smoke test" exercised once by hand.

---

## 13. Troubleshooting

| Symptom                                  | Likely cause / fix                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Process exits immediately on boot        | env validation failed — read the logged Zod message (weak secret, `MOCK` on) |
| `/health` returns 503                    | database unreachable or `DB_SSL`/`DATABASE_URL` wrong                        |
| Login succeeds but the cookie is dropped | `FRONTEND_URL` does not match the browser origin, or TLS is not HTTPS        |
| CORS error in the browser                | origin not in `FRONTEND_URL` (must be exact, with scheme)                    |
| `429` under normal traffic               | pool/rate-limit tuning; check `/health` for a slow database, not the limits  |
| `too many connections` from PostgreSQL   | `replicas × DB_POOL_MAX` exceeds `max_connections` — lower `DB_POOL_MAX`     |
| Images blocked in the console            | the CSP only allows `https:` images; store images on HTTPS storage           |
| Orders fail with a stock error           | correct: the oversell guard refused a sale it could not fulfil               |

---

## See also

- [production-checklist.md](./production-checklist.md) — the final pre-launch list
- [architecture.md](./architecture.md) — layers and request lifecycle
- [security.md](./security.md) — auth, headers, CSP, rate limits, payment security
- [performance.md](./performance.md) — indexes, caching, pagination, budget
- [testing.md](./testing.md) — test layout and how to run everything
- [setup.md](./setup.md) — local installation
