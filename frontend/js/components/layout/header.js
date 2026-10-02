/**
 * Site header.
 *
 * Owns the brand, the sticky bar behaviour, the category strip and the cart and
 * wishlist counters. The counters are why this component subscribes to state
 * rather than being told: adding to the cart from a product card has to update
 * a badge that lives three components away, and the only way to do that
 * without coupling them is for the badge to listen.
 *
 * STICKY BEHAVIOUR IS DELIBERATE. The bar shrinks and reveals a hairline once
 * content scrolls under it, and hides when scrolling down past a threshold,
 * revealing on any scroll up. A header that is always there costs ~90px of
 * every screen; one that flickers costs trust. The hide is disabled under
 * reduced motion.
 */
import { el, on, qs, prefersReducedMotion } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { config } from '../../config.js';
import { createAnnouncement } from './announcement.js';
import { createNav, categoryUrl } from '../navigation/nav.js';
import { createMobileNav } from '../navigation/mobile-nav.js';

/** Past this scroll depth the bar is allowed to hide on downward scroll. */
const HIDE_THRESHOLD = 400;
/** Downward travel before the bar hides, so a twitch does not trigger it. */
const HIDE_DELTA = 8;

/**
 * @param {object} options
 * @param {Array<object>} options.categories
 * @param {any} options.cart      cart store
 * @param {any} options.wishlist  wishlist store
 * @param {string} [options.activeSlug]
 * @param {{ onOpenSearch?: Function, onOpenCart?: Function }} [options.hooks]
 */
export function createHeader({ categories = [], cart, wishlist, activeSlug, hooks = {} }) {
  const { onOpenSearch, onOpenCart } = hooks;

  /* --- Brand --------------------------------------------------------------- */

  const brand = el('a.brand', { href: '/', 'aria-label': config.store.logoLabel }, [
    config.store.logo
      ? el('span.brand__mark', { 'aria-hidden': 'true', html: config.store.logo })
      : el('span.brand__mark', { 'aria-hidden': 'true' }, [icon('layers')]),
    el('span.brand__name', { text: config.store.name }),
    el('span.brand__tagline', { text: config.store.tagline }),
  ]);

  /* --- Actions ------------------------------------------------------------- */

  const cartCount = el('span.header-action__count', { hidden: true, 'aria-hidden': 'true' });
  const wishlistCount = el('span.header-action__count', { hidden: true, 'aria-hidden': 'true' });

  const cartButton = el('button.header-action', { type: 'button', 'aria-label': 'Open cart, empty' }, [
    icon('cart'),
    cartCount,
  ]);

  const wishlistLink = el('a.header-action.header-action--saved', {
    href: '/wishlist.html',
    'aria-label': 'Saved items, none saved',
  }, [icon('heart'), wishlistCount]);

  // Account is a later phase. It renders disabled with an explanation rather
  // than as a link that 404s, which is the difference between "not yet" and
  // "broken".
  const accountAction = el('span.header-action.header-action--disabled', {
    'aria-hidden': 'true',
    title: 'Accounts arrive in a later phase',
  }, [icon('user')]);

  const searchTrigger = el('button.search-trigger', {
    type: 'button',
    'aria-label': 'Search products',
    onClick: (event) => onOpenSearch?.(event.currentTarget),
  }, [
    icon('search', { className: 'search-trigger__icon' }),
    el('span.search-trigger__label', { text: 'Search' }),
    // A visible shortcut hint is noise on macOS and useful on Windows/Linux,
    // so it is only rendered on the latter.
    ...(isAppleLike() ? [] : [el('kbd.kbd', { text: '/' })]),
  ]);

  const mobileSearchTrigger = el('button.header-search-field', {
    type: 'button',
    'aria-label': 'Search products',
    onClick: (event) => onOpenSearch?.(event.currentTarget),
  }, [icon('search'), el('span', { text: 'Search products' })]);

  const actions = el('div.site-header__actions', {}, [
    searchTrigger,
    mobileSearchTrigger,
    wishlistLink,
    cartButton,
    accountAction,
  ]);

  /* --- Navigation ---------------------------------------------------------- */

  const menuToggle = el('button.header-action.header-action--menu', {
    type: 'button',
    'aria-label': 'Open menu',
    'aria-expanded': 'false',
    'aria-controls': 'mobile-nav-panel',
    onClick: (event) => mobileNav.open(event.currentTarget),
  }, [icon('menu')]);

  const desktopNav = createNav(categories, { activeSlug });
  const mobileNav = createMobileNav(categories, {
    activeSlug,
    // The drawer closes via Escape, the scrim or Back as well as by its own
    // trigger, so the trigger's state is reflected from the panel.
    onToggle: (isOpen) => menuToggle.setAttribute('aria-expanded', String(isOpen)),
  });

  const bar = el('div.site-header__bar', {}, [
    el('div.container.site-header__inner', {}, [menuToggle, brand, desktopNav.element, actions]),
  ]);

  const element = el('header.site-header', {}, [
    createAnnouncement(),
    bar,
    buildCategoryStrip(categories, activeSlug),
  ]);

  /* --- State subscriptions -------------------------------------------------- */

  let lastCartCount = cart.selectCount();

  const cleanups = [
    // Selectors mean these only fire when the count actually changes, so an
    // unrelated re-render never animates the badge. A selector subscriber is
    // handed the selected value, not the whole store.
    cart.subscribe(
      (count) => {
        setCounter(cartButton, cartCount, count, (value) =>
          value === 0 ? 'Open cart, empty' : `Open cart, ${value} ${value === 1 ? 'item' : 'items'}`
        );
        bumpIfChanged(cartCount, lastCartCount, count);
        lastCartCount = count;
      },
      { selector: cart.selectCount }
    ),

    wishlist.subscribe(
      (count) => {
        setCounter(
          wishlistLink,
          wishlistCount,
          count,
          (value) => `Saved items, ${value} ${value === 1 ? 'item' : 'items'}`
        );
        // The inverse treatment makes the saved state obvious across a grid.
        wishlistLink.classList.toggle('is-active', count > 0);
      },
      { selector: wishlist.selectCount }
    ),

    on(cartButton, 'click', () => onOpenCart?.()),

    bindScrollBehaviour(bar),
  ];

  return {
    element,
    openMobileNav: (trigger) => mobileNav.open(trigger),
    destroy() {
      cleanups.forEach((fn) => fn());
      desktopNav.destroy();
      qs('.announcement', element)?.destroy?.();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Category strip                                                               */
/* -------------------------------------------------------------------------- */

function buildCategoryStrip(categories, activeSlug) {
  const links = [
    el('a.category-strip__link', {
      href: '/collection.html',
      ...(activeSlug ? {} : { 'aria-current': 'page' }),
      text: 'All products',
    }),
  ];

  // The strip is a shortcut row, not the primary nav, so it lists only the top
  // level plus the collection landing page.
  for (const category of categories) {
    links.push(
      el('a.category-strip__link', {
        href: categoryUrl(category),
        ...(category.slug === activeSlug ? { 'aria-current': 'page' } : {}),
        text: category.name,
      })
    );
  }

  return el('nav.category-strip', { 'aria-label': 'Shop by category' }, [
    el('div.container.category-strip__inner', {}, links),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Counters                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Updates a header counter.
 *
 * The visible pill is `aria-hidden` because the control's accessible name
 * already carries the count. Putting the number in both would make a screen
 * reader announce "Open cart, 3 items, 3".
 */
function setCounter(control, countNode, count, labelFor) {
  const value = Number(count) || 0;
  countNode.textContent = value > 99 ? '99+' : String(value);
  countNode.hidden = value === 0;
  control.setAttribute('aria-label', labelFor(value));
}

/**
 * Plays the pop animation, but only on a genuine change - not on first paint,
 * and not on every re-render of the header.
 */
function bumpIfChanged(countNode, previous, next) {
  if (previous === next) return;
  countNode.classList.remove('is-bumping');
  // Reading offsetWidth forces a reflow so re-adding the class restarts the
  // animation instead of being coalesced with the previous run.
  void countNode.offsetWidth;
  countNode.classList.add('is-bumping');
}

/* -------------------------------------------------------------------------- */
/* Scroll behaviour                                                             */
/* -------------------------------------------------------------------------- */

function bindScrollBehaviour(bar) {
  let lastY = globalThis.scrollY ?? 0;
  let ticking = false;

  function update() {
    ticking = false;
    const y = globalThis.scrollY ?? 0;
    const delta = y - lastY;

    // Past the fold the bar compacts: the reveal is a hairline plus reduced
    // padding, never a height change, so nothing below it reflows.
    bar.classList.toggle('is-scrolled', y > 8);
    bar.classList.toggle('is-compact', y > 120);

    if (prefersReducedMotion()) {
      bar.classList.remove('is-hidden', 'is-visible');
      lastY = y;
      return;
    }

    if (delta > HIDE_DELTA && y > HIDE_THRESHOLD) {
      bar.classList.add('is-hidden');
      bar.classList.remove('is-visible');
    } else if (delta < -HIDE_DELTA) {
      bar.classList.remove('is-hidden');
      bar.classList.add('is-visible');
    }

    lastY = y;
  }

  // rAF-throttled: scroll fires far more often than the screen refreshes, and
  // toggling classes on every event is the classic cause of a janky header.
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  const cleanups = [
    on(globalThis, 'scroll', onScroll, { passive: true }),
    // A bar that hides itself is disorienting when the viewport height changes
    // mid-scroll, which is exactly what a mobile URL bar does.
    on(globalThis, 'resize', () => {
      bar.classList.remove('is-hidden');
      bar.classList.add('is-visible');
    }),
  ];

  update();

  return () => cleanups.forEach((fn) => fn());
}

function isAppleLike() {
  const platform = globalThis.navigator?.platform ?? '';
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export default { createHeader };