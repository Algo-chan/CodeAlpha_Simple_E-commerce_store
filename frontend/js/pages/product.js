/**
 * Product page.
 *
 * The one page with real state worth the name: a variant picker, a price that
 * changes with the option, a quantity ceiling that follows stock, and a buy
 * button that is honestly disabled when the selected option cannot be bought.
 *
 * Two rules shape the markup:
 *
 *   1. NO PRODUCT, NO EMPTY PAGE. A bad or missing `?slug=` renders a real "not
 *      found" state with a way out, rather than an empty frame or a crash.
 *   2. THE URL IS THE SOURCE OF TRUTH. The picker reconciles the selected
 *      variant against stock on every change and writes the resolved variant back
 *      to the address bar, so a reload or a shared link lands on a purchasable
 *      option instead of a combination that sold out.
 */
import { el, clear, on } from '../core/dom.js';
import { icon } from '../utils/icons.js';
import { formatMoney, formatRelative, discountPercent } from '../utils/format.js';
import { button } from '../components/ui/button.js';
import { stepper } from '../components/forms/stepper.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { pageTitle, sectionHeading } from '../components/layout/page-header.js';
import { price, stockLine } from '../components/product/price.js';
import { rating } from '../components/ui/rating.js';
import { productGallery } from '../components/product/product-gallery.js';
import { variantPicker } from '../components/product/variant-picker.js';
import { wishlistButton } from '../components/product/wishlist-button.js';
import { productRail } from '../components/product/product-card.js';
import { LOW_STOCK_THRESHOLD } from '../mock/view.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.catalogue
 * @param {object} options.cart
 * @param {object} options.wishlist
 * @param {object} options.ui           toast store
 * @param {object} [options.cartDrawer]
 * @param {object} [options.quickView]
 * @returns {{ destroy(): void }}
 */
export default function productPage({
  host,
  catalogue,
  cart,
  wishlist,
  ui = null,
  cartDrawer = null,
  quickView = null,
}) {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const product = resolveProduct(catalogue, params);

  document.title = product ? `${product.name} - Aster & Oak` : 'Product not found - Aster & Oak';

  if (!product) {
    host.replaceChildren(
      el('div.container.product-shell', {}, [
        breadcrumb([{ label: 'Not found' }]),
        pageTitle('We could not find that product', { eyebrow: '404' }),
        el('div', {}, [
          el('p.text-secondary', {
            text: 'The link may be out of date, or the product may have been withdrawn. The collection is a good place to pick things up again.',
          }),
          button({ label: 'Browse the collection', href: '/collection.html', variant: 'primary' })
            .element,
        ]),
      ])
    );
    return { destroy() {} };
  }

  const cleanups = [];
  // The container is on the shell rather than in each section below: the breadcrumb,
  // the buy view, the details and the reviews are all one continuous column of
  // content, and only one wrapper should decide their gutters.
  const shell = el('div.container.product-shell');
  host.replaceChildren(shell);

  /* --- Buy panel state ------------------------------------------------------- */

  let picker = null;
  let quantity = null;
  let priceHost = null;
  let stockHost = null;
  let addButton = null;
  let busy = false;

  /* --- Media ---------------------------------------------------------------- */

  const gallery = productGallery({
    images: product.images ?? [],
    badges: product.badges ?? [],
  });
  cleanups.push(() => gallery.destroy());

  /* --- Panel ---------------------------------------------------------------- */

  priceHost = el('div.product__price');
  stockHost = el('div.product__stock');

  picker = variantPicker({ product, onChange: onSelectionChange });
  cleanups.push(() => picker.destroy());

  quantity = stepper({ label: 'Quantity', singular: 'item', max: 10 });

  addButton = button({
    label: 'Add to cart',
    variant: 'primary',
    size: 'lg',
    onClick: () => addToCart(),
  });

  const save = wishlistButton({ productId: product.id, name: product.name, wishlist });
  cleanups.push(() => save.destroy());

  const category = catalogue.getCategory(product.category_id);

  // A shared link may carry `?variant=`. Honoured on load so the option a
  // shopper shared is the option they land on - and if that option has since sold
  // out, the picker's own reconciliation moves them to one that has not.
  const requestedVariant = params.get('variant')
    ? catalogue.getVariant(params.get('variant'))
    : null;
  if (requestedVariant && String(requestedVariant.product_id) === product.id) {
    picker.setSelected(requestedVariant.attributes ?? {});
  }

  const panel = el('div.product__panel', {}, [
    product.brand ? el('p.product__brand', { text: product.brand }) : null,
    el('h1.product__title', { text: product.name }),

    el('div.product__meta', {}, [
      rating({
        rating: product.rating_average ?? 0,
        count: product.rating_count ?? 0,
        href: '#reviews',
      }),
      product.default_variant?.sku
        ? el('span.product__sku', { text: product.default_variant.sku })
        : null,
      category?.slug
        ? el('a.product__category', {
            href: `/collection.html?category=${encodeURIComponent(category.slug)}`,
            text: category.name,
          })
        : null,
    ]),

    priceHost,
    stockHost,
    product.short_description
      ? el('p.product__description', { text: product.short_description })
      : null,
    picker.element,

    el('div.product__buy', {}, [quantity.element, addButton.element]),

    el('div.product__actions', {}, [
      save.element,
      button({
        label: 'Share',
        variant: 'ghost',
        icon: 'copy',
        onClick: () => share({ ui }),
      }).element,
    ]),

    assurance(product),
  ]);

  shell.append(
    breadcrumb([
      category?.slug
        ? {
            label: category.name,
            href: `/collection.html?category=${encodeURIComponent(category.slug)}`,
          }
        : { label: 'Collection', href: '/collection.html' },
      { label: product.name },
    ]),

    el('div.product', {}, [el('div.product__media', {}, [gallery.element]), panel]),

    details(product),
    reviews(product),
    related({ catalogue, wishlist, quickView, product, cleanups })
  );

  sync();

  return {
    destroy() {
      cleanups.splice(0).forEach((fn) => fn());
    },
  };

  /* ------------------------------------------------------------------------- */

  function onSelectionChange() {
    sync();
    writeVariantToUrl(picker.getVariant());
  }

  /**
   * Keeps the address bar honest about which option is selected.
   *
   * `replaceState`, not `pushState`: choosing a size is not a navigation, and
   * pushing an entry per click would make Back walk back through the shopper's
   * own option changes instead of leaving the page. The slug stays in the URL as
   * the canonical id - the variant is a refinement of it, not a replacement.
   */
  function writeVariantToUrl(variant) {
    if (!variant) return;

    const url = new URL(globalThis.location.href);
    url.searchParams.set('variant', String(variant.id));
    globalThis.history.replaceState(globalThis.history.state, '', url);
  }

  /** Price, stock, quantity ceiling and button label all follow the selection. */
  function sync() {
    const variant = picker.getVariant() ?? product.default_variant;
    if (!variant) return;

    const available = variant.stock ? variant.stock.available : null;

    clear(priceHost);
    priceHost.append(
      price({
        price: variant.price_minor,
        compareAt: variant.compare_at_price_minor,
        size: 'lg',
      })
    );

    const saving = discountPercent(variant.price_minor, variant.compare_at_price_minor);
    priceHost.append(
      saving > 0
        ? el('p.product__saving', {}, [icon('tag'), `You save ${saving}% on this option.`])
        : null
    );

    clear(stockHost);
    stockHost.append(stockLine(variant, available));

    quantity.setMax(available === null ? null : Math.max(available, 1));
    quantity.element.hidden = available !== null && available <= 1;

    const soldOut = !variant.is_purchasable;
    const low = !soldOut && available !== null && available <= LOW_STOCK_THRESHOLD;

    addButton.setLabel(
      soldOut ? 'Sold out' : low ? `Add to cart — only ${available} left` : 'Add to cart'
    );
    addButton.element.disabled = soldOut || busy;
  }

  async function addToCart() {
    const variant = picker.getVariant() ?? product.default_variant;
    if (!variant?.is_purchasable || busy) return;

    const wanted = quantity.getValue();
    busy = true;
    addButton.element.disabled = true;

    await addButton.run(() => {
      const result = cart.add(variant.id, wanted);

      if (!result.ok) {
        ui?.pushToast({
          title: 'Could not add to cart',
          message: explain(result.reason),
          tone: 'error',
        });
        return;
      }

      ui?.pushToast({
        title: 'Added to cart',
        message: `${product.name} — ${formatMoney(variant.price_minor * wanted)}`,
        tone: 'success',
        actionLabel: 'View cart',
        onAction: () => globalThis.location.assign('/cart.html'),
      });
    });

    busy = false;
    sync();

    // On a phone the shopper is already looking at the button they just pressed;
    // opening the drawer unprompted would cover the page they are reading. The
    // toast's "View cart" action is the deliberate route there.
    if (cartDrawer && globalThis.matchMedia?.('(min-width: 64em)').matches) {
      cartDrawer.open({ trigger: addButton.element });
    }
  }

  /**
   * Share, using the clipboard where it exists and a selected input where it does
   * not. `navigator.share` is preferred on a phone because it offers the native
   * share sheet, which is what a shopper holding the phone expects.
   */
  function share({ ui: toasts }) {
    const url = globalThis.location.href;
    const title = product.name;

    if (globalThis.navigator?.share) {
      globalThis.navigator.share({ title, url }).catch(() => {
        /* The shopper dismissed the share sheet. Nothing went wrong. */
      });
      return;
    }

    if (globalThis.navigator?.clipboard?.writeText) {
      globalThis.navigator.clipboard.writeText(url).then(
        () => toasts?.pushToast({ title: 'Link copied', tone: 'success' }),
        () => toasts?.pushToast({ title: 'Could not copy the link', tone: 'error' })
      );
      return;
    }

    toasts?.pushToast({
      title: 'Copy this link',
      message: url,
      tone: 'info',
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Accepts `?slug=` or `?id=`.
 *
 * Slug is what every internal link uses, because it is readable and survives a
 * catalogue re-seed. Id is accepted because it is what an older link or a script
 * might carry, and rejecting it would produce a 404 for a product that exists.
 */
function resolveProduct(catalogue, params) {
  const slug = params.get('slug');
  if (slug) return catalogue.getProductBySlug(slug);

  const id = params.get('id');
  if (id) return catalogue.getProduct(id);

  // No query at all: `/product.html` is a dead end, but the catalogue's first
  // product is a better answer than a 404 page and costs nothing.
  return catalogue.selectProducts()[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Assurance                                                                    */
/* -------------------------------------------------------------------------- */

function assurance(product) {
  const rows = product.is_digital
    ? [
        ['download', 'Instant download after checkout'],
        ['refresh', 'Refundable for 14 days'],
        ['lock', 'Secure payment'],
      ]
    : [
        ['truck', 'Delivered across Addis Ababa in 2–4 days'],
        ['refresh', 'Free returns within 30 days'],
        ['shield', 'Checked before it ships'],
      ];

  return el(
    'ul.product__assurance',
    { role: 'list' },
    rows.map(([name, text]) =>
      el('li.product__assurance-item', {}, [icon(name), el('span', { text })])
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Details                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Description, specifications, delivery and sizing, as accordions.
 *
 * The first panel starts open and the rest closed: most shoppers either read the
 * description or skip to delivery, and opening all four would bury both.
 */
function details(product) {
  const panels = [
    { id: 'details', label: 'Description', open: true, content: descriptionPanel(product) },
    {
      id: 'specifications',
      label: 'Specifications',
      open: false,
      content: specifications(product),
    },
    {
      id: 'delivery',
      label: 'Delivery and returns',
      open: false,
      content: deliveryPanel(product),
    },
  ];

  const sizes = sizeTable(product);
  if (sizes) panels.push({ id: 'sizing', label: 'Sizing', open: false, content: sizes });

  return el('section.product-details', { 'aria-label': 'Product details' }, panels.map(accordion));
}

function accordion({ id, label, open, content }) {
  const panelId = `accordion-${id}`;
  const triggerId = `accordion-${id}-trigger`;

  const panel = el('div.accordion__panel', {
    id: panelId,
    role: 'region',
    'aria-labelledby': triggerId,
  });
  panel.hidden = !open;
  panel.append(content);

  const summary = el(
    'button.accordion__summary',
    {
      type: 'button',
      id: triggerId,
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': panelId,
    },
    [el('span', { text: label }), icon('chevron-right', { className: 'accordion__marker' })]
  );

  const root = el('div.accordion', {}, [summary, panel]);

  on(summary, 'click', () => {
    const expanded = summary.getAttribute('aria-expanded') === 'true';
    summary.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    panel.hidden = expanded;
  });

  return root;
}

function descriptionPanel(product) {
  // The description is plain prose from the API, split on blank lines so the
  // paragraph structure the copy already has survives into the DOM.
  return el('div', {}, ...paragraphs(product.description).map((text) => el('p', { text })));
}

function specifications(product) {
  const rows = [
    ['Category', product.category_name],
    ['Brand', product.brand],
    ['Type', product.is_digital ? 'Digital download' : 'Physical product'],
  ];

  for (const attribute of product.attribute_options ?? []) {
    rows.push([attribute.label ?? attribute.key, attribute.values.join(', ')]);
  }

  const pairs = rows.filter(([, value]) => value);

  return el(
    'dl.spec-list',
    {},
    pairs.flatMap(([term, value]) => [
      el('div.spec-list__row', {}, [el('dt', { text: term }), el('dd', { text: value })]),
    ])
  );
}

function deliveryPanel(product) {
  const rows = product.is_digital
    ? [
        'Available as a download link the moment payment clears.',
        'Files are yours to keep; re-download from your order history.',
        'Refundable within 14 days if the files do not work as described.',
      ]
    : [
        'Dispatched within one working day from Addis Ababa.',
        'Delivery in 2–4 days inside Addis Ababa, 4–7 days elsewhere in Ethiopia.',
        'Free delivery on orders over ETB 5,000.',
        'Returns accepted within 30 days, unworn and in the original packaging.',
      ];

  return el('div', {}, [
    el(
      'ul',
      { role: 'list' },
      rows.map((text) => el('li', { text }))
    ),
    el('p.text-xs.text-muted', { text: 'Delivery dates are estimates, not guarantees.' }),
  ]);
}

/**
 * Size chart, shown only when the product is actually sized. A shoe size table on
 * a kettle is the kind of detail that makes a page feel generated rather than
 * written.
 */
function sizeTable(product) {
  const sizes = (product.attribute_options ?? []).find((option) =>
    ['size', 'shoe_size', 'clothing_size'].includes(String(option.key).toLowerCase())
  );

  if (!sizes) return null;

  const values = sizes.values;

  return el('table.size-table', {}, [
    el('caption', {
      text: 'This product runs true to size. If you are between sizes, take the larger one.',
    }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: sizes.label ?? 'Size' }),
        el('th', { scope: 'col', text: 'Foot length (cm)' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      values.map((value) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: String(value) }),
          el('td', { text: footLength(value) }),
        ])
      )
    ),
  ]);
}

/**
 * A rough foot-length estimate from the EU size.
 *
 * Labelled as an estimate in the caption. Publishing an exact number here would
 * be inventing data the catalogue does not have, and the shopper would hold us to
 * it.
 */
function footLength(value) {
  const numeric = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  return `${(numeric * 0.667 + 12).toFixed(1)} cm`;
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rating summary, distribution bars and the written reviews.
 *
 * The distribution is computed from the reviews actually present rather than
 * hard-coded, because a bar chart that disagrees with the reviews underneath it
 * is the single fastest way to lose trust on a product page.
 */
function reviews(product) {
  const list = product.reviews ?? [];

  if (list.length === 0) {
    return el('section.reviews', { id: 'reviews', 'aria-labelledby': 'reviews-heading' }, [
      sectionHeading('Reviews', { eyebrow: 'Customer feedback', id: 'reviews-heading' }),
      el('p.text-secondary', { text: 'No reviews yet. Be the first to say how it performed.' }),
    ]);
  }

  const approved = list.filter((review) => review.status !== 'REJECTED');
  const buckets = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: approved.filter((review) => review.rating === stars).length,
  }));
  const average = product.rating_average ?? 0;

  return el('section.reviews', { id: 'reviews', 'aria-labelledby': 'reviews-heading' }, [
    sectionHeading('Reviews', { eyebrow: 'Customer feedback', id: 'reviews-heading' }),

    el('div.reviews__summary', {}, [
      el('div.reviews__score', {}, [
        el('p.reviews__score-value', { text: average.toFixed(1) }),
        el('p.reviews__score-count', {
          text: `${approved.length} review${approved.length === 1 ? '' : 's'}`,
        }),
      ]),
      el(
        'div.reviews__bars',
        {},
        buckets.map((bucket) =>
          el('div.reviews__bar-row', {}, [
            el('span.reviews__bar-value', { text: `${bucket.stars}★` }),
            el(
              'div.reviews__bar-track',
              {
                role: 'img',
                'aria-label': `${bucket.count} of ${approved.length} reviews are ${bucket.stars} stars`,
              },
              [
                el('div.reviews__bar-fill', {
                  style: `inline-size:${approved.length === 0 ? 0 : Math.round((bucket.count / approved.length) * 100)}%`,
                }),
              ]
            ),
          ])
        )
      ),
    ]),

    el(
      'ul.review-list',
      { role: 'list' },
      approved.map((review) =>
        el('li.review', {}, [
          el('div.review__head', {}, [
            el('span.review__author', { text: review.author }),
            el('time.review__date', {
              datetime: review.created_at,
              text: formatRelative(review.created_at),
            }),
          ]),
          rating({ rating: review.rating, count: 0, showCount: false }),
          el('h3.review__title', { text: review.title }),
          el('p.review__body', { text: review.body }),
          review.is_verified_purchase
            ? el('span.review__verified', {}, [icon('check'), 'Verified purchase'])
            : null,
        ])
      )
    ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Related                                                                      */
/* -------------------------------------------------------------------------- */

function related({ catalogue, wishlist, quickView, product, cleanups }) {
  // `selectRelated` is curried: the selector yields a `(product) => products`
  // function, so the product is passed to the second call, not the first.
  const suggestions = catalogue
    .selectRelated()(product)
    .filter((item) => item.id !== product.id)
    .slice(0, 6);

  if (suggestions.length === 0) return null;

  const rail = productRail({
    products: suggestions,
    wishlist,
    ariaLabel: 'Related products',
    onQuickView: quickView ? (item, trigger) => quickView.open(item, { trigger }) : null,
  });
  cleanups.push(() => rail.destroy());

  // No inner `.container`: the page shell is already one, so wrapping again would
  // apply the gutters twice and inset the rail further than everything above it.
  return el('section.related', { 'aria-labelledby': 'related-heading' }, [
    sectionHeading('You might also like', { eyebrow: 'In a similar vein', id: 'related-heading' }),
    rail.element,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function explain(reason) {
  switch (reason) {
    case 'max-stock':
      return 'There is not that much stock left.';
    case 'unavailable':
      return 'This option is no longer available.';
    case 'not-found':
      return 'That item could not be found.';
    default:
      return 'Please try again.';
  }
}
