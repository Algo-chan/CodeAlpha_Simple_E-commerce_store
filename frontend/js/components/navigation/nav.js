/**
 * Desktop navigation.
 *
 * Hover and focus both open a panel, because they are not interchangeable:
 * hover serves a mouse user, focus serves a keyboard or switch-device user.
 * Keyboard support here is the part that is usually missing - Escape closes,
 * arrows move between top-level items, Tab moves out and closes, and the panel
 * itself is a separate tab stop reached with Down.
 *
 * A mega panel is used where a category has enough children to be worth it, and
 * a simple list panel otherwise, decided by child count rather than by hand.
 */
import { el, on, qsa, isDesktop, watchMedia } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatCount } from '../../utils/format.js';

/** At or above this many children, a mega panel beats a list. */
const MEGA_THRESHOLD = 5;

/** Grace period before a panel closes after the pointer leaves, in ms. */
const CLOSE_DELAY = 180;

/**
 * @param {Array<{name:string, slug:string, description?:string,
 *                children?:object[], product_count?:number}>} categories
 * @param {{ activeSlug?: string, onNavigate?: Function }} [options]
 * @returns {{ element: HTMLElement, destroy(): void }}
 */
export function createNav(categories = [], { activeSlug, onNavigate } = {}) {
  const list = el('ul.nav__list.nav__list--top', { role: 'list' });

  for (const category of categories) {
    list.append(buildNavItem(category, activeSlug, onNavigate));
  }

  const element = el('nav.nav', { 'aria-label': 'Categories' }, [list]);

  let closeTimer = null;

  function cancelClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = setTimeout(closeAll, CLOSE_DELAY);
  }

  function closeAll() {
    cancelClose();
    for (const item of qsa('.nav__item', element)) {
      setExpanded(item, false);
    }
  }

  function openItem(item) {
    cancelClose();
    // Only one panel at a time; opening a second closes the first.
    for (const other of qsa('.nav__item', element)) {
      if (other !== item) setExpanded(other, false);
    }
    setExpanded(item, true);
  }

  const cleanups = [
    on(element, 'pointerenter', (event) => {
      // Ignore touch, where pointerenter fires on tap and the panel would open
      // under the finger and stay there.
      if (event.pointerType === 'touch') return;
      const item = event.target instanceof Element ? event.target.closest('.nav__item') : null;
      if (item && isDesktop()) openItem(item);
      else cancelClose();
    }),
    on(element, 'pointerleave', scheduleClose),
    on(element, 'focusin', (event) => {
      const item = event.target instanceof Element ? event.target.closest('.nav__item') : null;
      if (item && isDesktop()) openItem(item);
    }),
    on(element, 'focusout', (event) => {
      // `focusout` fires when focus moves within the item too, so check that
      // focus really left the whole nav subtree.
      if (!element.contains(event.relatedTarget)) closeAll();
    }),
    on(element, 'keydown', (event) => handleKeydown(event)),
    // Below the desktop breakpoint the nav is display:none and the mobile
    // drawer takes over; closing keeps aria-expanded honest.
    watchMedia('(max-width: 63.99em)', (isMobile) => {
      if (isMobile) closeAll();
    }),
  ];

  /**
   * Down opens the current item's panel and moves focus into it; Up walks back
   * out to the trigger. Left and Right move between top-level items without
   * opening anything. Home and End jump to the ends.
   */
  function handleKeydown(event) {
    const items = qsa('.nav__item', element);
    if (items.length === 0) return;

    const active = event.target instanceof Element ? event.target.closest('.nav__item') : null;
    const index = active ? items.indexOf(active) : -1;
    const triggerOf = (item) => item?.querySelector('.nav__link');
    const firstLinkInPanel = (item) => item?.querySelector('.nav__panel a, .nav__panel button');

    switch (event.key) {
      case 'ArrowDown': {
        if (index < 0) return;
        const target = firstLinkInPanel(items[index]);
        if (!target) return;
        event.preventDefault();
        openItem(items[index]);
        target.focus();
        break;
      }

      case 'ArrowUp': {
        if (index < 0) return;
        event.preventDefault();
        triggerOf(items[index])?.focus();
        closeAll();
        break;
      }

      case 'ArrowRight': {
        event.preventDefault();
        const next = items[(index + 1 + items.length) % items.length];
        triggerOf(next)?.focus();
        closeAll();
        break;
      }

      case 'ArrowLeft': {
        event.preventDefault();
        const previous = items[(index - 1 + items.length) % items.length];
        triggerOf(previous)?.focus();
        closeAll();
        break;
      }

      case 'Escape': {
        if (index < 0) return;
        event.preventDefault();
        triggerOf(items[index])?.focus();
        closeAll();
        break;
      }

      case 'Home': {
        event.preventDefault();
        triggerOf(items[0])?.focus();
        break;
      }

      case 'End': {
        event.preventDefault();
        triggerOf(items.at(-1))?.focus();
        break;
      }

      default:
        break;
    }
  }

  return {
    element,
    closeAll,
    destroy() {
      clearTimeout(closeTimer);
      cleanups.forEach((fn) => fn());
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Item construction                                                            */
/* -------------------------------------------------------------------------- */

function buildNavItem(category, activeSlug, onNavigate, index = 0) {
  const children = category.children ?? [];
  const hasPanel = children.length > 0;
  const isActive = category.slug === activeSlug;
  const useMega = children.length >= MEGA_THRESHOLD;

  const link = el(
    'a.nav__link',
    {
      id: `nav-trigger-${category.slug}`,
      href: categoryUrl(category),
      ...(isActive ? { 'aria-current': 'page' } : {}),
      ...(onNavigate ? { onClick: () => onNavigate(category) } : {}),
    },
    [category.name, hasPanel ? icon('chevron-down', { className: 'nav__chevron' }) : null]
  );

  const item = el(
    `li.nav__item${hasPanel ? (useMega ? '.nav__item--mega' : '.nav__item--simple') : ''}`,
    { dataset: { index: String(index), slug: category.slug } },
    [link, hasPanel ? buildPanel(category, children, useMega) : null]
  );

  if (hasPanel) {
    link.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-controls', `nav-panel-${category.slug}`);
  }

  return item;
}

function buildPanel(category, children, useMega) {
  const panelId = `nav-panel-${category.slug}`;

  const body = useMega
    ? buildMega(category, children)
    : el(
        'ul.nav__list',
        { role: 'list' },
        children.map((child) =>
          el('li', {}, [
            el('a.nav__list-link', { href: categoryUrl(child) }, [
              child.name,
              child.product_count
                ? el('span.nav__mega-count', { text: formatCount(child.product_count, 'item') })
                : null,
            ]),
            child.description ? el('p.nav__list-note', { text: child.description }) : null,
          ])
        )
      );

  return el(
    `div.nav__panel.${useMega ? 'nav__panel--mega' : 'nav__panel--simple'}`,
    {
      id: panelId,
      // Labelled by its trigger, so assistive tech announces "Electronics,
      // expanded" instead of reading the panel contents unprompted.
      'aria-labelledby': `nav-trigger-${category.slug}`,
      // `inert` keeps a closed panel out of the tab order and blocks pointer
      // events, without a display change that would kill the open transition.
      inert: true,
    },
    [body]
  );
}

function buildMega(category, children) {
  const columns = chunk(children, 4).map((group, index) =>
    el('div.nav__mega-column', {}, [
      index === 0 && category.description
        ? el('p.nav__mega-description', { text: category.description })
        : null,
      el(
        'ul.nav__list',
        { role: 'list' },
        group.map((child) =>
          el('li', {}, [
            el('a.nav__mega-link', { href: categoryUrl(child) }, [
              el('span.nav__mega-title', { text: child.name }),
              child.product_count
                ? el('span.nav__mega-count', { text: formatCount(child.product_count, 'item') })
                : null,
            ]),
          ])
        )
      ),
    ])
  );

  return el('div.nav__mega', {}, [
    ...columns,
    el('div.nav__mega-column.nav__mega-column--all', {}, [
      el('a.nav__mega-all', { href: categoryUrl(category) }, [
        `All ${category.name}`,
        icon('arrow-right'),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Opens or closes one item's panel.
 *
 * A closed panel is marked `inert` rather than `display: none`. `inert` takes it
 * out of the tab order and blocks pointer events while leaving it laid out, so
 * the open and close transitions can actually run. `display: none` would kill
 * the animation and, worse, lose the shopper's scroll position inside it.
 */
function setExpanded(item, expanded) {
  const trigger = item.querySelector('.nav__link');
  const panel = item.querySelector('.nav__panel');
  if (!trigger || !panel) return;

  trigger.setAttribute('aria-expanded', String(expanded));
  item.classList.toggle('is-open', expanded);

  if (expanded) {
    panel.removeAttribute('inert');
    panel.dataset.open = 'true';
  } else {
    panel.setAttribute('inert', '');
    delete panel.dataset.open;
  }
}

/** A deep category is addressable by slug on the one collection page. */
export function categoryUrl(category) {
  return `/collection.html?category=${encodeURIComponent(category.slug)}`;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export default { createNav, categoryUrl };
