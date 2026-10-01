# Migrations

Raw, ordered SQL files. Applied by `npm run migrate` (see `run.js`).

## Naming

```
001_create_products.sql
002_create_categories.sql
003_add_product_indexes.sql
```

Three digits + snake_case description. Files are applied in ascending order and
recorded in the `schema_migrations` table, so each file runs exactly once.

## Rules

1. **One logical change per file** (for example, one table plus its indexes).
2. **Forward-only.** Never edit a migration that has already been applied —
   write a new one. The runner warns when checksums do not match.
3. **Idempotent where practical** — prefer `IF NOT EXISTS` so a migration can be
   replayed safely on a fresh database.
4. **Parameterized data is not allowed** here; migrations only contain DDL.
5. **Never commit real data.** Use the `seeds/` folder for demo data.

## Template

Copy `_template.sql.example` to `001_your_change.sql` and edit it. The template
is ignored by the runner because it does not end with `.sql`.

## Status

```bash
npm run migrate          # apply pending migrations
npm run migrate:status   # show applied / pending files
```

> The e-commerce schema (users, products, orders, ...) is intentionally **not**
> written yet. It will be designed as an ER diagram first — see
> `docs/database-plan.md`.
