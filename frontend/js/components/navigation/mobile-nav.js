/**
 * Mobile navigation drawer.
 *
 * Built on the shared panel so it inherits the focus trap, scroll lock, Escape
 * handling and inert background. What this file adds is the accordion:
 *
 *   - Each category is a real button with aria-expanded and aria-controls,
 *     not a link that happens to toggle.
 *   - Expanding one closes the others, because a drawer full of open
 *     accordions is a scroll trap on a short screen.
 *   - The whole category is clickable on mobile - the row toggles it - but the
 *     nested "View all X" link goes to the category. Both routes are provided,
 *     because both are what shoppers expect.
 */
import { el, on, delegate } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatCount } from '../../utils/format.js';
import { createPanel } from '../feedback/overlay.js';
import { categoryUrl } from './nav.js';

/** Promoted into the drawer above the category list. */
const PROMO = {
  title: 'Free delivery over ETB 5,000',
  text: 'On every order inside Addis Ababa.',
  href: '/collection.html',
};

/**
 * @param {Array<object>} categories
 * @param {{ activeSlug?: string }} [options]
 * @returns {{ panel: object, open(trigger?: HTMLElement): void, close(): void,
 *             isOpen: boolean }}
 */
export function createMobileNav(categories = [], { activeSlug } = {}) {
  const panel = createPanel({
    id: 'mobile-nav',
    variant: 'drawer',
    position: 'start',
    title: 'Menu',
    // A drawer is navigation, so the heading level is h2 under the page h1.
    headingLevel: 'h2',
    render: (context) => {
      const body = buildDrawerBody(categories, activeSlug, context.close);
      // Scoped to this panel's own node, and unregistered when it closes and
      // is torn down.
      context.onCleanup(bindAccordions(body));
      return body;
    },
  });

  return {
    panel,
    open: (trigger) => panel.open({ trigger }),
    close: () => panel.close(),
    get isOpen() {
      return panel.isOpen;
    },
  };
}

/**
 * @param {Array<object>} categories
 * @param {string} [activeSlug]
 * @param {Function} close
 */
function buildDrawerBody(categories, activeSlug, close) {
  const list = el('ul.mobile-nav__list', { role: 'list' });

  categories.forEach((category, index) => {
    const children = category.children ?? [];
    const panelId = `mobile-nav-panel-${category.slug}`;
    const isActive = category.slug === activeSlug;

    if (children.length === 0) {
      list.append(
        el('li.mobile-nav__item', {}, [
          el('a.mobile-nav__link', {
            href: categoryUrl(category),
            ...(isActive ? { 'aria-current': 'page' } : {}),
            onClick: () => close(),
          }, [category.name]),
        ])
      );
      return;
    }

    const sublist = el('ul.mobile-nav__sublist', {
      id: panelId,
      role: 'list',
      // Collapse uses height and opacity so the drawer animates; `inert` is
      // what actually removes the links from the tab order.
      hidden: true,
    }, children.map((child) =>
      el('li', {}, [
        el('a.mobile-nav__link.mobile-nav__link--child', {
          href: categoryUrl(child),
          onClick: () => close(),
        }, [
          child.name,
          child.product_count
            ? el('span.nav__mega-count', { text: formatCount(child.product_count, 'item') })
            : null,
        ]),
      ])
    ));

    const toggle = el('button.mobile-nav__toggle', {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': panelId,
      dataset: { index: String(index) },
    }, [
      el('span', { text: category.name }),
      icon('chevron-down', { className: 'mobile-nav__chevron' }),
    ]);

    list.append(
      el('li.mobile-nav__item', { dataset: { slug: category.slug } }, [
        el('div.mobile-nav__row', {}, [
          toggle,
          el('a.mobile-nav__link.mobile-nav__link--primary', {
            href: categoryUrl(category),
            ...(isActive ? { 'aria-current': 'page' } : {}),
            onClick: () => close(),
          }, [category.name]),
        ]),
        el('div.mobile-nav__sublist-inner', {}, [sublist]),
      ])
    );
  });

  const utility = el('div.mobile-nav__utility', {}, [
    el('a.mobile-nav__utility-link', { href: '/wishlist.html' }, [
      icon('heart'),
      'Saved items',
    ]),
    el('a.mobile-nav__utility-link', { href: '/collection.html?sort=newest' }, [
      icon('clock'),
      'New arrivals',
    ]),
    el('a.mobile-nav__utility-link', { href: '/collection.html?category=digital-downloads' }, [
      icon('download'),
      'Digital downloads',
    ]),
  ]);

  return el('div.mobile-nav__body', {}, [
    el('a.mobile-nav__promo', { href: PROMO.href }, [
      el('span.mobile-nav__promo-title', { text: PROMO.title }),
      el('span.mobile-nav__promo-text', { text: PROMO.text }),
    ]),
    list,
    utility,
  ]);
}

/**
 * One delegated listener for every accordion in the drawer.
 * @param {HTMLElement} root
 */
export function bindAccordions(root) {
  return delegate(root, 'click', '.mobile-nav__toggle', (event, matched) => {
    const item = matched.closest('.mobile-nav__item');
    const sublistId = matched.getAttribute('aria-controls');
    const sublist = sublistId ? root.querySelector(`#${CSS.escape(sublistId)}`) : null;
    if (!sublist) return;

    const expanded = matched.getAttribute('aria-expanded') === 'true';

    // Accordion behaviour: one open section at a time keeps the drawer short
    // enough that the current position is always reachable.
    for (const other of root.querySelectorAll('.mobile-nav__toggle[aria-expanded="true"]')) {
      if (other === matched) continue;
      other.setAttribute('aria-expanded', 'false');
      const otherList = root.querySelector(`#${CSS.escape(other.getAttribute('aria-controls'))}`);
      if (otherList) otherList.hidden = true;
    }

    matched.setAttribute('aria-expanded', String(!expanded));
    sublist.hidden = expanded;
    item?.classList.toggle('is-open', !expanded);
  });
}

export default { createMobileNav, bindAccordions };