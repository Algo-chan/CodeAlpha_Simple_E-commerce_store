# Setup Guide

| Tool       | Version                         | Notes                                                                  |
| ---------- | ------------------------------- | ---------------------------------------------------------------------- |
| Node.js    | 20 or newer (22/24 recommended) | `node --version`                                                       |
| npm        | 10 or newer                     | ships with Node                                                        |
| PostgreSQL | 14 or newer                     | server + client tools; needed to run the app, **not** to run the tests |
| Git        | any recent version              |                                                                        |

## 1. Install dependencies

From the repository root:

```bash
npm install
```

This is an npm workspace: one install covers the backend and the frontend.

## 2. Configure the environment

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# PowerShell
Copy-Item .env.example .env
```

Edit `.env` and set at least:

```ini
PORT=4000
FRONTEND_URL=http://localhost:5173
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=ecommerce_store
```

Generate a strong secret for `JWT_SECRET` (required in production):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` is git-ignored. Never commit it.

## 3. Install and start PostgreSQL

Only needed to run the application and to inspect data in `psql`. `npm test`
and `npm run verify` work without a server.

### Windows

1. Download the installer from <https://www.postgresql.org/download/windows/>.
2. Keep the defaults; set a superuser password and remember it.
3. The service usually starts automatically. Verify:

```powershell
Get-Service postgresql*
psql --version
```

If `psql` is not on `PATH`, add `C:\Program Files\PostgreSQL\<version>\bin`
to your system `PATH`.

### macOS

```bash
brew install postgresql@16
brew services start postgresql@16
```

### Linux (Debian/Ubuntu)

```bash
sudo apt install postgresql
sudo systemctl start postgresql
```

## 4. Create the database

```bash
npm run db:create
```

Creates `DB_NAME` if it does not exist. Safe to run repeatedly.

## 5. Run migrations and seeds

```bash
npm run migrate
npm run migrate:status
npm run seed
```

This builds the full schema — 16 tables, their constraints, indexes and
triggers — and then loads demo data. `npm run seed` is idempotent, so running it
again is safe.

Check the result:

```bash
npm run migrate:status

psql -U postgres -h localhost -d ecommerce_store -c "\dt"
psql -U postgres -h localhost -d ecommerce_store -c "SELECT slug, price FROM product_variants LIMIT 5;"
```

A working seed run ends with 9 products, 21 variants and 3 orders. See
[database-erd.md](./database-erd.md) for the schema and what each table holds.

Note that `npm test` does **not** need a running server: the schema suites run
against an in-process PostgreSQL. Steps 3 to 5 are only needed to use the app
and to inspect the data in `psql`.

## 6. Run the application

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:4000>
- Health check: <http://localhost:4000/api/v1/health>

Run the halves separately if you prefer:

```bash
npm run dev:backend
npm run dev:frontend
```

Production-style start (no file watching):

```bash
npm start
```

## 7. Verify the setup

```bash
npm run verify        # lint + format check + tests
curl http://localhost:4000/api/v1/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "api": "healthy",
    "database": "connected",
    "environment": "development"
  }
}
```

Open <http://localhost:5173> — the "System status" card shows the same
information, which proves the browser can reach the API.

## All commands

| Command                           | Description                        |
| --------------------------------- | ---------------------------------- |
| `npm run dev`                     | Frontend + backend with hot reload |
| `npm run dev:backend`             | API only (nodemon)                 |
| `npm run dev:frontend`            | Static frontend server only        |
| `npm start`                       | Backend without watching           |
| `npm run db:create`               | Create the PostgreSQL database     |
| `npm run migrate`                 | Apply pending migrations           |
| `npm run migrate:status`          | Show applied / pending migrations  |
| `npm run seed`                    | Load demo data                     |
| `npm test`                        | API + schema tests (no DB needed)  |
| `npm run lint` / `lint:fix`       | ESLint                             |
| `npm run format` / `format:check` | Prettier                           |
| `npm run verify`                  | Lint + format check + tests        |

## Troubleshooting

**`Database not reachable` warning, health shows `degraded`**
PostgreSQL is not running or `.env` credentials are wrong. Check the service,
then `psql -U postgres -h localhost -d ecommerce_store`.

**`password authentication failed for user "postgres"`**
`DB_PASSWORD` does not match the superuser password.

**`port 4000 is already in use`**
Change `PORT` in `.env`.

**`CORS blocked` / status shows `offline`**
The frontend origin is missing from `FRONTEND_URL`. It must match exactly,
including port, and be a comma-separated list.

**`Invalid environment configuration` on start**
`.env` is missing a required value; the message names the exact key. In
production, `JWT_SECRET` must be at least 32 characters.

**Frontend shows a 404 for a new page**
New pages belong in `frontend/pages/<name>.html` and need a matching module in
`frontend/js/pages/`.
