/**
 * Cart page.
 *
 * The full basket, as opposed to the drawer's confirmation glance. Same store,
 * same line component - the difference is room: the page shows the whole basket
 * and the whole summary side by side, and it is the surface a shopper lands on
 * after following "View full cart".
 *
 * Redraws wholesale from the cart store on every change rather than mutating rows
 * in place. A basket is short and the mutation surface is large - quantity,
 * availability flag, removal, undo - so rebuilding is both simpler and less
 * likely to leave a row showing a quantity the store has already changed.
 */
import { el, clear, on } from '../core/dom.js';
import { formatCount, formatMoney } from '../utils/format.js';
import { button } from '../components/ui/button.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { pageTitle, sectionHeading } from '../components/layout/page-header.js';
import { emptyCartState } from '../components/feedback/states.js';
import { skeletonCart } from '../components/feedback/skeleton.js';
import { cartLineItem, cartShippingProgress } from '../components/cart/cart-line.js';
import { productRail } from '../components/product/product-card.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.cart
 * @param {object} options.catalogue
 * @param {object} options.wishlist
 * @param {object} [options.ui]       toast store, for the undo on remove
 * @param {object} [options.quickView]
 * @returns {{ destroy(): void }}
 */
export default function cartPage({ host, cart, catalogue, wishlist, ui = null, quickView = null }) {
  // One container for the whole page: the breadcrumb, the two-column grid and the
  // recommendations are a single column of content, so the gutters are decided once
  // here rather than re-applied by each section.
  const shell = el('div.container.cart-shell');
  const cleanups = [];

  document.title = 'Your cart - Aster & Oak';
  host.replaceChildren(shell);

  function draw() {
    cleanups.splice(0).forEach((fn) => fn());
    clear(shell);

    const lines = cart.selectLines();
    const syncStatus = cart.selectSyncStatus();

    // `breadcrumb()` prepends Home itself, so passing it here would render
    // "Home / Home / Cart".
    shell.append(breadcrumb([{ label: 'Cart' }]));

    // While the very first server read is still in flight the basket is not
    // known to be empty; showing the empty state would flash a lie.
    if (lines.length === 0 && syncStatus === 'syncing') {
      shell.append(pageTitle('Your cart', { eyebrow: 'Loading…' }), skeletonCart(3));
      return;
    }

    if (syncStatus === 'error') {
      shell.append(
        el('div.form-alert.form-alert--error', { role: 'alert' }, [
          el('div', {}, [
            el('p', { text: 'Your cart could not be saved to the server.' }),
            button({
              label: 'Retry',
              variant: 'quiet-danger',
              size: 'sm',
              onClick: () => cart.hydrate(),
            }).element,
          ]),
        ])
      );
    }

    if (lines.length === 0) {
      shell.append(pageTitle('Your cart', { eyebrow: 'Nothing here yet' }), emptyCartState());
      return;
    }

    const unfulfillable = lines.filter((line) => line.unavailableReason).length;

    // `.cart-page` is the two-column grid: items on the left, sticky summary on
    // the right. The related rail sits outside it because it should span full
    // width rather than sit in the summary column.
    shell.append(
      el('div.cart-page', {}, [
        el('div', {}, [
          pageTitle('Your cart', {
            eyebrow: formatCount(cart.selectCount(), 'item'),
            lede:
              unfulfillable > 0
                ? 'Some items need your attention before this order can go through.'
                : 'Everything is held for you while you decide.',
          }),
          cartShippingProgress(cart.selectShippingProgress(), true),
          el(
            'ul.cart__lines',
            { role: 'list' },
            lines.map((line) => cartLineItem({ line, cart, toasts: ui }))
          ),
        ]),

        el('aside.cart-page__summary', { 'aria-label': 'Order summary' }, [
          summary({ cart, unfulfillable }),
        ]),
      ]),

      recommendations({ catalogue, wishlist, quickView, lines, cleanups })
    );
  }

  draw();

  const stop = cart.subscribe(draw);

  return {
    destroy() {
      stop();
      cleanups.splice(0).forEach((fn) => fn());
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Order summary.
 *
 * Delivery is stated as unknown rather than invented: a made-up fee becomes a
 * support ticket the first time it disagrees with the real one. The delivery
 * meter only ever counts buyable lines, so "add X for free delivery" cannot be
 * reached with items that cannot be ordered.
 */
function summary({ cart, unfulfillable }) {
  const subtotal = cart.selectSubtotal();
  const buyable = cart.selectCount();

  const checkout = button({ label: 'Checkout', variant: 'primary', block: true }).element;
  const note = el('p.form-alert.form-alert--info', {
    role: 'status',
    // Focusable so focus can be moved here when the shopper asks why checkout is
    // inert. A status region that never receives focus is announced inconsistently.
    tabindex: '-1',
    text: 'Checkout arrives in a later phase. Nothing on this page takes payment.',
  });

  on(checkout, 'click', () => {
    checkout.setAttribute('aria-disabled', 'true');
    checkout.title = 'Checkout arrives in a later phase';
    note.focus();
  });

  if (buyable === 0) checkout.setAttribute('aria-disabled', 'true');

  return el('div', {}, [
    el('h2.text-lg', { text: 'Order summary' }),

    el('dl', {}, [
      el('div.cart__row', {}, [
        el('dt', { text: 'Subtotal' }),
        el('dd', { text: formatMoney(subtotal) }),
      ]),
      el('div.cart__row.cart__row--placeholder', {}, [
        el('dt', { text: 'Delivery' }),
        el('dd', { text: 'Calculated at checkout' }),
      ]),
      el('div.cart__row.cart__row--total', {}, [
        el('dt', { text: 'Total' }),
        el('dd', { text: formatMoney(subtotal) }),
      ]),
    ]),

    el('p.cart__note', {
      text: 'Taxes included. Digital items become available as soon as payment clears.',
    }),

    unfulfillable > 0
      ? el('p.form-alert.form-alert--error', {
          role: 'status',
          text: `${formatCount(unfulfillable, 'item')} can no longer be ordered. Remove ${
            unfulfillable === 1 ? 'it' : 'them'
          } to continue.`,
        })
      : null,

    checkout,
    note,

    button({ label: 'Continue shopping', href: '/collection.html', variant: 'ghost', block: true })
      .element,

    button({
      label: 'Clear cart',
      variant: 'quiet-danger',
      block: true,
      onClick: () => cart.clear(),
    }).element,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Recommendations                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Suggestions drawn from the same categories as what is already in the basket, so
 * the rail is relevant to the choices just made rather than random.
 */
function recommendations({ catalogue, wishlist, quickView, lines, cleanups }) {
  const inCart = new Set(lines.map((line) => line.productId));

  // A line carries ids and display fields, not the catalogue record, and
  // `selectRelated` is curried - so the anchor is resolved before it is applied.
  const anchor = catalogue.getProduct(lines[0].productId);

  const related = anchor
    ? catalogue
        .selectRelated()(anchor)
        .filter((product) => !inCart.has(product.id))
        .slice(0, 6)
    : [];

  if (related.length === 0) return null;

  const rail = productRail({
    products: related,
    wishlist,
    ariaLabel: 'You might also like',
    onQuickView: quickView ? (product, trigger) => quickView.open(product, { trigger }) : null,
  });
  cleanups.push(() => rail.destroy());

  // No inner `.container`: the page shell is already one, so wrapping again would
  // inset the rail further than the basket above it.
  return el('section.section', { 'aria-labelledby': 'cart-related' }, [
    sectionHeading('You might also like', {
      eyebrow: 'Complete the order',
      id: 'cart-related',
    }),
    rail.element,
  ]);
}
