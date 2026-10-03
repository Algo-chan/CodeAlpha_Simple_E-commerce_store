/**
 * Home page.
 *
 * Editorial, not promotional: the page leads with type and whitespace, and the
 * only images are real product photography. Everything below the hero is data
 * driven, so the page renders from the catalogue store alone - no static markup
 * that can drift out of sync with the mock data.
 *
 * Section order is deliberate: promise, browse, featured, new arrivals, why we
 * exist, how it works, guarantees, newsletter. A shopper who bounces at the fold
 * still gets the brand; a shopper who wants to shop gets categories above the
 * fold and products one scroll later.
 */
import { el, on } from '../core/dom.js';
import { icon } from '../utils/icons.js';
import { formatCount, formatMoney } from '../utils/format.js';
import { button } from '../components/ui/button.js';
import { sectionHeading } from '../components/layout/page-header.js';
import { productGrid, productRail } from '../components/product/product-card.js';

const COLLECTION_HREF = '/collection.html';

const collectionHref = (query = {}) => {
  const params = new URLSearchParams(query).toString();
  return params ? `${COLLECTION_HREF}?${params}` : COLLECTION_HREF;
};

const ASSURANCES = [
  { icon: 'truck', text: 'Free delivery over ETB 5,000' },
  { icon: 'refresh', text: '30-day returns, no questions' },
  { icon: 'shield', text: 'Two-year warranty on every order' },
];

const TRUST = [
  {
    icon: 'truck',
    title: 'Delivery in 2-4 days',
    text: 'Dispatched from Addis Ababa and tracked end to end.',
  },
  {
    icon: 'refresh',
    title: 'Returns without friction',
    text: 'Thirty days from delivery. We cover the return label.',
  },
  {
    icon: 'lock',
    title: 'Safe payments',
    text: 'Card, mobile money or bank transfer. Your details stay private.',
  },
  {
    icon: 'headset',
    title: 'Real human support',
    text: 'Send a message and hear back within one working day.',
  },
];

const STEPS = [
  {
    title: 'Browse and compare',
    text: 'Filter by category, size, colour and price. Every product page shows real stock and every real variant.',
  },
  {
    title: 'Save what you like',
    text: 'Your wishlist survives a page reload and a closed tab, ready when you come back for it.',
  },
  {
    title: 'Cart and checkout',
    text: 'Add to cart, adjust quantities, then check out. Digital items download the moment payment clears.',
  },
];

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.catalogue
 * @param {object} options.wishlist
 * @param {object} [options.quickView]
 * @returns {{ destroy(): void }}
 */
export default function homePage({ host, catalogue, wishlist, quickView = null }) {
  const cleanups = [];
  const onQuickView = quickView ? (product, trigger) => quickView.open(product, { trigger }) : null;

  const featured = productGrid({
    skeletons: 4,
    wishlist,
    onQuickView,
    ariaLabel: 'Featured products',
    variant: 'product-grid--editorial',
  });
  cleanups.push(() => featured.destroy());

  // The grid is built showing skeletons so the layout appears straight away, and
  // it is handed the products here for the same reason the sections below are
  // painted before they subscribe: the catalogue was already fetched by the
  // shell, so no notification is coming to replace the placeholders.
  const paintFeatured = () => featured.setProducts(catalogue.selectFeatured().slice(0, 8));
  paintFeatured();
  cleanups.push(catalogue.subscribe(paintFeatured, { selector: catalogue.selectFeatured }));

  const arrivals = newArrivals(catalogue, wishlist, onQuickView);
  cleanups.push(arrivals.destroy);

  const tiles = categoryGrid(catalogue);
  cleanups.push(tiles.destroy);

  const collage = heroCollage(catalogue);
  cleanups.push(collage.destroy);

  const band = featureBand(catalogue);
  cleanups.push(band.destroy);

  host.replaceChildren(
    el('div.home', {}, [
      hero(collage),
      el('section.section', { 'aria-labelledby': 'home-categories' }, [
        el('div.container', {}, [
          sectionHeading('Shop by category', {
            eyebrow: 'Browse',
            id: 'home-categories',
            action: button({
              label: 'All products',
              href: COLLECTION_HREF,
              variant: 'ghost',
              iconEnd: 'arrow-right',
              className: 'btn--link',
            }).element,
          }),
          tiles.element,
        ]),
      ]),
      el('section.section.section--subtle', { 'aria-labelledby': 'home-featured' }, [
        el('div.container', {}, [
          sectionHeading('Featured this week', {
            eyebrow: 'Handpicked',
            lede: 'A short list, chosen by the team rather than by a recommendation engine.',
            id: 'home-featured',
            action: button({
              label: 'See everything',
              href: COLLECTION_HREF,
              variant: 'ghost',
              iconEnd: 'arrow-right',
              className: 'btn--link',
            }).element,
          }),
          featured.element,
        ]),
      ]),
      arrivals.element,
      band.element,
      steps(),
      trustStrip(),
      newsletter(),
    ])
  );

  return {
    destroy() {
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                         */
/* -------------------------------------------------------------------------- */

function hero(collage) {
  return el('section.hero', {}, [
    el('div.container', {}, [
      el('div.hero__grid', {}, [
        el('div.hero__content', {}, [
          el('p.hero__eyebrow', { text: 'New season' }),
          el('h1.hero__title', {}, [
            document.createTextNode('Considered goods for '),
            el('em', { text: 'every day' }),
          ]),
          el('p.hero__lead', {
            text: 'Aster & Oak stocks electronics, fashion and homeware we would happily own ourselves. Honest pricing in ETB, real stock counts, and delivery across Ethiopia.',
          }),
          el('div.hero__actions', {}, [
            button({
              label: 'Shop everything',
              href: COLLECTION_HREF,
              variant: 'primary',
              size: 'lg',
              iconEnd: 'arrow-right',
            }).element,
            button({
              label: 'View new arrivals',
              href: collectionHref({ sort: 'newest' }),
              variant: 'secondary',
              size: 'lg',
            }).element,
          ]),
          el(
            'ul.hero__assurance',
            { role: 'list' },
            ASSURANCES.map((item) =>
              el('li.hero__assurance-item', {}, [icon(item.icon), el('span', { text: item.text })])
            )
          ),
        ]),
        collage.element,
      ]),
    ]),
  ]);
}

/**
 * Two images, one deliberately offset and taller. Real featured products, so the
 * hero is never a stock photo of somebody else's studio.
 */
function heroCollage(catalogue) {
  const figureTall = el('div.hero__figure.hero__figure--tall', {}, [
    el('div.skeleton', { style: 'block-size:100%' }),
  ]);
  const figurePrimary = el('div.hero__figure.hero__figure--primary', {}, [
    el('div.skeleton', { style: 'block-size:100%' }),
  ]);

  const element = el('div.hero__collage', {}, [figureTall, figurePrimary]);

  const paint = (products) => {
    const withImages = products.filter((product) => product.primary_image);
    const [first, second] = withImages;

    if (first) renderFigure(figurePrimary, first, { tag: true });
    if (second) renderFigure(figureTall, second, { tag: false });
  };

  // Painted before subscribing because the shell already awaited the catalogue:
  // there is no later change coming, so waiting for a notification would leave
  // the figures as skeletons for good.
  paint(catalogue.selectFeatured());

  return {
    element,
    destroy: catalogue.subscribe(paint, { selector: catalogue.selectFeatured }),
  };
}

function renderFigure(figure, product, { tag }) {
  figure.replaceChildren(
    el('img', {
      src: product.primary_image,
      alt: '',
      width: 600,
      height: 800,
      loading: 'eager',
      fetchpriority: 'high',
      decoding: 'sync',
    })
  );

  if (!tag) return;

  figure.append(
    el('a.hero__tag', { href: `/product.html?slug=${encodeURIComponent(product.slug)}` }, [
      el('span.hero__tag-label', { text: 'Featured' }),
      el('span.hero__tag-name', { text: product.name }),
      el('span.hero__tag-price', { text: formatMoney(product.price_min) }),
    ])
  );
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Top-level categories only, each illustrated with real photography borrowed
 * from a product inside it. A category has no image of its own, and a grey
 * placeholder tile is worse than a photo of something you can buy.
 */
function categoryGrid(catalogue) {
  const element = el('div.category-grid');

  const paint = (categories) => {
    const roots = categories.filter((category) => !category.parent_id);

    element.replaceChildren(
      ...roots.map((category) => {
        const products = catalogue.getProductsInCategory(category.id);
        const lead = products.find((product) => product.primary_image) ?? null;

        return el('a.category-tile', { href: collectionHref({ category: category.slug }) }, [
          el('span.category-tile__media', {}, [
            lead
              ? el('img', {
                  src: lead.primary_image,
                  alt: '',
                  width: 400,
                  height: 400,
                  loading: 'lazy',
                  decoding: 'async',
                })
              : el('div.skeleton', { style: 'block-size:100%' }),
            products.length > 0
              ? el('span.category-tile__count', { text: formatCount(products.length, 'piece') })
              : null,
          ]),
          el('span.category-tile__name', { text: category.name }),
          category.description
            ? el('span.text-muted.text-xs', { text: category.description })
            : null,
        ]);
      })
    );
  };

  // See `heroCollage`: the catalogue is already loaded, so the first paint cannot
  // wait for a notification.
  paint(catalogue.selectCategories());

  return {
    element,
    destroy: catalogue.subscribe(paint, { selector: catalogue.selectCategories }),
  };
}

/* -------------------------------------------------------------------------- */
/* New arrivals                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A rail, not a grid: this row is a "look at what just landed" strip, and a
 * horizontal scroll keeps the featured grid above it the page's main event.
 * Rebuilt rather than mutated because `productRail` has no `setProducts`, and a
 * rail is cheap enough to throw away.
 */
function newArrivals(catalogue, wishlist, onQuickView) {
  const host = el('div');
  let rail = null;

  const paint = (products) => {
    if (rail) rail.destroy();

    if (products.length === 0) {
      rail = null;
      host.replaceChildren();
      return;
    }

    rail = productRail({
      products: products.slice(0, 8),
      wishlist,
      onQuickView,
      ariaLabel: 'New arrivals',
    });
    host.replaceChildren(rail.element);
  };

  paint(catalogue.selectNewArrivals());

  const stop = catalogue.subscribe(paint, { selector: catalogue.selectNewArrivals });

  return {
    element: el('section.section', { 'aria-labelledby': 'home-new' }, [
      el('div.container', {}, [
        sectionHeading('New arrivals', {
          eyebrow: 'Just landed',
          id: 'home-new',
          action: button({
            label: 'All new arrivals',
            href: collectionHref({ sort: 'newest' }),
            variant: 'ghost',
            iconEnd: 'arrow-right',
            className: 'btn--link',
          }).element,
        }),
        host,
      ]),
    ]),
    destroy() {
      stop();
      if (rail) rail.destroy();
      rail = null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Feature band                                                                 */
/* -------------------------------------------------------------------------- */

function featureBand(catalogue) {
  const media = el('div.feature__media', {}, [el('div.skeleton', { style: 'block-size:100%' })]);

  const paint = (products) => {
    const lead = products.find((product) => product.primary_image);
    if (!lead) return;

    media.replaceChildren(
      el('img', {
        src: lead.primary_image,
        alt: lead.name,
        width: 800,
        height: 600,
        loading: 'lazy',
        decoding: 'async',
      })
    );
  };

  paint(catalogue.selectFeatured());

  return {
    element: el('section.section.section--subtle', { 'aria-labelledby': 'home-feature' }, [
      el('div.container', {}, [
        el('div.feature', {}, [
          media,
          el('div.feature__content', {}, [
            el('p.hero__eyebrow', { text: 'Why Aster & Oak' }),
            el('h2.text-balance', { id: 'home-feature', text: 'Fewer brands, better chosen.' }),
            el('p.text-secondary', {
              text: 'We stock about forty products instead of forty thousand, and we keep every one of them on our own shelves. That is why the stock count on the page is the stock count on the shelf.',
            }),
            el(
              'ul.feature__list',
              { role: 'list' },
              [
                'Prices in ETB, with VAT shown before you pay',
                'One variant system for fashion, electronics and downloads',
                'Wishlist and cart kept on this browser, no account needed',
              ].map((text) =>
                el('li.feature__list-item', {}, [icon('check'), el('span', { text })])
              )
            ),
            button({
              label: 'Browse the collection',
              href: COLLECTION_HREF,
              variant: 'primary',
              iconEnd: 'arrow-right',
            }).element,
          ]),
        ]),
      ]),
    ]),
    destroy: catalogue.subscribe(paint, { selector: catalogue.selectFeatured }),
  };
}

/* -------------------------------------------------------------------------- */
/* How it works / trust / newsletter                                            */
/* -------------------------------------------------------------------------- */

function steps() {
  return el('section.section', { 'aria-labelledby': 'home-steps' }, [
    el('div.container', {}, [
      sectionHeading('How it works', { eyebrow: 'Three steps', id: 'home-steps' }),
      el(
        'ol.indexed-list',
        {},
        STEPS.map((step, index) =>
          el('li.indexed-item', {}, [
            el('span.indexed-item__index', {
              text: String(index + 1).padStart(2, '0'),
              'aria-hidden': 'true',
            }),
            el('h3.indexed-item__title', { text: step.title }),
            el('p.indexed-item__text', { text: step.text }),
          ])
        )
      ),
    ]),
  ]);
}

function trustStrip() {
  return el('section.section.section--subtle', { 'aria-labelledby': 'home-trust' }, [
    el('div.container', {}, [
      el('h2.visually-hidden', { id: 'home-trust', text: 'Our guarantees' }),
      el(
        'div.trust-strip',
        {},
        TRUST.map((item) =>
          el('div.trust-item', {}, [
            el('span.trust-item__icon', { 'aria-hidden': 'true' }, [icon(item.icon)]),
            el('div', {}, [
              el('h3.trust-item__title', { text: item.title }),
              el('p.trust-item__text', { text: item.text }),
            ]),
          ])
        )
      ),
    ]),
  ]);
}

/**
 * Newsletter band.
 *
 * Phase 3 has no mailing-list endpoint, so this deliberately does not pretend to
 * subscribe anyone. It validates the address, then says plainly that the list is
 * not connected yet - a fake "you are subscribed" would be a lie the shopper only
 * discovers later.
 */
function newsletter() {
  const status = el('p.field__hint', { role: 'status', 'aria-live': 'polite' });
  const input = el('input.input', {
    type: 'email',
    name: 'email',
    id: 'newsletter-email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
    required: true,
  });

  const form = el('form.newsletter__form', { novalidate: true }, [
    el('div.field', {}, [
      el('label.field__label', { for: 'newsletter-email', text: 'Email address' }),
      input,
    ]),
    button({ label: 'Notify me', type: 'submit', variant: 'primary', icon: 'mail' }).element,
    status,
  ]);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!value) {
      status.textContent = 'Enter an email address first.';
      input.focus();
      return;
    }

    if (!input.checkValidity()) {
      status.textContent = 'That does not look like an email address yet.';
      input.focus();
      return;
    }

    status.textContent = `Thanks - we would email ${value} if the list were connected. It is not yet, so nothing was sent.`;
    form.reset();
  });

  return el('section.section', { 'aria-labelledby': 'home-newsletter' }, [
    el('div.container', {}, [
      el('div.newsletter', {}, [
        el('div', {}, [
          el('p.hero__eyebrow', { text: 'Stay in touch' }),
          el('h2.text-balance', {
            id: 'home-newsletter',
            text: 'Restock alerts and quiet sales, twice a month at most.',
          }),
          el('p.text-secondary', {
            text: 'No daily blasts and no countdown timers. Just new arrivals and the occasional honest discount.',
          }),
        ]),
        form,
      ]),
    ]),
  ]);
}
