# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Roman Store — production container.
#
# One image runs the whole application. The Express API serves both `/api/v1`
# and the static storefront from `frontend/`, so the browser talks to a single
# origin and the session cookie stays `SameSite=Lax`. There is no separate web
# server and no build step: the frontend is plain ES modules.
#
# Build from the REPOSITORY ROOT so both workspaces are visible:
#
#   docker build -t roman-store .
#   docker run --rm -p 4000:4000 \
#     -e NODE_ENV=production \
#     -e DATABASE_URL=postgres://user:pass@host:5432/db \
#     -e DB_SSL=true \
#     -e JWT_SECRET=$(openssl rand -hex 48) \
#     -e JWT_REFRESH_SECRET=$(openssl rand -hex 48) \
#     -e PAYMENT_PROVIDER=NONE \
#     roman-store
#
# See docs/deployment.md for the full production checklist.
# ---------------------------------------------------------------------------

# ---- Stage 1: dependencies -------------------------------------------------
# Installed once, from the lockfile, with dev dependencies omitted. The runtime
# needs Express, pg and zod — not eslint, nodemon or PGlite.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production

# The lockfile pins every workspace, so all three manifests must be present for
# `npm ci` to resolve the tree. `--ignore-scripts` is deliberate: none of the
# runtime dependencies install native code, so no install script needs to run.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

RUN npm ci --omit=dev --ignore-scripts

# ---- Stage 2: runtime ------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# The base image already ships an unprivileged `node` user; use it.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
# `seeds/` and `migrations/` travel with the image so migrations can run on
# start and an operator can seed a demo database from the platform shell
# (`node backend/seeds/run.js --force`; refused in production otherwise). The
# root `npm run seed -- --force` shape does NOT forward `--force` past the
# nested workspace script, so call the runner directly.
COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend

USER node
EXPOSE 4000

# Readiness for the platform. `/health` answers 200 only when the database
# answers, so an instance that cannot reach Postgres is drained, not sent
# traffic. Uses the built-in fetch, so no tools need to be installed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrate, optionally load the demo catalogue, optionally create the bootstrap
# administrator, then hand the process straight to Node as PID 1 so SIGTERM
# reaches the graceful-shutdown handler in `server.js`. Migrations are idempotent
# and skip already-applied files, so a restart or a redeploy is a cheap no-op —
# and so are the seeds, which converge. Each `&&` is a gate: a failure aborts the
# boot rather than starting a half-initialised store.
#
# `SEED_DEMO_DATA=true` is for hosts with no way to run the seed runner by hand
# (Render's free plan has no Shell and no one-off jobs). It is off unless set, so
# a normal deployment ships an empty catalogue. A failing seed is fatal on
# purpose: better a loud failed deploy than a silently empty storefront.
#
# `backend/scripts/bootstrap-admin.js` is always run and does nothing unless
# BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are set, so the same image
# serves a demo and a real store.
CMD ["sh", "-c", "npm run migrate && { if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node backend/seeds/run.js --force; fi; } && node backend/scripts/bootstrap-admin.js && exec node backend/server.js"]
