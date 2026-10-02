/**
 * Wishlist page.
 *
 * Saved product ids, resolved against the catalogue and rendered as a normal grid -
 * so the wishlist page benefits from everything the grid already does (lazy
 * loading, hover states, per-card save buttons, quick view) instead of
 * reimplementing a worse version of a product card.
 *
 * Order matters here. The wishlist store keeps ids in the order they were saved,
 * and `sortBySavedOrder` restores that, because "the first thing I saved" is
 * meaningful information that a name sort would throw away.
 *
 * Saved ids that no longer resolve are reported rather than silently dropped. A
 * wishlist that quietly loses items when a product is withdrawn is worse than one
 * that admits it and offers a clean-up.
 */
import { el, clear } from '../core/dom.js';
import { formatCount } from '../utils/format.js';
import { button } from '../components/ui/button.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { pageTitle } from '../components/layout/page-header.js';
import { emptyWishlistState } from '../components/feedback/states.js';
import { productGrid } from '../components/product/product-card.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.wishlist
 * @param {object} options.catalogue
 * @param {object} [options.ui]       toast store, for undo
 * @param {object} [options.quickView]
 * @returns {{ destroy(): void }}
 */
export default function wishlistPage({ host, wishlist, catalogue, ui = null, quickView = null }) {
  // The grid outlives each draw - `setProducts` re-renders it - so it is not in
  // `perDraw`, which is cleared and rebuilt on every repaint.
  const perDraw = [];

  const grid = productGrid({
    wishlist,
    ariaLabel: 'Saved products',
    eagerCount: 4,
    onQuickView: quickView ? (product, trigger) => quickView.open(product, { trigger }) : null,
  });

  const shell = el('div.container.wishlist-page');

  document.title = 'Saved items - Aster & Oak';
  host.replaceChildren(shell);

  function draw() {
    perDraw.splice(0).forEach((fn) => fn());
    clear(shell);

    const ids = wishlist.selectIds();
    const products = wishlist.sortBySavedOrder(
      ids.map((id) => catalogue.getProduct(id)).filter(Boolean)
    );
    const orphaned = ids.filter((id) => !catalogue.getProduct(id));

    shell.append(breadcrumb([{ label: 'Saved items' }]));

    if (ids.length === 0) {
      shell.append(
        pageTitle('Saved items', { eyebrow: 'Nothing saved yet' }),
        emptyWishlistState()
      );
      return;
    }

    shell.append(
      pageTitle('Saved items', {
        eyebrow: formatCount(ids.length, 'product'),
        lede: 'Kept on this browser. Nothing is reserved until you add something to your cart.',
      }),

      toolbar({ wishlist, ui, count: ids.length }),

      orphaned.length > 0 ? orphanedNotice({ wishlist, ui, orphaned }) : null,

      grid.element
    );

    // `setProducts` rebuilds the cards and disposes their listeners, so this is
    // safe to call on every draw rather than only on the first.
    grid.setProducts(products);
  }

  draw();

  const stop = wishlist.subscribe(draw);

  return {
    destroy() {
      stop();
      perDraw.splice(0).forEach((fn) => fn());
      grid.destroy();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                      */
/* -------------------------------------------------------------------------- */

function toolbar({ wishlist, ui, count }) {
  return el('div.collection-toolbar', {}, [
    el('p.collection-toolbar__count', {}, [
      el('strong', { text: formatCount(count, 'item') }),
      ' saved',
    ]),
    el('div.collection-toolbar__actions', {}, [
      button({
        label: 'Browse products',
        href: '/collection.html',
        variant: 'ghost',
        icon: 'arrow-right',
      }).element,
      button({
        label: 'Clear saved items',
        variant: 'quiet-danger',
        icon: 'trash',
        onClick: () => {
          const snapshot = wishlist.selectIds();
          wishlist.clear();

          ui?.pushToast({
            title: `Cleared ${formatCount(snapshot.length, 'saved item')}`,
            tone: 'info',
            actionLabel: 'Undo',
            // Re-added newest-first, so undo restores the order the shopper had
            // rather than an arbitrary one.
            onAction: () => [...snapshot].reverse().forEach((id) => wishlist.add(id)),
          });
        },
      }).element,
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Withdrawn products                                                           */
/* -------------------------------------------------------------------------- */

function orphanedNotice({ wishlist, ui, orphaned }) {
  return el('div.form-alert.form-alert--warning', { role: 'status' }, [
    el('div', {}, [
      el('p', {
        text: `${formatCount(orphaned.length, 'saved product')} can no longer be found in the catalogue`,
      }),
      el('p.text-xs.text-muted', {
        text: 'The items are withdrawn or renamed. They stay saved until you remove them.',
      }),
    ]),
    button({
      label: 'Remove them',
      variant: 'quiet-danger',
      size: 'sm',
      onClick: () => {
        const snapshot = [...orphaned];
        orphaned.forEach((id) => wishlist.remove(id));

        ui?.pushToast({
          title: `Removed ${formatCount(snapshot.length, 'item')}`,
          tone: 'info',
          actionLabel: 'Undo',
          onAction: () => snapshot.forEach((id) => wishlist.add(id)),
        });
      },
    }).element,
  ]);
}
