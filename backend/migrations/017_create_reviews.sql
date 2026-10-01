-- 017_create_reviews.sql
-- Product reviews written by customers who actually bought the product.
--
-- Verified purchase
--   "Verified" is not an admin badge and not a stored flag. It is a fact
--   derived from the order history, and the schema is what makes the fact
--   checkable: order_item_id is NOT NULL, so a review can only ever point at a
--   real purchased line, and the review service verifies that the line belongs
--   to the reviewer and sits in a completed order. Nothing to trust, nothing to
--   re-check later.
--
--   The query the backend runs before accepting a review:
--
--     SELECT 1
--       FROM order_items oi
--       JOIN orders o ON o.id = oi.order_id
--      WHERE oi.id = $1            -- the order_item_id being submitted
--        AND oi.product_id = $2    -- the product being reviewed
--        AND o.user_id = $3        -- the signed-in reviewer
--        AND o.status IN ('DELIVERED');
--
--   Matching orders.user_id against the reviewer is what proves the purchase
--   was theirs; matching oi.product_id proves it was this product. A guest
--   order has orders.user_id NULL, so it can never qualify - which is correct,
--   because a guest checkout has no account to attach the review to.
--
-- Duplicate prevention, two rules that work together
--   UNIQUE (order_item_id)   - the same purchase cannot be reviewed twice.
--   UNIQUE (user_id, product_id) - one review per product per customer, even
--   when the product was bought again in a later order. Adding a second review
--   is an UPDATE, which is what keeps the average rating meaningful.
--
-- status is moderation state, not verification: a review can be PENDING until
-- an admin approves it. Only APPROVED rows count towards the average rating.

CREATE TABLE IF NOT EXISTS reviews (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL,
  product_id    UUID         NOT NULL,
  order_item_id UUID         NOT NULL,
  rating        SMALLINT     NOT NULL,
  title         VARCHAR(120),
  comment       TEXT,
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT reviews_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT reviews_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT reviews_order_item_id_fkey
    FOREIGN KEY (order_item_id) REFERENCES order_items (id) ON DELETE CASCADE,
  CONSTRAINT reviews_order_item_unique UNIQUE (order_item_id),
  CONSTRAINT reviews_one_review_per_user_product UNIQUE (user_id, product_id),
  CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_status_allowed CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED')
  ),
  CONSTRAINT reviews_needs_some_text CHECK (
    COALESCE(BTRIM(title), '') <> '' OR COALESCE(BTRIM(comment), '') <> ''
  )
);

COMMENT ON TABLE reviews IS
  'One review per customer per product, anchored to the order item that proves the purchase.';
COMMENT ON COLUMN reviews.order_item_id IS
  'The purchased line that qualifies this review. Also stops the same purchase being reviewed twice.';
COMMENT ON COLUMN reviews.status IS
  'Moderation state (PENDING/APPROVED/REJECTED). Only APPROVED counts towards the average rating.';
COMMENT ON COLUMN reviews.rating IS
  '1 to 5 stars.';

-- Rating aggregate and the review list of a product.
CREATE INDEX IF NOT EXISTS idx_reviews_product_id
  ON reviews (product_id, status, created_at DESC);
-- "My reviews".
CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON reviews (user_id, created_at DESC);
-- Moderation queue.
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews (status, created_at DESC);

-- ROLLBACK (down)
-- DROP TABLE IF EXISTS reviews;
