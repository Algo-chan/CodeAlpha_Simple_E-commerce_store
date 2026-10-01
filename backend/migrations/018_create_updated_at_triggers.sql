-- 018_create_updated_at_triggers.sql
-- Keep updated_at honest.
--
-- Done as a separate, final migration so the helper from
-- 001_create_shared_helpers.sql is attached once every table exists, in one
-- readable place, instead of being repeated inside 17 table definitions.
--
-- inventory_transactions is deliberately absent: it is an append-only ledger
-- and is never updated, so an updated_at column on it would be misleading.
--
-- Adding a new table means adding its trigger here. Nothing else in the schema
-- can set updated_at on its own.

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER addresses_set_updated_at
  BEFORE UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER product_images_set_updated_at
  BEFORE UPDATE ON product_images
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER inventory_set_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER carts_set_updated_at
  BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER cart_items_set_updated_at
  BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER wishlists_set_updated_at
  BEFORE UPDATE ON wishlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER wishlist_items_set_updated_at
  BEFORE UPDATE ON wishlist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER order_items_set_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ROLLBACK (down)
-- DROP TRIGGER IF EXISTS users_set_updated_at ON users;
-- DROP TRIGGER IF EXISTS addresses_set_updated_at ON addresses;
-- DROP TRIGGER IF EXISTS categories_set_updated_at ON categories;
-- DROP TRIGGER IF EXISTS products_set_updated_at ON products;
-- DROP TRIGGER IF EXISTS product_images_set_updated_at ON product_images;
-- DROP TRIGGER IF EXISTS product_variants_set_updated_at ON product_variants;
-- DROP TRIGGER IF EXISTS inventory_set_updated_at ON inventory;
-- DROP TRIGGER IF EXISTS carts_set_updated_at ON carts;
-- DROP TRIGGER IF EXISTS cart_items_set_updated_at ON cart_items;
-- DROP TRIGGER IF EXISTS wishlists_set_updated_at ON wishlists;
-- DROP TRIGGER IF EXISTS wishlist_items_set_updated_at ON wishlist_items;
-- DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
-- DROP TRIGGER IF EXISTS order_items_set_updated_at ON order_items;
-- DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
-- DROP TRIGGER IF EXISTS reviews_set_updated_at ON reviews;
