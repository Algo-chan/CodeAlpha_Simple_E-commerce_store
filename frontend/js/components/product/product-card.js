/**
 * Product card.
 *
 * The most-repeated object in the storefront, so the decisions here are the
 * ones that show up everywhere:
 *
 *   - The whole card is clickable via a single link with a stretched
 *     `::after`, never by wrapping the card in an <a>. A wrapping anchor would
 *     swallow the wishlist button and the quick-view trigger into one giant
 *     link with two nested interactive elements - unusable by keyboard and
 *     invalid HTML.
 *   - At most two badges. `view.js` produces up to five candidate badges
 *     (sale, low stock, digital, featured, new); this ranks them and takes the
 *     two that matter. A card covered in badges communicates nothing.
 *   - Sold out is stated in text, not only by a grey image. Colour alone fails
 *     for colour-blind shoppers, and a desaturated photo is a hint, not a fact.
 *   - A card with several variants shows how many options exist rather than
 *     guessing which one is "the" colour, because it has no idea.
 *
 * Images are plain <img> with width/height and loading hints. The mock serves
 * procedural SVG data URIs, but this component must not assume that - a real
 * API will serve raster images, and a card that only works with data URIs is
 * not a card.
 */
import { el, clear, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { badgeStack } from '../ui/badge.js';
import { rating } from '../ui/rating.js';
import { price } from './price.js';
import { wishlistButton } from './wishlist-button.js';

/** How many swatch dots to show before collapsing to "+n". */
const MAX_SWATCHES = 4;

/**
 * @typedef {object} ProductCardOptions
 * @property {object} product      a `view.js` product
 * @property {object} [wishlist]   wishlist store; omit to hide the save control
 * @property {boolean} [compact]   horizontal layout for rails and drawers
 * @property {boolean} [showRating]
 * @property {boolean} [showQuickView]
 * @property {boolean} [eager]     skip lazy-loading for above-the-fold cards
 * @property {Function} [onQuickView]
 * @property {Function} [onSavedChange]
 * @property {string} [className]
 */

/**
 * @param {ProductCardOptions} options
 * @returns {{ element: HTMLElement, destroy(): void }}
 */
export function productCard({
  product,
  wishlist = null,
  compact = false,
  showRating = true,
  showQuickView = false,
  eager = false,
  onQuickView,
  onSavedChange,
  className = '',
}) {
  const href = `/product.html?slug=${encodeURIComponent(product.slug)}`;
  const cleanups = [];

  // A quick-view trigger without a handler is a button that does nothing, so
  // asking for one implies a callback. Callers should not have to pass both.
  const quickViewEnabled = showQuickView || Boolean(onQuickView);

  // The name link is the card's only tab stop; it stretches over the card via
  // `::after`. Wrapping the card in an <a> instead would nest the wishlist
  // button and quick-view trigger inside a link.
  const root = el('article.product-card', {
    className: [
      'product-card',
      compact ? 'product-card--compact' : null,
      product.in_stock ? null : 'product-card--unavailable',
      className || null,
    ]
      .filter(Boolean)
      .join(' '),
  });

  const body = el('div.product-card__body', {}, [
    product.brand ? el('p.product-card__brand', { text: product.brand }) : null,
    el('h3.product-card__name', {}, [el('a.product-card__link', { href, text: product.name })]),
    showRating && !compact ? ratingSlot(product) : null,
    variantIndicator(product),
    el('div.product-card__meta', {}, [stockNote(product), priceSlot(product)]),
  ]);

  root.append(
    mediaSection({ product, eager, showQuickView: quickViewEnabled, onQuickView, cleanups })
  );
  root.append(body);

  if (wishlist && !compact) {
    const save = wishlistButton({
      productId: product.id,
      name: product.name,
      wishlist,
      onToggle: onSavedChange,
    });
    root.querySelector('.product-card__favourites').append(save.element);
    cleanups.push(() => save.destroy());
  }

  return {
    element: root,
    destroy: () => cleanups.forEach((fn) => fn()),
  };
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

function mediaSection({ product, eager, showQuickView, onQuickView, cleanups }) {
  const media = el('div.product-card__media', {}, [
    // The name link's `::after` already stretches across the card, so the media
    // needs no link of its own - a second link would announce the product name
    // twice per card and create two overlapping tab stops.
    ...topBadges(product),

    product.images[0]
      ? el('img.product-card__image.product-card__image--primary', {
          src: product.primary_image,
          alt: product.images[0].alt ?? product.name,
          width: 600,
          height: 750,
          loading: eager ? 'eager' : 'lazy',
          decoding: eager ? 'sync' : 'async',
          fetchpriority: eager ? 'high' : 'auto',
        })
      : null,
    product.images[1]
      ? el('img.product-card__image.product-card__image--secondary', {
          src: product.images[1].url,
          alt: '',
          width: 600,
          height: 750,
          loading: 'lazy',
          decoding: 'async',
          'aria-hidden': 'true',
        })
      : null,

    el('div.product-card__favourites'),
  ]);

  if (showQuickView && onQuickView) {
    const trigger = el('button.btn.btn--ghost.btn--sm.product-card__quick-view', {
      type: 'button',
      'aria-label': `Quick view: ${product.name}`,
    });
    trigger.append(icon('eye'), el('span', { text: 'Quick view' }));
    media.append(trigger);
    cleanups.push(on(trigger, 'click', () => onQuickView(product, trigger)));
  }

  return media;
}

/* -------------------------------------------------------------------------- */
/* Slots                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Badges, capped at two and ordered so "Sold out" can never be displaced.
 *
 * `view.js` already ranks and caps them; the reordering here is defensive, so a
 * future API response that returns badges in an arbitrary order still puts the
 * only badge that changes what the shopper can do first.
 */
function topBadges(product) {
  const keys = Array.isArray(product.badges) ? product.badges : [];
  if (keys.length === 0) return [];

  const ordered = keys.includes('sold-out')
    ? ['sold-out', ...keys.filter((key) => key !== 'sold-out')]
    : keys;

  return [badgeStack(ordered)];
}

function ratingSlot(product) {
  return el('div.product-card__rating', {}, [
    rating({
      rating: product.rating_average,
      count: product.rating_count,
      showCount: false,
      size: '0.6875rem',
    }),
  ]);
}

/**
 * Says how many options exist. Deliberately does not render the option values
 * as swatches on the card: those swatches would be dead pixels pretending to be
 * controls, and the real choice happens on the product page.
 */
function variantIndicator(product) {
  if (product.has_single_variant) return null;

  const options = product.attribute_options ?? {};
  const keys = Object.keys(options);

  if (keys.length === 0) return null;

  const total = keys.reduce((count, key) => count + (options[key]?.length ?? 0), 0);
  if (total <= 1) return null;

  // Colour-like attributes get swatches because they carry information at a
  // glance; size does not, so it gets the count instead.
  const colourKey = keys.find((key) => /colou?r/i.test(key));
  const swatches = colourKey ? options[colourKey].slice(0, MAX_SWATCHES) : [];
  const remaining = total - swatches.length;

  return el('div.product-card__variants', {}, [
    swatches.length > 0
      ? el(
          'span.variant-dots',
          { 'aria-hidden': 'true' },
          swatches.map((value) => el('span.variant-dot', { dataset: { value }, title: value }))
        )
      : null,
    el('span.variant-note', {
      text: swatches.length > 0 && remaining > 0 ? `+${remaining} options` : `${total} options`,
    }),
  ]);
}

function stockNote(product) {
  if (!product.in_stock) {
    return el('span.product-card__stock', { text: 'Sold out' });
  }
  if (product.is_low_stock) {
    // An exact count is a promise about inventory that goes stale the moment it
    // is rendered, so this states the condition instead.
    return el('span.product-card__stock.product-card__stock--low', {
      text: product.total_stock > 0 ? `Only ${product.total_stock} left` : 'Last few',
    });
  }
  return null;
}

function priceSlot(product) {
  const node = price({
    price: product.price_min_minor,
    compareAt: product.compare_at_minor,
    to: product.price_max_minor,
  });

  // No price at all - a draft with no sellable variant. Saying "Price on
  // request" is honest; showing ETB 0 is not.
  return node ?? el('span.price__from', { text: 'Price unavailable' });
}

/* -------------------------------------------------------------------------- */
/* Grid                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A grid of cards.
 *
 * Renders a placeholder row first if `skeletons` is set, so the page has its
 * final geometry before the catalogue resolves and the layout does not jump.
 *
 * @param {object} options
 * @param {Array<object>} [options.products]
 * @param {number} [options.skeletons]
 * @param {boolean} [options.compact]
 * @param {object} [options.wishlist]
 * @param {number} [options.eagerCount]  how many cards load eagerly
 * @param {string} [options.variant]      grid variant from product-grid.css
 * @param {string} [options.ariaLabel]
 * @param {Function} [options.onQuickView] `(product, trigger) => void`
 * @param {Function} [options.onSavedChange]
 * @returns {{ element: HTMLElement, setProducts(products): void, destroy(): void }}
 */
export function productGrid({
  products = [],
  skeletons = 0,
  compact = false,
  wishlist = null,
  eagerCount = 4,
  variant = '',
  ariaLabel = 'Products',
  onQuickView,
  onSavedChange,
} = {}) {
  const cards = [];
  // Declared before `setProducts` so the first call - made during construction -
  // cannot hit the temporal dead zone.
  const cleanups = [];

  const root = el('div.product-grid', {
    className: ['product-grid', variant || null].filter(Boolean).join(' '),
    role: 'list',
    'aria-label': ariaLabel,
    'aria-busy': skeletons > 0 ? 'true' : null,
  });

  function setProducts(next) {
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
    clear(root);
    cards.length = 0;
    root.setAttribute('aria-busy', 'false');

    next.forEach((product, index) => {
      const card = productCard({
        product,
        wishlist,
        compact,
        onSavedChange,
        // The trigger is passed through so the quick view can return focus to
        // the exact card it was opened from, which is what makes Back feel right.
        onQuickView: onQuickView ? (target, trigger) => onQuickView(target, trigger) : undefined,
        // Only the first screenful is eager. Eager-loading 24 images is the
        // single easiest way to make a storefront feel slow on mobile data.
        eager: index < eagerCount,
      });
      card.element.setAttribute('role', 'listitem');
      root.append(card.element);
      cards.push(card);
      cleanups.push(() => card.destroy());
    });
  }

  if (skeletons > 0) {
    // Matches the card's geometry: media block, then three text lines. A
    // skeleton of the wrong shape defeats the purpose of showing layout first.
    for (let index = 0; index < skeletons; index += 1) {
      root.append(
        el('div.skeleton-card', { 'aria-hidden': 'true' }, [
          el('div.skeleton.skeleton-card__media', {}),
          el('div.skeleton-card__body', {}, [
            el('div.skeleton.skeleton--text-xs', { style: 'inline-size:35%' }),
            el('div.skeleton.skeleton--text', { style: 'inline-size:90%' }),
            el('div.skeleton.skeleton--text-sm', { style: 'inline-size:45%' }),
          ]),
        ])
      );
    }
  } else {
    setProducts(products);
  }

  return {
    element: root,
    setProducts,
    destroy: () => cleanups.forEach((fn) => fn()),
  };
}

/**
 * A horizontal rail of cards, for recommendations and "you might also like".
 *
 * `role="list"` plus `role="listitem"` keeps the scroll container announcing as
 * a list of items rather than one long unnamed region, and `tabindex="0"` makes
 * it keyboard-scrollable - a scrollable region that cannot be reached with Tab
 * is unusable without a mouse.
 */
export function productRail({
  products = [],
  wishlist = null,
  ariaLabel = 'Recommended products',
  onQuickView,
} = {}) {
  const rail = el('div.product-rail', {
    role: 'list',
    'aria-label': ariaLabel,
    tabindex: '0',
  });

  const cards = products.map((product) => {
    const card = productCard({
      product,
      wishlist,
      compact: false,
      onQuickView,
    });
    card.element.setAttribute('role', 'listitem');
    rail.append(card.element);
    return card;
  });

  return {
    element: rail,
    destroy: () => cards.forEach((card) => card.destroy()),
  };
}

/**
 * A product link with a swatch of metadata, used by the cart drawer and the
 * wishlist panel where the full card is too much.
 */
export function productLine({ product, meta = null, trailing = null, eager = false }) {
  const card = productCard({ product, compact: true, showRating: false, eager });
  if (meta)
    card.element.querySelector('.product-card__body').append(el('p.variant-note', { text: meta }));
  if (trailing) card.element.querySelector('.product-card__meta').append(trailing);
  return card;
}

export default { productCard, productGrid, productRail, productLine };
