# Seeds

Demo / development data. Applied by `npm run seed` (see `run.js`).

## File format

Files are named `01_users.seed.js`, `02_products.seed.js`, ... and run in
ascending order. Each file exports a default async function:

```js
export default async function up({ query }) {
  await query(`INSERT INTO categories (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING`, [
    'Audio',
    'audio',
  ]);
}
```

`query` is a **parameterized** helper bound to the seed's transaction, so
placeholders (`$1`, `$2`) must be used instead of string concatenation.

## Rules

1. Seeds are for development only — never run them in production.
2. Always make seeds re-runnable (`ON CONFLICT DO NOTHING`, fixed identifiers).
3. Delete `seeds/*.seed.js` in production deployments.

> No seed files exist yet because the schema does not exist yet. They will be
> added together with the database design (see `docs/database-plan.md`).
