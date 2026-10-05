/**
 * Collection page.
 *
 * One controller owning the whole page, because the toolbar, chip row, grid and
 * pager are all views of a single query result. Splitting them into components
 * that each subscribe independently is how a storefront ends up showing "24
 * results" above a grid holding 12 cards.
 *
 *   filters store  ->  queryProducts()  ->  { items, total, page }  ->  render
 *        ^                                                        |
 *        +----------------  facet, sort or page change  ----------+
 *
 * URL is the other direction: `?category=`, `?q=`, `?sort=` seed the store on
 * load, and every later change is written back with `replaceState`, so the page
 * is shareable and Back leaves the collection instead of stepping through it.
 */
import { el, clear, delegate, on, qsa } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatMoney, minorToMajor, formatCount } from '../../utils/format.js';
import { SORT_OPTIONS, queryProducts } from '../../state/filters.js';
import { productGrid } from '../product/product-card.js';
import { noResultsState } from '../feedback/states.js';
import { pageTitle } from '../layout/page-header.js';
import { createPanel, getPanel } from '../feedback/overlay.js';
import { button } from '../ui/button.js';
// `swatchColour` is shared with the product page's variant picker, so a facet and
// a variant cannot disagree about what "clay" looks like.
import { swatchColour } from '../product/variant-picker.js';

/** How many attribute values a group shows before "Show more". */
const COLLAPSED_VALUES = 6;

/**
 * @param {object} options
 * @param {object} options.filters   filter store
 * @param {object} options.catalogue catalogue store
 * @param {object} options.wishlist  wishlist store
 * @param {object} [options.ui]      ui store, for toasts
 * @param {(product: object, trigger: HTMLElement) => void} [options.onQuickView]
 * @returns {{ element: HTMLElement, openFilters(trigger?): void, destroy(): void }}
 */
export function createCollectionPage({
  filters,
  catalogue,
  wishlist,
  ui = null,
  onQuickView = null,
}) {
  const cleanups = [];

  const heading = el('div.section-head');
  const toolbar = el('div.collection-toolbar');
  const chips = el('div.active-filters', { 'aria-label': 'Active filters' });
  const resultsHost = el('section.collection__results');
  const pagerHost = el('nav', { 'aria-label': 'Pagination' });
  const moreHost = el('div.collection-more');

  const grid = productGrid({
    skeletons: 8,
    wishlist,
    ariaLabel: 'Products',
    onQuickView,
  });

  const element = el('div.collection-page', {}, [
    heading,
    toolbar,
    chips,
    resultsHost,
    pagerHost,
    moreHost,
  ]);

  /* --- Filter panel ---------------------------------------------------------- */

  /** The toolbar's Filter button, so the panel can keep its aria-expanded true. */
  let filterTrigger = null;

  const facetPanel = createPanel({
    id: 'collection-filters',
    variant: 'drawer',
    position: 'start',
    title: 'Filter products',
    headingLevel: 'h2',
    // The drawer can be dismissed by Escape, the scrim or Back, so the trigger's
    // state comes from the panel rather than from its own click handler.
    onToggle: (isOpen) => filterTrigger?.setAttribute('aria-expanded', String(isOpen)),
    render: (context) => {
      const body = el('div.filter-panel');

      function draw() {
        clear(body);
        body.append(
          filterSummary(filters),
          availabilityGroups(filters),
          priceGroup(filters, catalogue.selectFacets()),
          ...attributeGroups(filters, catalogue.selectFacets()),
          filters.selectActiveChips().length > 0
            ? filterActions({ filters, ui, panel: context.panel })
            : el('p.filter-panel__empty', { text: 'No filters applied.' })
        );
      }

      draw();

      // Delegated on the panel body: one listener per panel rather than one per
      // checkbox, which matters because the body is redrawn on every change.
      context.onCleanup([
        delegate(body, 'change', 'input[type="checkbox"]', (event) => {
          const input = event.target;
          if (input.dataset.facet === 'in-stock') filters.toggleInStockOnly();
          else if (input.dataset.facet === 'on-sale') filters.toggleOnSaleOnly();
          else if (input.dataset.facet === 'attribute') {
            filters.toggleAttribute(input.dataset.key, input.value);
          }
          draw();
        }),

        delegate(body, 'change', '.filter-price__input', () => {
          const [min, max] = qsa('.filter-price__input', body);
          filters.setPriceRange({ min: min.value, max: max.value });
          draw();
        }),

        delegate(body, 'click', '[data-clear-filters]', () => {
          filters.resetFacets();
          draw();
        }),

        delegate(body, 'click', '[data-more]', (_event, matched) => {
          // Reveals the rows the renderer hid, rather than re-rendering: the
          // controls the shopper already ticked must keep their state.
          for (const row of matched.closest('.filter-group')?.querySelectorAll('[hidden]') ?? []) {
            row.hidden = false;
          }
          matched.remove();
        }),
      ]);

      return body;
    },
  });

  /* --- Render ---------------------------------------------------------------- */

  function render() {
    const state = filters.getState();
    const scope = categoryScope(catalogue, state.categoryId);

    const { items, total, totalPages, page, from, to } = queryProducts(
      catalogue.selectListable(),
      state,
      { categoryIds: scope }
    );

    // The h1 reflects the current query, so "Coffee" is the title when a
    // category is chosen rather than a permanent "All products".
    drawHeading(state, total);

    drawToolbar(state, total, from, to);
    drawChips();

    clear(resultsHost);
    resultsHost.setAttribute('aria-busy', 'false');

    if (items.length === 0) {
      // Emptied rather than just detached: the cards from the last non-empty
      // page each hold a wishlist subscription, and a grid that keeps them while
      // detached goes on repainting dead nodes for the rest of the visit.
      grid.setProducts([]);
      resultsHost.append(
        noResultsState({
          total,
          onClearFilters: () => filters.resetFacets(),
          onClearSearch: state.search ? () => filters.patch({ search: '' }) : null,
        })
      );
      clear(pagerHost);
      clear(moreHost);
      return;
    }

    grid.setProducts(items);
    resultsHost.append(grid.element);

    drawPager(page, totalPages);
    drawMore(page, totalPages, total, from, to);
  }

  function drawHeading(state, total) {
    const category = state.categoryId ? catalogue.getCategory(state.categoryId) : null;
    const trail = state.categoryId ? catalogue.getCategoryTrail(state.categoryId) : [];

    clear(heading);
    heading.append(
      pageTitle(
        state.search ? `Results for “${state.search}”` : (category?.name ?? 'All products'),
        {
          eyebrow: trail.length > 0 ? trail.map((node) => node.name).join(' / ') : 'Catalogue',
          lede: category?.description ?? `${formatCount(total, 'product')} to browse.`,
        }
      )
    );
  }

  function drawToolbar(state, total, from, to) {
    clear(toolbar);

    filterTrigger = button({
      label: 'Filter',
      variant: 'secondary',
      icon: 'filter',
      // A disclosure, so it states its state - and the panel keeps it current.
      expanded: facetPanel.isOpen,
      controls: 'collection-filters-panel',
      className: 'collection-toolbar__filters',
      onClick: (event) => facetPanel.toggle({ trigger: event.currentTarget }),
    }).element;

    toolbar.append(
      el('div.collection-toolbar__count', {}, [
        el('strong', { text: formatCount(total, 'product') }),
        total > 0 ? el('span', { text: ` · showing ${from + 1}–${to}` }) : null,
      ]),
      el('div.collection-toolbar__actions', {}, [
        sortControl(state.sort, (value) => filters.setSort(value)),
        filterTrigger,
      ])
    );
  }

  function drawChips() {
    clear(chips);
    const list = filters.selectActiveChips();
    if (list.length === 0) return;

    chips.append(
      ...list.map((chip) => filterChip(chip, filters)),
      el('button.filter-chip.filter-chip--clear', {
        type: 'button',
        text: 'Clear all',
        onClick: () => filters.resetFacets(),
      })
    );
  }

  function drawPager(page, totalPages) {
    clear(pagerHost);
    if (totalPages <= 1) return;

    const nav = el('div.pagination');
    const goTo = (target) => filters.setPage(target);

    if (page > 1) nav.append(pageButton(page - 1, 'Previous', goTo, 'pagination__item--prev'));

    for (const entry of pageWindow(page, totalPages)) {
      nav.append(
        entry === 'gap'
          ? el('span.pagination__ellipsis', { 'aria-hidden': 'true', text: '…' })
          : pageButton(entry, String(entry), goTo, null, entry === page)
      );
    }

    if (page < totalPages) nav.append(pageButton(page + 1, 'Next', goTo, 'pagination__item--next'));

    pagerHost.append(nav);
  }

  function drawMore(page, totalPages, total, from, to) {
    clear(moreHost);
    if (totalPages <= 1) return;

    moreHost.append(
      el('p.collection-more__hint', { text: `Showing ${from + 1}–${to} of ${total}` }),
      button({
        label: 'Load more',
        variant: 'secondary',
        onClick: () => filters.setPage(page + 1),
      }).element
    );
  }

  /* --- Lifecycle -------------------------------------------------------------- */

  hydrateFromUrl();
  render();

  cleanups.push([
    catalogue.subscribe(render, { selector: catalogue.selectListable }),
    filters.subscribe(() => {
      render();
      syncToUrl();
    }),
  ]);

  return {
    element,
    openFilters: (trigger) => facetPanel.open({ trigger }),
    destroy() {
      cleanups.flat().forEach((fn) => fn());
      facetPanel.destroy();
      grid.destroy();
    },
  };

  /* --- URL ------------------------------------------------------------------- */

  function hydrateFromUrl() {
    const params = new URLSearchParams(globalThis.location?.search ?? '');

    // The URL is authoritative for every facet it can express, including the
    // ones it does not carry.
    //
    // The filter store persists facets on purpose, so a reload of
    // `/collection.html?q=wool` keeps them. But patching only the parameters
    // that are present meant the *inverse* case was wrong: after searching, a
    // click on "All products" landed on a bare `/collection.html`, the old term
    // was restored from storage, and a page titled "All products" showed one
    // product. Reading the URL as a complete description of the query makes the
    // two cases behave the same way.
    const patch = {
      search: params.get('q') ?? '',
      categoryId: null,
      onSaleOnly: params.get('sale') === '1',
      inStockOnly: params.get('stock') === '1',
    };

    // The URL addresses categories by slug because that is what a shopper shares;
    // the store addresses them by UUID because that is what the API returns.
    const slug = params.get('category');
    if (slug) {
      const category = catalogue
        .selectCategories()
        .find((node) => node.slug === slug || String(node.id) === slug);
      if (category) patch.categoryId = String(category.id);
    }

    const sort = params.get('sort');
    if (sort && sort in SORT_OPTIONS) patch.sort = sort;

    // Attribute and price facets are not URL-expressible yet, so they stay
    // session state. `page` always restarts: a restored page 3 of a smaller
    // result set renders an empty grid.
    filters.patch(patch);
  }

  function syncToUrl() {
    if (!globalThis.history?.replaceState) return;

    const state = filters.getState();
    const params = new URLSearchParams();

    if (state.search) params.set('q', state.search);
    if (state.categoryId) {
      const category = catalogue.getCategory(state.categoryId);
      if (category) params.set('category', category.slug);
    }
    if (state.sort !== 'featured') params.set('sort', state.sort);
    if (state.onSaleOnly) params.set('sale', '1');
    if (state.inStockOnly) params.set('stock', '1');

    const query = params.toString();
    // `replaceState`, not `pushState`: every keystroke in a price field would
    // otherwise become a history entry the shopper has to walk back through.
    globalThis.history.replaceState(
      null,
      '',
      `${globalThis.location.pathname}${query ? `?${query}` : ''}`
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                     */
/* -------------------------------------------------------------------------- */

function sortControl(current, onChange) {
  const select = el('select.select', { 'aria-label': 'Sort products' });

  for (const [value, option] of Object.entries(SORT_OPTIONS)) {
    select.append(
      el('option', { value, text: option.label, ...(value === current ? { selected: true } : {}) })
    );
  }

  on(select, 'change', (event) => onChange(event.target.value));

  return el('div.sort-control', {}, [
    // Implicit label: the select is the only control in the wrapper, and an
    // `aria-label` on the select would then be read on top of this visible text.
    el('label.sort-control__label', { text: 'Sort' }),
    select,
  ]);
}

function filterSummary(filters) {
  const count = filters.selectActiveChips().length;

  return el('div.filter-summary', {}, [
    el('span.filter-summary__label', {
      text: count === 0 ? 'No filters' : `${formatCount(count, 'filter')} applied`,
    }),
    count === 0
      ? null
      : el('button.filter-summary__clear', {
          type: 'button',
          text: 'Clear all',
          dataset: { clearFilters: '' },
        }),
  ]);
}

function availabilityGroups(filters) {
  const { inStockOnly, onSaleOnly } = filters.getState();

  return el('div.filter-availability', {}, [
    checkboxRow({ checked: inStockOnly, label: 'In stock only', facet: 'in-stock' }),
    checkboxRow({ checked: onSaleOnly, label: 'On sale', facet: 'on-sale' }),
  ]);
}

/**
 * A checkbox styled as a row. A checkbox and not a radio: stock and sale are
 * independent switches rather than one choice between alternatives.
 */
function checkboxRow({ checked, label, facet, count = null }) {
  return el('label.filter-radio-row', {}, [
    el('input', { type: 'checkbox', checked: checked || null, dataset: { facet }, value: facet }),
    el('span.filter-radio-row__label', { text: label }),
    count === null
      ? null
      : el('span.filter-radio-row__count', { text: formatCount(count, 'product') }),
  ]);
}

function priceGroup(filters, facets) {
  const { price } = filters.getState();
  const min = facets?.price?.min ?? 0;
  const max = facets?.price?.max ?? null;

  return filterGroup({
    title: 'Price',
    body: el('div.filter-price', {}, [
      el('div.filter-price__bounds', {}, [
        el('span', { text: formatMoney(min) }),
        el('span', { text: max === null || max === -Infinity ? 'Any' : formatMoney(max) }),
      ]),
      el('div.filter-price__inputs', {}, [
        // Whole birr at the input boundary; the store holds minor units. This is
        // the only place major units are ever accepted.
        el('input.input.filter-price__input', {
          type: 'number',
          inputmode: 'numeric',
          min: '0',
          step: '1',
          value: price.min === null ? '' : String(minorToMajor(price.min)),
          placeholder: String(minorToMajor(min ?? 0)),
          'aria-label': 'Minimum price in birr',
        }),
        el('span.filter-price__separator', { 'aria-hidden': 'true', text: '–' }),
        el('input.input.filter-price__input', {
          type: 'number',
          inputmode: 'numeric',
          min: '0',
          step: '1',
          value: price.max === null ? '' : String(minorToMajor(price.max)),
          placeholder: max === null || max === -Infinity ? 'Any' : String(minorToMajor(max)),
          'aria-label': 'Maximum price in birr',
        }),
      ]),
    ]),
  });
}

function attributeGroups(filters, facets) {
  const groups = (facets?.attributes ?? []).filter((facet) => (facet.values ?? []).length > 0);
  const selected = filters.getState().attributes;

  return groups.map((facet) => {
    // Colour gets swatches because the value is visible at a glance; size does
    // not, so a "M / L / XL" swatch would be a coloured square with no meaning.
    const isColour = /colou?r/i.test(facet.key);
    const active = selected[facet.key] ?? [];
    // A group with something selected starts expanded: collapsing the controls
    // the shopper just used hides the reason for the current result set.
    const collapse = facet.values.length > COLLAPSED_VALUES && active.length === 0;

    const visible = collapse ? facet.values.slice(0, COLLAPSED_VALUES) : facet.values;
    const hidden = collapse ? facet.values.slice(COLLAPSED_VALUES) : [];

    // Colour gets a swatch chip *beside* the row rather than instead of the
    // label: the row must stay a row, because it also carries the value name and
    // the count. A colour alone cannot be read by anyone who cannot see it, so
    // "Black" is never dropped in favour of a brown dot.
    const option = (entry, selected) =>
      el('label.filter-radio-row', { className: isColour ? 'filter-radio-row--swatch' : null }, [
        el('input', {
          type: 'checkbox',
          value: entry.value,
          checked: selected || null,
          dataset: { facet: 'attribute', key: facet.key },
        }),
        isColour
          ? el(
              'span.filter-swatch',
              { 'aria-hidden': 'true', style: `--swatch-color:${swatchColour(entry.value)}` },
              [el('span.filter-swatch__chip')]
            )
          : null,
        // The facet rows carry `{ value, count }`, and the value doubles as the label -
        // the same string `buildChips` puts on the chip for this filter.
        el('span.filter-radio-row__label', { text: entry.value }),
        el('span.filter-radio-row__count', { text: String(entry.count) }),
      ]);

    return filterGroup({
      title: facet.label,
      open: active.length > 0,
      body: el('div.filter-group__body-inner', {}, [
        el(
          'div.filter-group__options',
          isColour ? { className: 'filter-group__options filter-group__swatches' } : {},
          visible.map((entry) => option(entry, active.includes(entry.value)))
        ),
        hidden.length > 0
          ? el('div.filter-group__hidden', { hidden: true }, [
              ...hidden.map((entry) => option(entry, false)),
            ])
          : null,
        hidden.length > 0
          ? el('button.filter-group__more', {
              type: 'button',
              dataset: { more: '' },
              text: `Show ${hidden.length} more`,
            })
          : null,
      ]),
    });
  });
}

/**
 * A collapsible group on `<details>`/`<summary>`.
 *
 * Native rather than a button plus a hidden div, so the open state is in the
 * accessibility tree, keyboard operable and findable by in-page search, without
 * a line of script. The indicator rotates in CSS, so no icon is swapped in JS.
 */
function filterGroup({ title, body, open = false }) {
  return el('details.filter-group', open ? { open: true } : {}, [
    el('summary.filter-group__toggle', {}, [
      el('span.filter-group__label', { text: title }),
      el('span.filter-group__indicator', { 'aria-hidden': 'true' }),
    ]),
    el('div.filter-group__body', {}, [body]),
  ]);
}

function filterChip(chip, filters) {
  return el(
    'button.filter-chip',
    {
      type: 'button',
      'aria-label': `Remove filter: ${chip.label}`,
      onClick: () => {
        // `buildChips` emits `{ type, key, value, label }`, and the types are
        // camel-cased, so this dispatches on `type`. A one-sided price chip can
        // only exist when the other bound is already null, so clearing both is
        // the same thing as clearing the one that is set.
        if (chip.type === 'search') filters.patch({ search: '' });
        else if (chip.type === 'price') filters.setPriceRange({ min: '', max: '' });
        else if (chip.type === 'inStock') filters.toggleInStockOnly();
        else if (chip.type === 'onSale') filters.toggleOnSaleOnly();
        else if (chip.type === 'attribute') filters.toggleAttribute(chip.key, chip.value);
      },
    },
    [el('span.filter-chip__group', { text: chip.label }), icon('close')]
  );
}

function filterActions({ filters, ui }) {
  return el('div.filter-actions', {}, [
    button({
      label: 'Show results',
      variant: 'primary',
      block: true,
      // The drawer closes itself here rather than the page reaching in: only the
      // panel knows how to close cleanly, with focus returned to its trigger.
      onClick: () => getPanel('collection-filters')?.close(),
    }).element,
    button({
      label: 'Clear all',
      variant: 'ghost',
      block: true,
      onClick: () => {
        filters.resetFacets();
        ui?.pushToast({ title: 'Filters cleared', tone: 'info' });
      },
    }).element,
  ]);
}

/**
 * A pager link.
 *
 * `href="#"` keeps it a real link - middle-click and "open in new tab" behave -
 * while the click handler drives the store, because paging is not a navigation
 * the server knows about.
 */
function pageButton(page, label, onSelect, className = null, isCurrent = false) {
  return el('a.pagination__item', {
    href: '#',
    className,
    text: label,
    'aria-label': `Page ${page}`,
    ...(isCurrent ? { 'aria-current': 'page' } : {}),
    onClick: (event) => {
      event.preventDefault();
      onSelect(page);
    },
  });
}

/**
 * The page window: first, last, and a window around the current page. Rendering
 * a number per page produces a pager wider than the screen on a long result set.
 */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const entries = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) entries.push('gap');
  for (let index = start; index <= end; index += 1) entries.push(index);
  if (end < totalPages - 1) entries.push('gap');

  entries.push(totalPages);
  return entries;
}

/**
 * The selected category plus every descendant.
 *
 * Without this, choosing a parent category shows an empty grid whenever its
 * products are filed in its children - which is the normal way a catalogue is
 * organised, and the fastest way to make filtering look broken.
 */
function categoryScope(catalogue, categoryId) {
  if (!categoryId) return null;

  const ids = new Set([String(categoryId)]);
  // The flat list is ordered parents-before-children, so one pass suffices.
  for (const node of catalogue.selectCategories()) {
    if (ids.has(String(node.parent_id ?? ''))) ids.add(String(node.id));
  }

  return ids;
}

export default { createCollectionPage };
