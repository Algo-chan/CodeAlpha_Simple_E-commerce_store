/**
 * View-model normalisation.
 *
 * The single place where a database row becomes something a component can
 * render. Everything downstream reads only view-model fields, which is why no
 * component ever has to know that:
 *   - prices live on VARIANTS, not products;
 *   - `attributes` is untyped JSONB, so the shape differs per category;
 *   - a variant with no inventory row means digital, not broken;
 *   - availability is `quantity - reserved_quantity`, not `quantity`;
 *   - only `status = 'ACTIVE'` products may be listed, independent of category
 *     `is_active`.
 *
 * Keeping this pure and synchronous means the whole storefront can be rendered
 * from a fixture in a test, with no network and no fake timers.
 */
import { mediaSet, mediaFor, thumbnailFor, placeholderFor } from './media.js';
import { discountPercent } from '../utils/format.js';

/** Only these may appear in a listing. DRAFT and ARCHIVED never do. */
export const LISTABLE_STATUS = 'ACTIVE';

/** Below this, a product is badged as low stock rather than just "in stock". */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * Fallback price for a digital product that has neither a variant nor a
 * `price_minor` of its own. A download still has to cost something, and zero
 * would advertise a free product that could never be delivered.
 */
export const DEFAULT_DIGITAL_PRICE_MINOR = 50000;

/**
 * @typedef {object} ViewProduct
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string} brand
 * @property {string} product_type         'PHYSICAL' | 'DIGITAL'
 * @property {string} category_id
 * @property {boolean} is_digital
 * @property {boolean} is_featured
 * @property {string} description
 * @property {string} short_description
 * @property {string[]} tags
 * @property {string} created_at
 * @property {Array<{url:string, thumb_url:string, alt:string, angle:string, is_primary:boolean}>} images
 * @property {string} primary_image
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
 * @property {Record<string, string[]>} attributes
 * @property {Array<{key:string, label:string, values:string[]}>} attribute_options
 * @property {number|null} rating_average
 * @property {number|null} rating_count
 * @property {object[]} reviews
 * @property {string[]} badges
 */

/**
 * Builds the full catalogue view model.
 *
 * @param {{ products:object[], categories:object[], variants:object[],
 *           reviews:object[], categoryTree:object[], now?: Date }} input
 * @returns {{ products: ViewProduct[], categories: object[] }}
 */
export function buildCatalogue({ products, categories, variants, reviews, categoryTree }) {
  const variantsByProduct = groupBy(variants, (variant) => String(variant.product_id));
  const reviewsByProduct = groupBy(reviews, (review) => String(review.product_id));
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const now = Date.now();

  const viewProducts = products.map((product) =>
    buildProductView(product, {
      variants: variantsByProduct.get(String(product.id)) ?? [],
      reviews: reviewsByProduct.get(String(product.id)) ?? [],
      category: categoryById.get(String(product.category_id)) ?? null,
      now,
    })
  );

  return { products: viewProducts, categories: categoryTree };
}

/**
 * Normalises a single product.
 * @param {object} product
 * @param {{ variants:object[], reviews:object[], category:object|null, now:number }} context
 * @returns {ViewProduct}
 */
export function buildProductView(product, { variants: rawVariants, reviews, category, now }) {
  const images = buildImages(product);
  const primary_image = images[0]?.url ?? placeholderFor(product.slug);

  // Only active variants are purchasable. An inactive variant must not
  // influence price, availability or the attribute lists either, or the card
  // can advertise a price nothing can be bought at.
  //
  // Each variant carries a nested product stub so a cart line can be rendered
  // without a second catalogue lookup. It includes the image, because a basket
  // line with no thumbnail is materially harder to recognise than one with it.
  const variants = rawVariants
    .filter((variant) => variant.is_active !== false)
    .map((variant) => buildVariantView(variant, product, primary_image));

  const sellable = variants.filter((variant) => variant.is_purchasable);
  const priced = sellable.length > 0 ? sellable : variants;

  const prices = priced.map((variant) => variant.price_minor);
  const compareAts = priced
    .map((variant) => variant.compare_at_price_minor)
    .filter((value) => value !== null && value !== undefined);

  const price_min_minor = prices.length > 0 ? Math.min(...prices) : null;
  const price_max_minor = prices.length > 0 ? Math.max(...prices) : null;
  const compare_at_minor = compareAts.length > 0 ? Math.max(...compareAts) : null;

  const totalStock = sellable.reduce(
    (total, variant) => total + (variant.stock ? variant.stock.available : 0),
    // A variant with no inventory row contributes 0 here, but `in_stock` is
    // computed from purchasability instead, so digital goods are unaffected.
    0
  );

  const in_stock = sellable.length > 0;
  const is_low_stock = in_stock && totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD;
  const is_on_sale =
    compare_at_minor !== null && price_min_minor !== null && compare_at_minor > price_min_minor;

  const attributes = mergeAttributes(variants);
  const attribute_options = buildAttributeOptions(variants);
  const rating = summariseRating(reviews);

  const is_digital = product.product_type === 'DIGITAL';

  return {
    id: String(product.id),
    slug: product.slug,
    name: product.name,
    brand: product.brand ?? null,
    product_type: product.product_type,
    category_id: String(product.category_id),
    category_name: category?.name ?? null,
    is_digital,
    is_featured: Boolean(product.is_featured),
    status: product.status,
    is_listable: product.status === LISTABLE_STATUS,
    description: product.description ?? '',
    short_description: product.short_description ?? firstSentence(product.description ?? ''),
    tags: product.tags ?? [],
    created_at: product.created_at ?? new Date(now).toISOString(),

    images,
    primary_image,

    variants,
    // A digital product with no variant is still purchasable, so the UI needs a
    // synthetic line to sell. This mirrors how the API must behave too.
    default_variant: variants[0] ?? buildSyntheticDigitalVariant(product, primary_image),

    price_min_minor,
    price_max_minor,
    compare_at_minor,
    is_on_sale,
    discount_percent: discountPercent(price_min_minor, compare_at_minor),

    in_stock,
    is_low_stock,
    total_stock: totalStock,
    has_single_variant: variants.length <= 1 || attribute_options.length === 0,

    attributes,
    attribute_options,

    rating_average: rating.average,
    rating_count: rating.count,
    reviews,

    badges: buildBadges({
      is_on_sale,
      discount_percent: discountPercent(price_min_minor, compare_at_minor),
      is_low_stock,
      in_stock,
      is_digital,
      is_featured: Boolean(product.is_featured),
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                     */
/* -------------------------------------------------------------------------- */

function buildVariantView(variant, product, primaryImage) {
  const stock = variant.stock ?? null;
  const is_purchasable = stock === null ? true : stock.is_active !== false && stock.available > 0;

  return {
    id: String(variant.id),
    product_id: String(variant.product_id),
    product: {
      slug: product.slug,
      name: product.name,
      primary_image: primaryImage ?? null,
    },
    sku: variant.sku,
    price_minor: variant.price_minor,
    compare_at_price_minor: variant.compare_at_price_minor ?? null,
    attributes: variant.attributes ?? {},
    is_active: variant.is_active !== false,
    // `null` stock means digital / untracked - an important distinction from
    // "zero stock", which means sold out.
    stock,
    is_purchasable,
    is_digital: stock === null,
    label: buildVariantLabel(variant),
  };
}

/**
 * A digital product has no variant rows at all, so the UI still needs one thing
 * to sell. The id is derived from the product id so it is stable across loads
 * and survives being put in a cart.
 *
 * The image is passed in rather than read off `product`: this receives the raw
 * database row, which has no `primary_image` - that field only exists on the
 * view model built above. Without it, every digital basket line would render
 * with a blank thumbnail.
 */
function buildSyntheticDigitalVariant(product, primaryImage) {
  return {
    id: `digital:${product.id}`,
    product_id: String(product.id),
    product: {
      slug: product.slug,
      name: product.name,
      primary_image: primaryImage ?? null,
    },
    sku: null,
    price_minor: product.price_minor ?? DEFAULT_DIGITAL_PRICE_MINOR,
    compare_at_price_minor: null,
    attributes: {},
    is_active: true,
    stock: null,
    is_purchasable: true,
    is_digital: true,
    label: null,
    synthetic: true,
  };
}

/** "Black / 42" from `{color:'Black', size:'42'}`. */
function buildVariantLabel(variant) {
  const entries = Object.entries(variant.attributes ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== ''
  );
  if (entries.length === 0) return null;
  return entries.map(([, value]) => String(value)).join(' / ');
}

/* -------------------------------------------------------------------------- */
/* Images                                                                       */
/* -------------------------------------------------------------------------- */

function buildImages(product) {
  const angles = product.images?.length ? product.images : ['Front'];
  return mediaSet(product.slug, angles).map((image) => ({
    ...image,
    thumb_url: thumbnailFor(product.slug, { angle: image.angle, variant: image.sortOrder }),
  }));
}

/* -------------------------------------------------------------------------- */
/* Attributes                                                                   */
/* -------------------------------------------------------------------------- */

/** Union of every attribute key across variants -> sorted unique values. */
function mergeAttributes(variants) {
  const merged = {};
  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.attributes ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      (merged[key] ??= new Set()).add(String(value));
    }
  }

  return Object.fromEntries(
    Object.entries(merged).map(([key, values]) => [key, Array.from(values).sort()])
  );
}

function buildAttributeOptions(variants) {
  return Object.entries(mergeAttributes(variants)).map(([key, values]) => ({
    key,
    label: humaniseAttribute(key),
    values,
  }));
}

function humaniseAttribute(key) {
  const spaced = String(key).replace(/[_-]/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Variant selection                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Finds the variant matching a partial attribute selection.
 *
 * Partial matching matters: while a shopper has chosen "Black" but not yet a
 * size, the card still needs to show the Black prices rather than nothing.
 *
 * @param {ViewProduct} product
 * @param {Record<string, string>} selection
 * @returns {object|null} the variant, or null when nothing matches
 */
export function findVariantFor(product, selection) {
  const entries = Object.entries(selection ?? {}).filter(([, value]) => value);
  if (entries.length === 0) return product.default_variant ?? null;

  return (
    (product.variants ?? []).find((variant) =>
      entries.every(([key, value]) => String(variant.attributes?.[key]) === String(value))
    ) ?? null
  );
}

/**
 * Whether an option value can be reached from the current selection.
 *
 * This is what stops the classic dead end where "Black / 42" is sold out and
 * the shopper cannot work out that switching to White fixes it. The check
 * considers the other chosen attributes but ignores the option's own key, so
 * the shopper can always undo a bad choice.
 *
 * @param {ViewProduct} product
 * @param {string} key          the option being tested
 * @param {string} value        the candidate value
 * @param {Record<string, string>} selection current selection
 * @returns {{ enabled: boolean, variant: object|null }}
 */
export function canSelectAttribute(product, key, value, selection) {
  const others = Object.entries(selection ?? {}).filter(
    ([otherKey, otherValue]) => otherKey !== key && otherValue
  );

  const variant = (product.variants ?? []).find((candidate) => {
    if (String(candidate.attributes?.[key]) !== String(value)) return false;
    return others.every(
      ([otherKey, otherValue]) => String(candidate.attributes?.[otherKey]) === String(otherValue)
    );
  });

  return { enabled: Boolean(variant?.is_purchasable), variant: variant ?? null };
}

/* -------------------------------------------------------------------------- */
/* Ratings and badges                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Averages ratings to one decimal place, which is what shoppers read as
 * "4.3 out of 5". Rounding to two places implies a precision the sample size
 * does not support.
 */
function summariseRating(reviews) {
  const approved = reviews.filter((review) => review.status !== 'REJECTED');
  if (approved.length === 0) return { average: null, count: 0 };

  const total = approved.reduce((sum, review) => sum + review.rating, 0);
  return {
    average: Math.round((total / approved.length) * 10) / 10,
    count: approved.length,
  };
}

/**
 * Badges, most urgent first, capped so a card never becomes a wall of pills.
 * @returns {string[]}
 */
function buildBadges({
  is_on_sale,
  discount_percent,
  is_low_stock,
  in_stock,
  is_digital,
  is_featured,
}) {
  const badges = [];

  // Sold out wins outright. It is the only badge that changes what the shopper
  // can do, so it must never be pushed off a card by a marketing one.
  if (!in_stock) badges.push('sold-out');
  else {
    if (is_on_sale && discount_percent) badges.push(`sale-${discount_percent}`);
    if (is_low_stock) badges.push('low-stock');
    if (is_digital) badges.push('digital');
    if (is_featured) badges.push('featured');
  }

  return badges.slice(0, 2);
}

/** Human label for a badge key. */
export const BADGE_LABELS = Object.freeze({
  digital: 'Instant download',
  'sold-out': 'Sold out',
  'low-stock': 'Low stock',
  featured: 'Featured',
});

/**
 * @param {string} badge
 * @returns {string}
 */
export function badgeLabel(badge) {
  if (BADGE_LABELS[badge]) return BADGE_LABELS[badge];
  const match = /^sale-(\d+)$/.exec(badge);
  if (match) return `${match[1]}% off`;
  return badge;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                                */
/* -------------------------------------------------------------------------- */

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items ?? []) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function firstSentence(text) {
  const match = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return match ? match[1] : text.trim();
}

/** Re-exported so callers do not need a second import for gallery fallbacks. */
export { mediaFor, mediaSet, thumbnailFor, placeholderFor };

export default {
  buildCatalogue,
  buildProductView,
  findVariantFor,
  canSelectAttribute,
  badgeLabel,
  BADGE_LABELS,
  LISTABLE_STATUS,
  LOW_STOCK_THRESHOLD,
  DEFAULT_DIGITAL_PRICE_MINOR,
};
