# Database Plan

**Status: implemented.** All 16 tables exist as migrations, and the seeded demo
data is in place. See [database-erd.md](./database-erd.md) for the diagrams,
the full column reference, and the reasoning behind each convention.

This file records the decisions that shaped the schema, including the ones that
changed during implementation, so the choices are reviewable rather than buried
in the SQL.

## Design decisions

| Question           | Decision                                                             | Reason                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys       | `UUID` via `gen_random_uuid()`                                       | Ids can be minted before the row is written, which suits cart and checkout flows. Built into PostgreSQL 13+, so no extension is needed.                                                                                                                                                                                                  |
| Money              | `BIGINT` minor units                                                 | Floating point cannot represent `0.10` exactly. `1870000` is 18,700.00 ETB.                                                                                                                                                                                                                                                              |
| Currency           | `CHAR(3)` on `orders` and `payments` only                            | Prices are implicitly in the store currency; recording it per amount would mean two sources of truth.                                                                                                                                                                                                                                    |
| Enumerations       | `VARCHAR` + `CHECK`                                                  | Postgres `ENUM` values are painful to change once data exists. A `CHECK` is alterable in a migration and reads the same in a schema dump.                                                                                                                                                                                                |
| Provider names     | Free-form `VARCHAR(40)`                                              | `payments.provider` accepts `INTERNAL`, `STRIPE`, `TELEBIRR` and anything else, so a new payment integration needs no migration.                                                                                                                                                                                                         |
| Timestamps         | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` everywhere                      | An absolute instant survives a timezone change. `timestamp without time zone` does not.                                                                                                                                                                                                                                                  |
| `updated_at`       | A `set_updated_at` trigger                                           | An `UPDATE` from anywhere advances the column, so no service can forget. Applied to the 15 mutable tables.                                                                                                                                                                                                                               |
| Append-only ledger | `inventory_transactions` has no `updated_at`                         | A stock movement must never change after the fact, so the column is absent rather than merely unused.                                                                                                                                                                                                                                    |
| Soft deletes       | **None.** `products.status = 'ARCHIVED'` instead                     | A `deleted_at` column on every table would need hiding rules everywhere and still would not protect order history. Order history is protected by `ON DELETE RESTRICT` instead.                                                                                                                                                           |
| Product price      | On `product_variants`, not `products`                                | "Nike Air Max 270, black, size 42" is what has a price.                                                                                                                                                                                                                                                                                  |
| Product stock      | On a separate `inventory` row per variant                            | Keeps the current balance apart from the movement ledger, and lets a digital product simply have no inventory row.                                                                                                                                                                                                                       |
| Variant options    | One `JSONB` `attributes` object                                      | Attribute shapes differ per product (`storage`/`ram` vs `color`/`size`). A `CHECK` guarantees it stays a JSON object. A GIN index supports attribute filtering.                                                                                                                                                                          |
| Cart ownership     | Exactly one of `user_id` or `session_token`                          | A `CHECK` enforces the XOR, so a row can never be owned by both or by neither.                                                                                                                                                                                                                                                           |
| Cart lines         | Variant + quantity, **no price**                                     | Totals are computed from `product_variants.price` at read time, so a cached total cannot be shown to a customer.                                                                                                                                                                                                                         |
| Guest cart merge   | Old cart kept as `CONVERTED` with `merged_into_cart_id`              | The merge stays traceable, and retrying it cannot duplicate lines.                                                                                                                                                                                                                                                                       |
| Guest checkout     | `orders.user_id` nullable, contact details on the order              | Checkout needs no account. The order row survives account deletion via `ON DELETE SET NULL`.                                                                                                                                                                                                                                             |
| Order history      | Full snapshots on `orders` and `order_items`                         | Changing a price or editing an address must not rewrite what a customer was charged.                                                                                                                                                                                                                                                     |
| Payment records    | One row per attempt, many per order                                  | Retries and failures are data. `transaction_reference` is uniquely indexed, so a replayed webhook cannot double-record.                                                                                                                                                                                                                  |
| Reviews            | Anchored to `order_item_id`                                          | The purchase requirement is structural, not a convention. `UNIQUE (order_item_id)` plus `UNIQUE (user_id, product_id)` makes both "reviewed once" and "no second review" database guarantees.                                                                                                                                            |
| Verified purchase  | Derived, not stored                                                  | A stored flag drifts when an order is cancelled or refunded. The status is computed from order history by query; see the ERD for the query.                                                                                                                                                                                              |
| Categories         | `ON DELETE RESTRICT` self-reference, plus a cycle-preventing trigger | Deleting a parent that still has children would orphan them. A `CHECK` can only stop a row being its _direct_ parent, so `019` adds a `BEFORE INSERT OR UPDATE` trigger that walks up from the proposed parent and rejects a move that would close a loop. Without it, `A → B → C → A` is accepted and every recursive tree query hangs. |
| Product deletion   | `ON DELETE RESTRICT` once ordered                                    | `order_items` holds `RESTRICT` on both `product_id` and `variant_id`, so purchase history cannot be orphaned.                                                                                                                                                                                                                            |

## Entities built

| Table                          | Notes                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                        | Email unique and pre-lowered; hash is checked for a bcrypt shape so plaintext can never be stored; `SELLER` is a reserved role with no behaviour yet |
| `addresses`                    | One default per user, enforced by a partial unique index                                                                                             |
| `categories`                   | Self-referencing tree, unique slug, cycles rejected by trigger                                                                                       |
| `products`                     | Unique slug; `product_type` distinguishes physical from digital                                                                                      |
| `product_images`               | Ordered; at most one `is_primary` per product via a partial unique index                                                                             |
| `product_variants`             | Unique SKU; `compare_at_price` must exceed `price` when present                                                                                      |
| `inventory`                    | `variant_id` is the primary key; `reserved_quantity` can never exceed `quantity`                                                                     |
| `inventory_transactions`       | Append-only; quantity sign is tied to the transaction type; a `reference_id` requires a `reference_type`                                             |
| `carts`                        | Owner XOR; one `ACTIVE` cart per user and per session                                                                                                |
| `cart_items`                   | `UNIQUE (cart_id, variant_id)`                                                                                                                       |
| `wishlists` / `wishlist_items` | `UNIQUE (user_id)` on the wishlist, `UNIQUE (wishlist_id, product_id)` on items                                                                      |
| `orders`                       | `total = subtotal + delivery_fee - discount_total`; address stored as a JSONB snapshot                                                               |
| `order_items`                  | `subtotal = unit_price * quantity`; nullable `variant_id` so a digital line is not forced to have one                                                |
| `payments`                     | `PAID`/`REFUNDED` require `paid_at`; `FAILED` requires a `failure_reason`                                                                            |
| `reviews`                      | Rating 1–5; at least one of title or comment; moderation status                                                                                      |

## Deliberately not built

| Deferred                               | Reason                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `coupons`                              | No discount rules exist yet. `orders.discount_total` is already in place, so a coupon can be added without touching order history. |
| `notifications`                        | Needs the event vocabulary from the service layer first.                                                                           |
| Order status history table             | Needs the transition rules from the order service. `orders.status` carries the current state meanwhile.                            |
| Digital entitlements / download grants | Depends on how downloads are delivered.                                                                                            |
| Address soft delete                    | `ON DELETE CASCADE` from `users` plus one default per user covers the current cases.                                               |
| Audit columns for creator/updater      | Only `inventory_transactions.created_by` exists, where it affects the ledger's meaning.                                            |

## Migration order

Applied in filename order, each file in its own transaction, tracked in
`schema_migrations`:

1. `001` shared `set_updated_at` trigger function
2. `002`–`003` `users`, `addresses`
3. `004`–`007` `categories`, `products`, `product_images`, `product_variants`
4. `008`–`009` `inventory`, `inventory_transactions`
5. `010`–`013` `carts`, `cart_items`, `wishlists`, `wishlist_items`
6. `014`–`017` `orders`, `order_items`, `payments`, `reviews`
7. `018` the `updated_at` trigger attached to all 15 mutable tables
8. `019` the category cycle trigger

Triggers come last so the table list is complete before it is read. `019` exists
because a test found the gap: the `categories_not_own_parent` `CHECK` rejects
only a direct self-parent, so an indirect cycle was still accepted.

## Known constraint worth knowing

`product_variants.compare_at_price > price` is a strict `CHECK`, which means a
price increase above the existing compare-at price is rejected. Clearing
`compare_at_price` in the same statement works:

```sql
UPDATE product_variants
   SET price = 290000, compare_at_price = NULL
 WHERE id = '...';
```

This is intentional: a compare-at price at or below the real price would be a
false claim about a discount.

## Working with the database

```bash
npm run db:create        # create the database if it does not exist
npm run migrate          # apply pending migrations
npm run migrate:status   # what is applied / pending
npm run seed             # load development demo data, safe to re-run
```

Migrations are forward-only. Never edit an applied file: the runner stores a
checksum per migration and warns on a mismatch. Add a new numbered file
instead. Each migration ends with commented-out `DROP` statements showing how it
would be reversed; there is no `down` command in the runner.
