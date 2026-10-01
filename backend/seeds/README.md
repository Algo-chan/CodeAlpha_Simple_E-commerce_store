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
2. Always make seeds re-runnable: fixed UUIDs, upserted on every run.
3. Delete `seeds/*.seed.js` in production deployments.

## Current files

| File                                 | Loads                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| `01_users.seed.js`                   | 4 accounts: admin, two customers, one `SUSPENDED`        |
| `02_addresses.seed.js`               | Delivery addresses, one default per customer             |
| `03_categories.seed.js`              | A 13-node category tree, 3 levels deep                   |
| `04_products.seed.js`                | 9 products with image galleries                          |
| `05_product_variants.seed.js`        | 21 SKUs, inventory balances and the opening stock ledger |
| `06_carts_wishlists.seed.js`         | Customer carts, a guest cart, a merged cart, wishlists   |
| `07_orders_payments_reviews.seed.js` | Orders with snapshots, payments, a verified review       |

`_reference_time.js` is a helper, not a seed: the runner only executes
`*.seed.js`, so it is skipped. See below.

## Re-runnability

`npm run seed` can be run any number of times with the same result. Three rules
make that true, and all three are easy to get wrong:

**Fixed UUIDs, derived — never counted.** Ids are written out in the data. Where
a child table has many rows, the child id is built from its parent's position in
the list plus its own position:

```js
id: '60000000-0000-4000-8000-' +
    String(variantIndex).padStart(4, '0') +
    String(rows.length).padStart(8, '0'),
```

A module-level counter also produces unique ids, but it keeps counting across
runs, so the second `npm run seed` in the same process writes _new_ rows instead
of updating the existing ones.

**No `NOW()`.** A seed that stamps `NOW()` produces different data on every
run. Timestamps come from `_reference_time.js`, which anchors the demo story to
a fixed instant (`2026-01-23T09:00:00Z`) and offsets from there:

```js
import { daysBeforeNow, daysAfterNow } from './_reference_time.js';

const ORDERS = [{ orderNumber: 'ORD-20260115-0001', placedDaysAgo: 8, ... }];
```

The dates in the order numbers and the seeded `created_at` values therefore
agree, and two databases seeded from the same commit hold identical data.

**Absolute balances, not relative updates.** Stock is written as full values
rather than `quantity = quantity - 2`, so re-running a seed cannot decrement
stock twice.

Values that legitimately differ between two runs — `created_at` on rows that
have no story date, and every `updated_at` touched by a re-run — are expected to
move. Business data is not.
