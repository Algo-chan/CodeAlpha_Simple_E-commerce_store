/**
 * Frontend entry point.
 *
 * The shell is assembled in JavaScript rather than from fetched HTML partials,
 * for one reason: the header and the cart drawer are *reactive*. They subscribe
 * to the cart store, so the badge updates the instant something is added from a
 * product card three components away. Server-rendered partials cannot do that,
 * and duplicating the markup across five HTML files guarantees the copies drift.
 *
 * What is shared by every page, and what each page owns:
 *
 *   SHARED HERE   stores, catalogue load, header, footer, cart drawer, search,
 *                 toasts, global shortcuts, the error boundary
 *   PER PAGE      one module in `js/pages/`, which fills `#main-content`
 *
 * Each HTML page ends with:
 *   <script type="module" src="/js/app.js" data-page="home"></script>
 * and `data-page` selects the module. Page modules are dynamically imported, so
 * a shopper landing on the collection page never downloads the product page.
 */
import { el, qs, on } from './core/dom.js';
import { config } from './config.js';
import { mockApi } from './mock/api.js';
import { createCatalogueStore } from './state/catalogue.js';
import { createCartStore } from './state/cart.js';
import { createWishlistStore } from './state/wishlist.js';
import { createUiStore } from './state/ui.js';
import { createFilterStore } from './state/filters.js';
import { createSearchHistory } from './state/search-history.js';
import { createHeader } from './components/layout/header.js';
import { createFooter } from './components/layout/footer.js';
import { createCartDrawer } from './components/cart/cart-drawer.js';
import { createQuickView } from './components/product/quick-view.js';
import { createSearchOverlay } from './components/search/search-overlay.js';
import { createToastRegion } from './components/feedback/toast.js';
import { errorState } from './components/feedback/states.js';

/** Page modules, keyed by the `data-page` attribute. */
const pages = {
  home: () => import('./pages/home.js'),
  collection: () => import('./pages/collection.js'),
  wishlist: () => import('./pages/wishlist.js'),
  product: () => import('./pages/product.js'),
  cart: () => import('./pages/cart.js'),
};

/**
 * @typedef {object} AppContext
 * @property {object} api          data client (the mock during Phase 3)
 * @property {object} catalogue
 * @property {object} cart
 * @property {object} wishlist
 * @property {object} ui
 * @property {object} filters
 * @property {object} cartDrawer
 * @property {object} quickView
 * @property {object} search
 * @property {object} config
 * @property {string|null} categorySlug  active category, for nav highlighting
 * @property {object} hooks
 */

/** Shared context handed to every page module. */
let context = null;

/** Teardown functions, run on pagehide. */
const teardown = [];

/* -------------------------------------------------------------------------- */
/* Boot                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Builds the stores and the shell.
 *
 * The catalogue is awaited before the header renders, because the navigation is
 * built from the category tree and rendering it twice would cause a visible
 * re-layout. The mock resolves almost immediately; against a real API this is
 * where a cached category list would go instead.
 *
 * @returns {Promise<AppContext>}
 */
async function boot() {
  const ui = createUiStore();
  const catalogue = createCatalogueStore();
  const wishlist = createWishlistStore();
  const filters = createFilterStore();
  const searchHistory = createSearchHistory();

  const cart = createCartStore({
    // Asked to re-read price and stock, so a basket restored from storage cannot
    // quote a price or a quantity that has since changed.
    resolveVariant: (variantId) => catalogue.getVariant(variantId),
  });

  // Toasts first: an "added to cart" can be raised while the shell is still
  // building, and it needs somewhere to appear.
  const toastRegion = createToastRegion({ store: ui });
  document.body.append(toastRegion);
  teardown.push(() => toastRegion.destroy());

  catalogue.setLoading();
  const loadError = await loadCatalogue(catalogue, mockApi);

  // Even on failure the shell renders. A storefront with no navigation and no
  // footer is a dead end, and the page will state what went wrong in place.
  const categories = catalogue.selectCategories().filter((node) => node.depth === 0);
  const categorySlug = new URLSearchParams(globalThis.location?.search ?? '').get('category');

  const cartDrawer = createCartDrawer({ cart, toasts: ui });
  const search = createSearchOverlay({ api: mockApi, history: searchHistory });
  // One quick view for the whole session, like the cart drawer: a panel per card
  // would mean dozens of registered panels and dozens of history entries.
  const quickView = createQuickView({ cart, wishlist, ui });

  const header = createHeader({
    categories,
    cart,
    wishlist,
    activeSlug: categorySlug ?? undefined,
    hooks: {
      onOpenCart: (trigger) => cartDrawer.open({ trigger }),
      onOpenSearch: (trigger) => search.open({ trigger }),
    },
  });

  const footer = createFooter();
  document.body.prepend(header.element);
  document.body.append(footer);

  teardown.push(header.destroy, cartDrawer.destroy, quickView.destroy);

  // Now that the catalogue exists, a basket restored from storage can be checked
  // against live price and availability.
  cart.reconcile();

  context = {
    api: mockApi,
    catalogue,
    cart,
    wishlist,
    ui,
    filters,
    cartDrawer,
    quickView,
    search,
    config,
    categorySlug,
    catalogueError: loadError,
    hooks: {
      onSavedChange: (saved, productId) => {
        ui.pushToast({
          title: saved ? 'Saved for later' : 'Removed from saved items',
          tone: 'info',
          actionLabel: saved ? 'View saved' : 'Undo',
          onAction: () => {
            if (saved) globalThis.location.assign('/wishlist.html');
            else wishlist.toggle(productId);
          },
        });
      },
    },
  };

  bindGlobalKeys(context);
  bindRevealOnScroll(teardown);

  return context;
}

/**
 * Loads the catalogue.
 *
 * Failure is reported rather than swallowed: an empty grid is
 * indistinguishable from a shop with no products, so the page says what happened
 * and offers a retry.
 *
 * @returns {Promise<Error|null>}
 */
async function loadCatalogue(catalogue, api) {
  try {
    const data = await api.getCatalogue();
    catalogue.setCatalogue(data);
    return null;
  } catch (error) {
    catalogue.setError(error);
    return error;
  }
}

/* -------------------------------------------------------------------------- */
/* Document behaviour                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Document-level shortcuts.
 *
 * "/" focuses search, the way it does in most shops. `c` opens the cart. Both
 * are suppressed while a text field has focus - a shortcut that eats a letter
 * the shopper meant to type is worse than no shortcut at all.
 */
function bindGlobalKeys({ search, cartDrawer }) {
  teardown.push(
    on(document, 'keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

      if (event.key === '/' && !typing) {
        event.preventDefault();
        search.open({ trigger: target });
        return;
      }

      if (event.key === 'c' && !typing) {
        event.preventDefault();
        cartDrawer.toggle({ trigger: document.activeElement });
        return;
      }

      // Escape closes the cart from anywhere, including from inside it.
      if (event.key === 'Escape' && cartDrawer.panel.isOpen) cartDrawer.close();
    })
  );
}

/**
 * Reveals `[data-reveal]` elements as they scroll into view.
 *
 * IntersectionObserver rather than a scroll listener: it runs off the main
 * thread, and elements already in view at load are revealed immediately instead
 * of waiting for a scroll event that may never come.
 *
 * @param {Function[]} cleanups
 */
function bindRevealOnScroll(cleanups) {
  const targets = document.querySelectorAll('[data-reveal]');

  if (!('IntersectionObserver' in globalThis)) {
    for (const node of targets) node.classList.add('is-revealed');
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        // One-shot: an element that has appeared does not need to vanish and
        // reappear as the shopper scrolls back up past it.
        observer.unobserve(entry.target);
      }
    },
    // Starts the reveal slightly before the element is technically visible, so
    // it is already in place by the time it arrives.
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );

  for (const node of targets) observer.observe(node);
  cleanups.push(() => observer.disconnect());
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Runs the page module. It owns exactly one thing: filling `#main-content`. If
 * it throws, the page reports it in place rather than leaving an empty region.
 *
 * A page module may return anything with a `destroy()` - `collection.js` returns
 * the controller, the others return a small handle - and that teardown is
 * registered with the shell. Page modules subscribe to stores; without this the
 * subscriptions would outlive the page they were created for.
 */
async function startPage(pageName) {
  const host = qs('#main-content');
  const load = pages[pageName] ?? pages.home;

  try {
    const module = await load();
    const page = await module.default?.({ ...context, host });

    if (typeof page?.destroy === 'function') {
      teardown.push(() => page.destroy());
    }

    if (host) host.dataset.pageState = 'ready';
  } catch (error) {
    console.error(`[app] page "${pageName}" failed`, error);
    if (host) {
      host.replaceChildren(
        errorState({
          error,
          title: 'This page could not be loaded',
          onRetry: () => globalThis.location.reload(),
        })
      );
    }
  }
}

/**
 * A placeholder painted before the first `await`.
 *
 * Without it the page is a blank white frame for as long as the catalogue takes,
 * which reads as a slow site rather than as a loading one.
 */
function showBootSkeleton(host) {
  host.replaceChildren(
    el('div.container.skeleton-page', {}, [
      el('div.skeleton.skeleton--title'),
      el('div.skeleton.skeleton--text', { style: 'inline-size:60%' }),
    ])
  );
}

async function start() {
  const host = qs('#main-content');
  const pageName = qs('script[data-page]')?.dataset.page ?? 'home';

  if (host) showBootSkeleton(host);

  try {
    await boot();
  } catch (error) {
    console.error('[app] boot failed', error);
    if (host) {
      host.replaceChildren(
        errorState({
          error,
          title: 'The shop could not start',
          onRetry: () => globalThis.location.reload(),
        })
      );
    }
    return;
  }

  await startPage(pageName);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

// `pagehide` rather than `unload`: `unload` is deprecated and blocks the back
// cache, which would make every navigation a full reload.
on(globalThis, 'pagehide', () => {
  for (const fn of teardown) {
    try {
      fn();
    } catch (error) {
      console.error('[app] teardown failed', error);
    }
  }
});
