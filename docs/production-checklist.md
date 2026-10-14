# Production Checklist

Run this list top to bottom before a release. Items marked **verify** need a real
check, not an assumption. The commands assume the repo root.

See [deployment.md](./deployment.md) for the how behind each item.

---

## 1. Pre-flight (repo)

- [ ] `git status` is clean; the release is a tagged commit.
- [ ] `npm ci` succeeds from the lockfile.
- [ ] `npm run lint` passes.
- [ ] `npm run format:check` passes.
- [ ] `npm run test:backend` passes (393 tests).
- [ ] `npm run test:frontend` passes (263 tests).
- [ ] CI is green (`.github/workflows/ci.yml`), including the PostgreSQL job.
- [ ] No secrets in the diff: `git grep -iE "secret|password|api[_-]?key" -- ':!.env.example'`.

## 2. Security

- [ ] `NODE_ENV=production` on the web process.
- [ ] HTTPS only; HTTP redirects to HTTPS at the edge.
- [ ] `FRONTEND_URL` is the exact HTTPS origin — **not** `*`, **not** localhost.
- [ ] Auth cookie is `Secure` + `HttpOnly` + `SameSite=Lax` (verify in the browser).
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are ≥ 32 random chars and different.
- [ ] `PAYMENT_WEBHOOK_SECRET` is set if online payments are enabled.
- [ ] All secrets live in the platform secret manager; `.env` is **not** deployed.
- [ ] Security headers present on responses: CSP, HSTS, `X-Content-Type-Options`,
      `Referrer-Policy`, `X-Frame-Options`/`frame-ancestors`.
- [ ] CSP is the **production** policy (`script-src 'self'`; no `unsafe-inline` for
      scripts) and the app loads without console errors.
- [ ] Rate limits active: global API, auth, write, search.
- [ ] No stack traces, SQL text, file paths or secrets in any production error.
- [ ] `trust proxy` matches the actual number of proxies in front of the app.

## 3. Database

- [ ] PostgreSQL **13+** (15/16 recommended); confirmed with `SELECT version()`.
- [ ] `npm run migrate` has applied every migration (`npm run migrate:status`).
- [ ] Demo seeds were **not** loaded (`NODE_ENV=production` refuses them without
      `--force`). Load real catalogue data through the admin UI instead.
- [ ] `npm run verify:db` passed against a real PostgreSQL (staging/throwaway).
- [ ] Required indexes exist (the four from migration 024 plus the base set).
- [ ] `coupons_used_within_max` constraint exists.
- [ ] Oversell guard verified: concurrent deductions for the last unit → one winner.
- [ ] `replicas × DB_POOL_MAX < max_connections`.
- [ ] `DB_SSL=true` for a managed/hosted database.
- [ ] Automated backups enabled and retention set.
- [ ] **A restore has been tested** and the result recorded in the runbook.

## 4. Application

- [ ] `npm run migrate` runs as the release step, before the app takes traffic.
- [ ] `npm start` serves the API **and** the storefront on one origin.
- [ ] `GET /health` returns `200` + `{"status":"ok"}` (and `503` when the DB is down).
- [ ] `GET /api/v1/health` reports `database: connected`.
- [ ] `GET /` returns the API landing envelope, not a 404 or an HTML error.
- [ ] `API_BASE_URL` is correct; the storefront resolves the API (same-origin or injected).
- [ ] Static assets are served with `Cache-Control`; HTML is `no-cache`.
- [ ] Compression is on (gzip/brotli) for text responses.
- [ ] Graceful shutdown drains in-flight requests on `SIGTERM`.
- [ ] `LOG_LEVEL=info`; logs go to the platform drain, not to local files.

## 5. Business flows

- [ ] Product browsing: home, category, product detail, variant selection.
- [ ] Search and type-ahead suggestions return results.
- [ ] Cart: add, update quantity, remove, clear; totals match.
- [ ] Checkout (COD): order created, stock falls, cart empties, payment `PENDING`.
- [ ] Oversell impossible: a second shopper for the last unit is refused.
- [ ] Online payment (only if enabled): real provider, signatures, sandbox test.
- [ ] Orders: history lists the order; detail shows lines and totals.
- [ ] Inventory: restock/damage adjust the balance and write a ledger row.
- [ ] Admin: login, dashboard, product, inventory, order, status update.
- [ ] Admin RBAC: a guest gets 401, a customer gets 403 on `/api/v1/admin/*`.

## 6. Mobile

- [ ] Responsive layout at 320 px, 375 px, 414 px, 768 px.
- [ ] Navigation (menu/drawer) opens, is keyboard-usable and closes.
- [ ] Product page: gallery, variant picker, add-to-cart reachable and tappable.
- [ ] Cart: quantity controls usable with a thumb; sticky summary correct.
- [ ] Checkout: form fields are not zoomed by iOS (font ≥ 16 px) and inputs have the
      right `inputmode`/`autocomplete`.

---

## 7. End-to-end smoke test

Run the automated journey first:

```bash
node --test backend/tests/smoke.production.test.js   # from the repo root
```

Then walk it once by hand against the deployed environment:

**Guest** — Homepage → category → product → variant → cart → checkout → **COD order**;
note the order number; confirm the confirmation page.

- [ ] Completed, order number looks like `ORD-YYYYMMDD-NNNN`.

**Authenticated customer**

- [ ] Register → login → browse → add to cart → checkout → order history shows the order.

**Admin**

- [ ] Login → dashboard → open the product → adjust inventory → open the order →
      update its status.

## 7b. Release

- [ ] Tag the release (e.g. `v1.0.0`) and push the tag.
- [ ] Deploy; the release step applies migrations before traffic.
- [ ] Run `/health` and the smoke test against the live origin.
- [ ] Watch 5xx/error logs for 15 minutes.
- [ ] Announce the release and record the deployed commit + rollback target.

---

## Sign-off

| Field           | Value |
| --------------- | ----- |
| Release / tag   |       |
| Date            |       |
| Deployed commit |       |
| Verified by     |       |
| Rollback target |       |
