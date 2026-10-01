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

> The e-commerce schema is implemented. For the current file list and the
> reasoning behind the schema, see `docs/database-erd.md` and
> `docs/database-plan.md`.

## Current files

| File                                    | Creates                                                           |
| --------------------------------------- | ----------------------------------------------------------------- |
| `001_create_shared_helpers.sql`         | The `set_updated_at()` trigger function                           |
| `002_create_users.sql`                  | `users`                                                           |
| `003_create_addresses.sql`              | `addresses`                                                       |
| `004_create_categories.sql`             | `categories` (self-referencing tree)                              |
| `005_create_products.sql`               | `products`                                                        |
| `006_create_product_images.sql`         | `product_images`                                                  |
| `007_create_product_variants.sql`       | `product_variants`                                                |
| `008_create_inventory.sql`              | `inventory`                                                       |
| `009_create_inventory_transactions.sql` | `inventory_transactions` (append-only)                            |
| `010_create_carts.sql`                  | `carts`                                                           |
| `011_create_cart_items.sql`             | `cart_items`                                                      |
| `012_create_wishlists.sql`              | `wishlists`                                                       |
| `013_create_wishlist_items.sql`         | `wishlist_items`                                                  |
| `014_create_orders.sql`                 | `orders`                                                          |
| `015_create_order_items.sql`            | `order_items` (purchase-time snapshots)                           |
| `016_create_payments.sql`               | `payments`                                                        |
| `017_create_reviews.sql`                | `reviews`                                                         |
| `018_create_updated_at_triggers.sql`    | The trigger on all 15 mutable tables                              |
| `019_prevent_category_cycles.sql`       | A trigger rejecting a `parent_id` that would make the tree cyclic |

Triggers are applied last so the list of tables is already complete when
`018` reads it. Each file ends with commented-out `DROP` statements showing how
it would be reversed; the runner has no `down` command.
