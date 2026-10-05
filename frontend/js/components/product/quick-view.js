/**
 * Quick view.
 *
 * A modal that answers "can I buy this, and for how much?" without a page
 * navigation. That is the whole design brief: no delivery policy, no reviews, no
 * long description - just enough to choose an option and commit, or to be one
 * click from the full page.
 *
 * It is a panel from the shared overlay manager, so it inherits inertness, the
 * counted scroll lock, the focus trap and Back-button dismissal. Nothing about
 * "modal" is reimplemented here.
 *
 * The panel is built once and *refilled* on each open. Creating a panel per open
 * would leave dead nodes and dead subscriptions behind, and would push a new
 * history entry every time.
 */
import { el, qs, clear, append } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatMoney, discountPercent } from '../../utils/format.js';
import { createPanel } from '../feedback/overlay.js';
import { button } from '../ui/button.js';
import { price, stockLine } from './price.js';
import { rating } from '../ui/rating.js';
import { productGallery } from './product-gallery.js';
import { variantPicker } from './variant-picker.js';
import { stepper } from '../forms/stepper.js';
import { wishlistButton } from './wishlist-button.js';

/**
 * The canonical product URL.
 *
 * Slug, not id - the same form every product card links to, so a shopper who
 * copies the address out of the address bar gets a link that still works after
 * the catalogue is re-seeded.
 */
const pageUrl = (product) => `/product.html?slug=${encodeURIComponent(product.slug)}`;

/**
 * @param {object} options
 * @param {object} options.cart
 * @param {object} options.wishlist
 * @param {object} options.ui               toast store
 * @returns {{ open: (product: object, options?: {trigger?: HTMLElement}) => object,
 *             close: () => object, isOpen: boolean, destroy: () => void }}
 */
export function createQuickView({ cart, wishlist, ui }) {
  /** Everything belonging to the product currently on screen. */
  let owned = [];

  let product = null;
  let gallery = null;
  let picker = null;
  let quantity = null;
  /** The two Add buttons: one in the info column, one in the mobile footer. */
  let buyControls = [];
  let priceHost = null;
  let stockHost = null;
  /** True while an add is in flight, so selection changes cannot re-enable it. */
  let busy = false;

  const panel = createPanel({
    id: 'quick-view',
    variant: 'modal',
    // The panel title is the accessible name, and it is only known once a product
    // is - so the static value is replaced on every open.
    title: 'Product',
    headingLevel: 'h2',
    // An empty host. `render` runs once, at panel creation; `open()` fills the
    // body with the product. Returning `context.body` here would append the body
    // into itself.
    render: () => el('div'),
  });

  /* --- Shell --------------------------------------------------------------- */

  function open(next, { trigger } = {}) {
    teardown();

    if (!next) return panel;

    product = next;
    qs('.overlay__title', panel.panel).textContent = product.name;

    gallery = productGallery({ images: product.images ?? [], badges: product.badges ?? [] });

    priceHost = el('div.quickview__pricing');
    stockHost = el('div.quickview__stock');

    picker = variantPicker({ product, small: true, onChange: syncSelection });
    owned.push(picker);

    // Built once per open, not once per option change: the button subscribes to the
    // wishlist itself, so recreating it on every selection would leave a detached
    // tree still subscribed for as long as the panel stays open.
    const save = wishlistButton({ productId: product.id, name: product.name, wishlist });
    owned.push(save);

    quantity = stepper({ label: 'Quantity', singular: 'item', max: 10, small: true });

    const infoBuy = createBuyButton();
    const footerBuy = createBuyButton();
    buyControls = [infoBuy, footerBuy];

    const info = el('div.quickview__info', {}, [
      product.brand ? el('p.quickview__brand', { text: product.brand }) : null,
      el('h3.quickview__title', {}, [
        el('a.quickview__title-link', { href: pageUrl(product), text: product.name }),
      ]),
      el('div.quickview__meta', {}, [
        rating({
          rating: product.rating_average ?? 0,
          count: product.rating_count ?? 0,
          href: `${pageUrl(product)}#reviews`,
        }),
        product.default_variant?.sku
          ? el('span.quickview__sku', { text: product.default_variant.sku })
          : null,
      ]),
      el('p.quickview__description', {
        text: product.short_description ?? product.description ?? '',
      }),
      priceHost,
      save.element,
      picker.element,
      assurance(),
      // Desktop: the buy row lives here, at the end of the column.
      el('div.quickview__buy', {}, [quantity.element, infoBuy.element]),
    ]);

    panel.body.replaceChildren(
      el('div.quickview', {}, [
        el('div.quickview__layout', {}, [el('div.quickview__media', {}, [gallery.element]), info]),
        // Mobile: pinned within thumb reach. Hidden on desktop by the stylesheet,
        // which is why there are two buttons rather than one moved around.
        el('div.quickview__footer', {}, [
          el('div.quickview__buy', {}, [footerBuy.element]),
          stockHost,
        ]),
      ])
    );

    syncSelection();
    panel.open({ trigger });
    return panel;
  }

  function createBuyButton() {
    const control = button({
      label: 'Add to cart',
      variant: 'primary',
      size: 'lg',
      onClick: () => addToCart(),
    });
    owned.push(control);
    return control;
  }

  /* --- Selection sync ------------------------------------------------------ */

  /**
   * Everything that depends on the chosen option is updated in one place: price,
   * saving, stock, the quantity ceiling, and whether the button can be pressed.
   */
  function syncSelection() {
    const variant = picker?.getVariant() ?? product?.default_variant;
    if (!variant) return;

    const available = variant.stock ? variant.stock.available : null;

    clear(priceHost);
    append(
      priceHost,
      price({
        price: variant.price_minor,
        compareAt: variant.compare_at_price_minor,
        size: 'lg',
      })
    );

    // The saving line only means something when the *selected* option is
    // reduced, not merely because some other size is.
    const saving = discountPercent(variant.price_minor, variant.compare_at_price_minor);
    // `append` from core/dom, not Node.append: the native one stringifies the
    // `null` branch into the visible text "null".
    append(
      priceHost,
      saving > 0
        ? el('p.quickview__save', {}, [icon('tag'), `You save ${saving}% on this option.`])
        : null
    );

    stockHost.replaceChildren(stockLine(variant, available));

    // A ceiling of one leaves the stepper with nothing usable, so the quantity row
    // is hidden rather than shown inert.
    quantity.setMax(available === null ? null : Math.max(available, 1));
    quantity.element.hidden = available !== null && available <= 1;

    const soldOut = !variant.is_purchasable;
    // Read from the variant, not recomputed here: the threshold is the server's
    // policy and it has already applied it to this exact variant.
    const low = variant.is_low_stock === true;

    for (const control of buyControls) {
      control.setLabel(
        soldOut ? 'Sold out' : low ? `Add to cart — only ${available} left` : 'Add to cart'
      );
      // `busy` wins over `soldOut`: an in-flight add must stay locked even if the
      // shopper changes option mid-request.
      control.element.disabled = soldOut || busy;
    }
  }

  /* --- Add to cart --------------------------------------------------------- */

  async function addToCart() {
    const variant = picker?.getVariant() ?? product?.default_variant;
    if (!variant?.is_purchasable || busy) return;

    const wanted = quantity.getValue();
    const [primary] = buyControls;

    // Both buttons are locked, not just the one clicked. The second lives in the
    // mobile footer, and a second tap there would add the same item twice.
    busy = true;
    for (const control of buyControls) control.element.disabled = true;

    await primary.run(() => {
      // `cart.add` reads the variant's own price, stock and product, so it takes
      // the variant object - not its id.
      const result = cart.add(variant, wanted);

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

      // The quick view has done its job; leaving it open would stack the
      // confirmation on top of the dialog that caused it.
      panel.close();
    });

    busy = false;
    syncSelection();
  }

  /* --- Availability -------------------------------------------------------- */

  function assurance() {
    const rows = product.is_digital
      ? [
          ['download', 'Instant download after checkout'],
          ['lock', 'Secure payment'],
        ]
      : [
          ['truck', 'Delivered across Addis Ababa in 2–4 days'],
          ['refresh', 'Free returns within 14 days'],
          ['shield', 'Checked before it ships'],
        ];

    return el(
      'ul.quickview__assurance',
      {},
      rows.map(([name, text]) =>
        el('li.quickview__assurance-item', {}, [icon(name), el('span', { text })])
      )
    );
  }

  /* --- Teardown ------------------------------------------------------------ */

  /**
   * Releases everything the previous product attached.
   *
   * Store subscriptions are the reason this exists: a wishlist button left
   * subscribed would keep re-rendering a detached tree for the life of the page,
   * and the cart badge would then update twice for one change.
   */
  function teardown() {
    for (const item of owned) item?.destroy?.();
    owned = [];

    gallery?.destroy();
    gallery = null;
    picker = null;
    quantity = null;
    buyControls = [];
    busy = false;
    product = null;
  }

  return {
    /**
     * @param {object} next  product view model, already loaded
     * @param {{trigger?: HTMLElement}} [options]
     */
    open(next, options = {}) {
      return open(next, options);
    },
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
    destroy() {
      teardown();
      panel.destroy();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

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

export default { createQuickView };
