/**
 * Catalogue view-model mapping — database rows become what a component renders.
 *
 * WHY THIS FILE IS THE SEAM
 *
 * The Phase 3/4 storefront components (`ProductCard`, `product-gallery`,
 * `variant-picker`, `price`, `wishlist-button`) were built against a view model
 * with a specific shape, produced by `frontend/js/mock/view.js`. Rather than
 * rewrite every component to read an API response, the API produces THE SAME
 * SHAPE. `product.name` and `price_min_minor` mean the same thing whether the
 * bytes came from a fixture or from PostgreSQL, so switching data sources is a
 * one-line change in `app.js` and no component moves.
 *
 * The rules encoded here are the domain rules, and they are the ones that are
 * easy to get wrong:
 *
 *   - Price and stock live on VARIANTS. A product never has a price of its own.
 *   - `attributes` is untyped JSONB, so the option set differs per product
 *     family. Nothing here assumes colour + size.
 *   - A variant with NO inventory row is digital, not broken. A variant with an
 *     inventory row of zero IS sold out. Conflating the two is how downloads end
 *     up marked unavailable.
 *   - Availability is `quantity - reserved_quantity`. Reserved units are already
 *     promised to orders.
 *   - Only ACTIVE products are listable, independent of the category's
 *     `is_active` (an inactive category's products are unreachable by
 *     navigation, but must never be listable through a stale link).
 *   - A product with no active variant at all is NOT purchasable. It is reported
 *     as such with a reason, instead of being badged "Sold out", which would be a
 *     different and wrong statement.
 *
 * Pure and synchronous: every function here can be exercised in a test with no
 * database and no network.
 */
import { discountPercent } from './money.js';

/** Only these may appear in a listing. DRAFT and ARCHIVED never do. */
export const LISTABLE_STATUS = 'ACTIVE';

/** At or below this total, a product is badged as low stock. */
export const LOW_STOCK_THRESHOLD = 5;

/** Why a product cannot be bought. `OK` means it can. */
export const PURCHASABILITY = Object.freeze({
  OK: 'OK',
  SOLD_OUT: 'SOLD_OUT',
  NO_PURCHASABLE_VARIANT: 'NO_PURCHASABLE_VARIANT',
});

/**
 * @typedef {object} ViewProduct
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string|null} brand
 * @property {'PHYSICAL'|'DIGITAL'} product_type
 * @property {boolean} is_digital
 * @property {object|null} category
 * @property {string} description
 * @property {string} short_description
 * @property {string} created_at
 * @property {object[]} images
 * @property {string|null} primary_image
 * @property {string|null} secondary_image
 * @property {object[]} variants
 * @property {object|null} default_variant
 * @property {number|null} price_min_minor
 * @property {number|null} price_max_minor
 * @property {number|null} compare_at_minor
 * @property {boolean} is_on_sale
 * @property {number|null} discount_percent
 * @property {boolean} in_stock
 * @property {boolean} is_low_stock
 * @property {number|null} total_stock
 * @property {boolean} is_purchasable
 * @property {string} purchasability_reason
 * @property {object[]} attribute_options
 * @property {boolean} has_single_variant
 * @property {number|null} rating_average
 * @property {number} rating_count
 * @property {string[]} badges
 */

/* -------------------------------------------------------------------------- */
/* Listing rows                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Maps one row from `listProducts` into a listing view model.
 *
 * The row already carries pre-aggregated price, availability and rating columns,
 * because computing them per product in JavaScript would mean either an N+1 or
 * re-deriving aggregates the database is better at.
 *
 * @param {object} row
 * @returns {ViewProduct}
 */
export function toListingProduct(row) {
  const images = normaliseImages(row.images);
  const variantCount = Number(row.variant_count ?? 0);
  const purchasableCount = Number(row.purchasable_count ?? 0);
  const createdAt = toIso(row.created_at);

  const priceMin = toMinor(row.price_min_minor);
  const priceMax = toMinor(row.price_max_minor);
  const compareAt = toMinor(row.compare_at_minor);
  const totalStock = Number(row.total_stock ?? 0);

  // A product with variants but nothing purchasable is sold out. A product with
  // no variants at all is a different situation entirely, and calling it "sold
  // out" would be a claim the data does not support.
  const isDigital = row.product_type === 'DIGITAL';
  const purchasabilityReason =
    purchasableCount > 0
      ? PURCHASABILITY.OK
      : variantCount > 0
        ? PURCHASABILITY.SOLD_OUT
        : PURCHASABILITY.NO_PURCHASABLE_VARIANT;

  const inStock = purchasabilityReason === PURCHASABILITY.OK;
  // Untracked (digital) stock contributes nothing, so low stock must never be
  // inferred from a zero total when the product has nothing to count.
  const isLowStock =
    inStock && variantCount > 0 && totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD;

  const isOnSale = compareAt !== null && priceMin !== null && compareAt > priceMin;
  const discount = discountPercent(priceMin, compareAt);

  const ratingCount = Number(row.rating_count ?? 0);
  const ratingAverage = toMinor(row.rating_average);

  const product = {
    id: String(row.id),
    slug: row.slug,
    name: row.name,
    brand: row.brand ?? null,
    product_type: row.product_type,
    is_digital: isDigital,
    category: row.category_slug
      ? { id: String(row.category_id), slug: row.category_slug, name: row.category_name }
      : null,
    category_id: String(row.category_id),
    category_name: row.category_name ?? null,
    description: '',
    short_description: '',
    created_at: createdAt,

    // The union of every active variant's attributes, keyed the way `filters.js`
    // reads it: `product.attributes?.[key]` is expected to be an ARRAY of the
    // values offered, because the filter panel checks membership with
    // `.includes()`. Emitting the raw variant map instead would make every
    // attribute facet silently match nothing.
    //
    // Computed by the SAME `productAttributes` the detail page uses, from the
    // per-variant maps the query aggregates. Omitting this field does not merely
    // drop a column: the filter panel is built from it, so a colour facet
    // disappears and any selected attribute filter matches no products at all,
    // emptying the grid with no error anywhere.
    attributes: productAttributes(
      parseJsonArray(row.attributes).map((attributes) => ({ attributes }))
    ),

    images,
    primary_image: images[0]?.url ?? null,
    secondary_image: images[1]?.url ?? null,

    // A listing does not read the variant matrix, so these are empty by design
    // rather than missing: the card needs to know a product has options, not
    // what they are.
    variants: [],
    default_variant: null,
    attribute_options: [],
    has_single_variant: variantCount <= 1,

    price_min_minor: priceMin,
    price_max_minor: priceMax,
    compare_at_minor: compareAt,
    is_on_sale: isOnSale,
    discount_percent: discount,

    in_stock: inStock,
    is_low_stock: isLowStock,
    total_stock: totalStock,
    is_purchasable: inStock,
    purchasability_reason: purchasabilityReason,

    rating_average: ratingCount > 0 ? ratingAverage : null,
    rating_count: ratingCount,

    ...editorialFields({ createdAt }),

    badges: buildBadges({
      isOnSale,
      discount,
      isLowStock,
      inStock,
      purchasabilityReason,
      isDigital,
    }),
  };

  return product;
}

/**
 * Fields the storefront's selection and filter code reads that have no direct
 * column behind them.
 *
 * `is_listable` is the important one. `filters.js` tests it strictly with
 * `!== true` to keep DRAFT rows out of a grid, and every collection selector
 * (`selectListable`, the featured row, the new-arrivals row, the sale row) is
 * built on it. Omitting it makes the collection page render nothing at all.
 *
 * It is derived from `status === ACTIVE` and is deliberately INDEPENDENT of
 * purchasability. A sold-out product is still listable: hiding it would make a
 * shopper conclude the shop does not stock it, when the truth is that it is
 * temporarily out of stock. Sold-out state travels separately in
 * `purchasability_reason` and the `sold-out` badge.
 *
 * The other three have no column and no honest derivation:
 *
 *   is_featured    Always false. There is no merchandising flag and no ranking
 *                  data, and "featured" would be a fabricated editorial claim.
 *   is_new         Derived from `created_at` alone. Recency is a fact; a shop
 *                  marking a product new regardless of when it arrived is not.
 *   display_order  Always 0. The hand-set rank behind the popular row does not
 *                  exist, so the row stays empty instead of sorting arbitrarily.
 *
 * All four are additive: a component reading them behaves correctly, and a
 * component ignoring them is unaffected.
 *
 * @param {{ createdAt: string|null }} input
 * @returns {object}
 */
export function editorialFields({ createdAt }) {
  return {
    status: LISTABLE_STATUS,
    is_listable: true,
    is_featured: false,
    is_new: isRecentlyAdded(createdAt),
    display_order: 0,
  };
}

/**
 * How recently a product must have arrived to count as new.
 *
 * Thirty days is chosen because it is a fact about the data rather than a
 * merchandising preference, and a window short enough that the new-arrivals row
 * empties whenever the seed ages past it.
 */
export const NEW_ARRIVAL_WINDOW_DAYS = 30;

/**
 * Whether `created_at` falls inside the new-arrival window.
 *
 * A missing or unparseable timestamp is NOT new. Guessing "yes" would put a
 * product of unknown age at the top of a row that exists to show what is new.
 *
 * @param {string|null} createdAt
 * @param {{ now?: number, windowDays?: number }} [options]
 * @returns {boolean}
 */
export function isRecentlyAdded(
  createdAt,
  { now = Date.now(), windowDays = NEW_ARRIVAL_WINDOW_DAYS } = {}
) {
  if (!createdAt) return false;

  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return false;

  const age = now - timestamp;
  // A future timestamp (clock skew, a bad seed) is not "brand new".
  if (age < 0) return false;

  return age <= windowDays * 24 * 60 * 60 * 1000;
}

/* -------------------------------------------------------------------------- */
/* Detail rows                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Maps a product detail page.
 *
 * @param {object} input
 * @param {object} input.product   row from `findProductBySlug`
 * @param {object[]} input.variants rows with joined inventory
 * @param {object[]} input.images   every image, ordered
 * @param {{average:number|null,count:number,distribution:object[]}} input.rating
 * @param {object[]} input.reviews  approved reviews
 * @param {object[]} input.ancestry ancestors, root first
 * @param {object[]} input.related  related products (already view models)
 * @returns {object}
 */
export function toProductDetail({ product, variants, images, rating, reviews, ancestry, related }) {
  // The detail page shows the whole gallery, unlike a card.
  const allImages = normaliseImages(images);
  const viewVariants = variants.map((row) => toVariant(row, product, allImages[0]?.url ?? null));

  const active = viewVariants.filter((variant) => variant.is_active);
  const purchasable = active.filter((variant) => variant.is_purchasable);

  const attributeOptions = buildAttributeOptions(viewVariants);

  const prices = purchasable.map((variant) => variant.price_minor);
  const fallbackPrices = active.map((variant) => variant.price_minor);

  const effective = prices.length > 0 ? prices : fallbackPrices;
  const priceMin = effective.length > 0 ? Math.min(...effective) : null;
  const priceMax = effective.length > 0 ? Math.max(...effective) : null;

  const compareCandidates = (purchasable.length > 0 ? purchasable : active)
    .map((variant) => variant.compare_at_price_minor)
    .filter((value) => value !== null && value !== undefined);
  const compareAt = compareCandidates.length > 0 ? Math.max(...compareCandidates) : null;

  // Only variants with a real inventory row contribute a stock count. A digital
  // variant has none, so summing would report 0 and then badged the product as
  // low stock.
  const totalStock = purchasable.reduce(
    (total, variant) => total + (variant.stock ? (variant.stock.available ?? 0) : 0),
    0
  );
  const tracked = purchasable.some((variant) => variant.stock !== null);

  const purchasabilityReason =
    purchasable.length > 0
      ? PURCHASABILITY.OK
      : active.length > 0
        ? PURCHASABILITY.SOLD_OUT
        : PURCHASABILITY.NO_PURCHASABLE_VARIANT;

  const inStock = purchasabilityReason === PURCHASABILITY.OK;
  const isLowStock = inStock && tracked && totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD;
  const isOnSale = compareAt !== null && priceMin !== null && compareAt > priceMin;
  const discount = discountPercent(priceMin, compareAt);
  const isDigital = product.product_type === 'DIGITAL';
  const description = product.description ?? '';
  const createdAt = toIso(product.created_at);
  const viewReviews = (reviews?.rows ?? reviews ?? []).map(toReview);

  return {
    id: String(product.id),
    slug: product.slug,
    name: product.name,
    brand: product.brand ?? null,
    product_type: product.product_type,
    is_digital: isDigital,
    category: {
      id: String(product.category_id),
      slug: product.category_slug,
      name: product.category_name,
      description: product.category_description ?? null,
    },
    category_id: String(product.category_id),
    category_name: product.category_name ?? null,
    breadcrumbs: ancestry.map((row) => ({
      id: String(row.id),
      name: row.name,
      slug: row.slug,
    })),
    description,
    short_description: firstSentence(description),
    created_at: createdAt,

    // The union of every active variant's attributes, keyed the way
    // `filters.js` reads it: `product.attributes?.[key]` is expected to be an
    // ARRAY of the values offered, because the filter panel checks membership
    // with `.includes()`. Emitting the raw variant map instead would make every
    // attribute facet silently match nothing.
    attributes: productAttributes(active),

    images: allImages,
    primary_image: allImages[0]?.url ?? null,
    secondary_image: allImages[1]?.url ?? null,

    variants: viewVariants,
    default_variant: purchasable[0] ?? active[0] ?? null,
    attribute_options: attributeOptions,
    has_single_variant: active.length <= 1 || attributeOptions.length === 0,

    price_min_minor: priceMin,
    price_max_minor: priceMax,
    compare_at_minor: compareAt,
    is_on_sale: isOnSale,
    discount_percent: discount,

    in_stock: inStock,
    is_low_stock: isLowStock,
    total_stock: totalStock,
    is_purchasable: inStock,
    purchasability_reason: purchasabilityReason,

    rating_average: rating?.average ?? null,
    rating_count: rating?.count ?? 0,
    rating_distribution: rating?.distribution ?? [],
    reviews: viewReviews,
    // The unpaginated count. `product.js` recomputes a distribution from the
    // reviews it holds, which is only correct while every review fits in one
    // page, so this count is what lets it notice that it does not.
    reviews_total: reviews?.total ?? viewReviews.length,

    related,

    ...editorialFields({ createdAt }),

    badges: buildBadges({
      isOnSale,
      discount,
      isLowStock,
      inStock,
      purchasabilityReason,
      isDigital,
    }),
  };
}

/**
 * Union of the attribute values offered across a product's active variants.
 *
 * Shape matters as much as content here. `filters.js:267` reads
 * `product.attributes?.[key]` and calls `.includes()` on it, so each key maps to
 * an ARRAY of the distinct values offered — not to a single string. Returning
 * the raw per-variant map would make every attribute facet fail its membership
 * test and quietly hide every option.
 *
 * Only active variants contribute: a value that cannot be bought is not an
 * option the shopper may filter for.
 *
 * @param {object[]} variants view-model variants
 * @returns {Record<string, string[]>}
 */
export function productAttributes(variants) {
  const merged = {};

  for (const variant of variants) {
    if (variant.is_active === false) continue;
    for (const [key, value] of Object.entries(variant.attributes ?? {})) {
      (merged[key] ??= new Set()).add(String(value));
    }
  }

  return Object.fromEntries(
    Object.entries(merged).map(([key, values]) => [key, Array.from(values).sort()])
  );
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Maps one review row to the shape `product.js` renders.
 *
 * The rename is deliberate and one-directional. The SQL speaks the schema's
 * language (`users.name` aliased `reviewer_name`, the `comment` column), while
 * the view model speaks the UI's (`author`, `body`). Keeping both concerns in
 * their own layer means a future column rename is a repository edit and a future
 * UI redesign is a view edit, rather than a hunt through components.
 *
 * `status` is emitted even though the query already filtered to APPROVED,
 * because `product.js:577` re-filters on `review.status !== 'REJECTED'`. That
 * check happens to pass on a missing field, but leaving it to chance means the
 * filter silently changes meaning if the query is ever relaxed.
 *
 * @param {object} row
 * @returns {object}
 */
export function toReview(row) {
  return {
    id: String(row.id),
    rating: Number(row.rating),
    title: row.title ?? '',
    body: row.comment ?? '',
    // Only a display name is exposed. `email` and `phone` are never selected by
    // the query, so they cannot leak through this mapping.
    author: row.reviewer_name ?? 'Anonymous',
    is_verified_purchase: Boolean(row.is_verified_purchase),
    status: row.status ?? 'APPROVED',
    created_at: toIso(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Maps one variant row.
 *
 * `available` is NULL when there is no inventory row, and that null is the
 * signal the whole catalogue turns on: NULL means untracked (digital), 0 means
 * sold out.
 *
 * @param {object} row
 * @param {object} product
 * @param {string|null} primaryImage
 * @returns {object}
 */
export function toVariant(row, product, primaryImage) {
  // `available` is NULL when the variant has no inventory row. That null is the
  // signal the whole catalogue turns on: NULL means untracked (digital), 0 means
  // sold out. Collapsing the two would mark every download unavailable.
  const available =
    row.available === null || row.available === undefined ? null : Number(row.available);

  const stock =
    available === null
      ? null
      : {
          quantity: Number(row.quantity ?? 0),
          reserved: Number(row.reserved_quantity ?? 0),
          available,
          // The raw count is inventory data, not a shopper-facing message. A
          // component decides whether to say "Low stock" from this; the number
          // is never rendered as "Only 2 left!".
          is_tracked: true,
        };

  const attributes = normaliseAttributes(row.attributes);
  const isActive = row.is_active !== false;

  return {
    id: String(row.id),
    product_id: String(product.id),
    product: {
      slug: product.slug,
      name: product.name,
      primary_image: primaryImage,
    },
    sku: row.sku,
    price_minor: toMinor(row.price),
    compare_at_price_minor: toMinor(row.compare_at_price),
    attributes,
    is_active: isActive,
    stock,
    is_digital: stock === null,
    is_purchasable: isActive && (stock === null || stock.available > 0),
    // Computed here, at the tier that owns the threshold, rather than by the
    // storefront comparing `stock.available` to its own copy of the number. Two
    // copies of a threshold produce a page that contradicts itself: change it to 3
    // and the card says "Low stock" (from these badges) while the same variant's
    // stock line says "In stock" (from the client's copy). The client renders this
    // flag; it never re-derives it.
    is_low_stock:
      isActive && stock !== null && stock.available > 0 && stock.available <= LOW_STOCK_THRESHOLD,
    label: buildVariantLabel(attributes),
  };
}

/* -------------------------------------------------------------------------- */
/* Images                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Normalises image rows for the gallery.
 *
 * The schema stores `image_url` and `alt_text` and nothing else: there is no
 * `angle` column and no separate thumbnail URL. Rather than invent one, `angle`
 * is left null and `thumb_url` falls back to the full URL, and the gallery
 * labels thumbnails by position. Inventing "Front / Side / Back" from an index
 * would be a claim about the photograph that the database does not make.
 *
 * @param {object|object[]|null} images json aggregate or rows
 * @param {{ full?: boolean }} [options]
 * @returns {object[]}
 */
function normaliseImages(images) {
  if (!images) return [];

  const rows = Array.isArray(images) ? images : parseJsonArray(images);
  if (rows.length === 0) return [];

  return rows
    .map((row, index) => {
      const url = row.url ?? row.image_url ?? null;
      if (!url) return null;

      const isPrimary = Boolean(row.is_primary ?? row.isPrimary ?? index === 0);

      return {
        url,
        // No dedicated thumbnail column exists; the gallery reuses the same URL
        // and the browser caches it once for both the rail and the main frame.
        thumb_url: url,
        alt:
          row.alt ??
          row.alt_text ??
          row.altText ??
          (typeof row === 'object' ? `Product image ${index + 1}` : ''),
        is_primary: isPrimary,
        // Deliberately null: see the note above.
        angle: row.angle ?? null,
        sort_order: Number(row.sort_order ?? row.sortOrder ?? index),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // The primary image leads, then the curated order, so the gallery's first
      // frame is the same image the card showed.
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Attributes                                                                    */
/* -------------------------------------------------------------------------- */

/** Ensures attributes are a flat string map, whatever the driver returned. */
export function normaliseAttributes(attributes) {
  if (attributes === null || attributes === undefined) return {};
  const source = typeof attributes === 'string' ? safeParse(attributes) : attributes;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [String(key), String(value)])
  );
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Union of every attribute key across variants -> sorted unique values.
 *
 * Equivalent to `productAttributes` but does not exclude inactive variants, which
 * is what the variant picker wants: the option lists come from the full matrix so
 * a shopper can see a combination exists and find out it is sold out, rather than
 * watching an option disappear.
 *
 * @param {object[]} variants
 * @returns {Record<string, string[]>}
 */
export function mergeAttributes(variants) {
  const merged = {};

  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.attributes ?? {})) {
      (merged[key] ??= new Set()).add(String(value));
    }
  }

  return Object.fromEntries(
    Object.entries(merged).map(([key, values]) => [key, Array.from(values).sort()])
  );
}

/**
 * Option groups for the variant picker: key, human label, values.
 *
 * The picker chooses a control per group, so the label has to be readable and
 * the value order has to be stable. Values are sorted, which puts sizes in
 * "10, 11, 40, 42" order rather than the insertion order of the seed.
 */
export function buildAttributeOptions(variants) {
  return Object.entries(mergeAttributes(variants)).map(([key, values]) => ({
    key,
    label: humaniseAttribute(key),
    values,
  }));
}

/**
 * Attribute keys that are initialisms, so `ram` reads as RAM rather than Ram.
 *
 * An EXPLICIT list, not a length heuristic. "Any bare lowercase token of two to
 * four letters is an acronym" cannot distinguish `ram` from `new`, `size` or `os`.
 * `new` is the damaging case: it is a product flag as well as a plausible attribute
 * key, and "NEW" as a facet label reads as a marketing claim rather than a field
 * name.
 *
 * Keep this in step with the identical list in
 * `frontend/js/utils/product-view.js`, which is what labels the filter panel once
 * the storefront is server-driven.
 */
const ATTRIBUTE_ACRONYMS = new Set([
  'ram',
  'rom',
  'ssd',
  'hdd',
  'cpu',
  'gpu',
  'usb',
  'hdmi',
  'nfc',
  'sim',
  'led',
  'lcd',
  'oled',
  'dpi',
  'sd',
]);

/** `ram` -> `RAM`, `storage_gb` -> `Storage Gb`. */
export function humaniseAttribute(key) {
  const spaced = String(key ?? '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return '';

  if (ATTRIBUTE_ACRONYMS.has(spaced.toLowerCase())) return spaced.toUpperCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "Black / 42" from `{color:'Black', size:'42'}`. */
export function buildVariantLabel(attributes) {
  const entries = Object.entries(attributes ?? {});
  if (entries.length === 0) return null;
  return entries.map(([, value]) => String(value)).join(' / ');
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Badges for a card, most decision-relevant first, capped at two.
 *
 * Capped because a card that stacks four pills is unreadable, and ordered so
 * anything that changes what the shopper CAN do outranks anything decorative.
 *
 * No badge is emitted without data behind it: `sale-40` only appears when a real
 * compare-at price exists above the real price.
 */
export function buildBadges({
  isOnSale,
  discount,
  isLowStock,
  inStock,
  purchasabilityReason,
  isDigital,
}) {
  if (!inStock) {
    // "Sold out" is only true when variants exist and none can be bought.
    // A product with no purchasable variant at all is "unavailable", which is a
    // different statement and must not be presented as a stock-out.
    return [purchasabilityReason === PURCHASABILITY.SOLD_OUT ? 'sold-out' : 'unavailable'];
  }

  const badges = [];
  if (isOnSale && discount) badges.push(`sale-${discount}`);
  if (isLowStock) badges.push('low-stock');
  if (isDigital) badges.push('digital');

  return badges.slice(0, 2);
}

/** Human label for a badge key. */
export const BADGE_LABELS = Object.freeze({
  digital: 'Instant download',
  'sold-out': 'Sold out',
  unavailable: 'Not available',
  'low-stock': 'Low stock',
});

/**
 * Human label for a badge key.
 *
 * Returns NULL for a key it does not recognise, rather than echoing the key back.
 *
 * Echoing is the worst available answer here: an unknown badge renders its own
 * internal name as shopper-facing text, so a future `flash-sale` badge silently
 * becomes the word "flash-sale" on a product card instead of failing visibly.
 * A null renders nothing, which is the honest result for a label nobody wrote.
 *
 * The frontend twin is `badgeLabel` in `frontend/js/utils/product-view.js`; it has
 * the same unknown-key behaviour, so the two cannot disagree about an edge case.
 *
 * @param {string} badge
 * @returns {string|null} the label, or null when the key is unknown
 */
export function badgeLabel(badge) {
  if (BADGE_LABELS[badge]) return BADGE_LABELS[badge];
  const match = /^sale-(\d+)$/.exec(badge);
  if (match) return `${match[1]}% off`;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * BIGINT arrives as a string from `pg` (it exceeds 2^53 only at absurd prices,
 * but the driver returns strings for int8 regardless) and as a number from
 * PGlite. Normalising here means no downstream `Math.min` ever receives a string
 * and silently compares lexicographically.
 */
function toMinor(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function firstSentence(text) {
  const trimmed = String(text ?? '').trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

export default {
  toListingProduct,
  toProductDetail,
  toVariant,
  buildAttributeOptions,
  mergeAttributes,
  buildBadges,
  badgeLabel,
  humaniseAttribute,
  BADGE_LABELS,
  PURCHASABILITY,
  LISTABLE_STATUS,
  LOW_STOCK_THRESHOLD,
};
