/**
 * Predictive search.
 *
 * A dialog rather than a dropdown, because results include images and prices -
 * there is not room for that beside an input, and squeezing it into one creates
 * a combobox whose popup is a scroll trap.
 *
 * The behaviour that matters:
 *
 *   - DEBOUNCED AND ABORTABLE. Every keystroke cancels the previous request. The
 *     mock API honours AbortSignal, so a fast typist issues one request, not
 *     eight, and cannot have an earlier response overwrite a later one.
 *   - ARROW KEYS MOVE AN ACTIVE OPTION, NOT FOCUS. `aria-activedescendant` points
 *     at the highlighted result while focus stays in the input, so typing is
 *     never interrupted by a roving focus moving into the list.
 *   - TWO KEYS BEHAVE DIFFERENTLY. Enter opens the highlighted result if there is
 *     one and otherwise goes to the full results page. That distinction is what
 *     makes the keyboard path usable without a mouse.
 *   - ESCAPE CLOSES THE DIALOG, NOT THE QUERY. Clearing the field is a separate,
 *     visible control, so nothing happens by surprise.
 */
import { el, clear, on, escapeHtml } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatMoney, formatNumber } from '../../utils/format.js';
import { createPanel } from '../feedback/overlay.js';
import { button } from '../ui/button.js';
import { config } from '../../config.js';

/** Idle time before a keystroke triggers a request. */
const DEBOUNCE_MS = 180;

/** Suggested searches, shown before the shopper types anything. */
const SUGGESTIONS = ['linen', 'coffee', 'leather', 'ceramic', 'notebook'];

/**
 * @param {object} options
 * @param {object} options.api          must expose `searchProducts(query, opts)`
 * @param {object} [options.history]    recent-search store; omit to show suggestions only
 * @param {Function} [options.onNavigate] called with a URL to send the browser to
 * @returns {object} panel handle plus helpers
 */
export function createSearchOverlay({ api, history = null, onNavigate = null }) {
  let controller = null;
  let timer = null;
  let activeIndex = -1;
  let currentQuery = '';
  /**
   * The nodes this component renders into, captured as `render` creates them.
   *
   * They cannot be found by querying `panel.body`, because `render` runs *inside*
   * `createPanel`: `panel` is still uninitialised at that point (reading it throws
   * a temporal dead zone ReferenceError) and the body is not populated until
   * `render` returns. Holding the three nodes the rest of the file needs keeps
   * every later call site clear of both problems.
   */
  let inputEl = null;
  let resultsEl = null;
  let statusEl = null;

  const panel = createPanel({
    id: 'search',
    variant: 'modal',
    title: 'Search products',
    headingLevel: 'h2',
    render: (context) => {
      inputEl = el('input.search-overlay__input', {
        type: 'search',
        name: 'q',
        placeholder: 'Search linen, coffee, leather…',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        role: 'combobox',
        'aria-expanded': 'false',
        'aria-controls': 'search-results',
        // `listbox` + `option` is what makes arrow keys announce the active
        // result while focus remains in the input.
        'aria-autocomplete': 'list',
        'data-autofocus': '',
      });

      const clearButton = el(
        'button.search-overlay__clear',
        {
          type: 'button',
          'aria-label': 'Clear search',
          hidden: true,
        },
        [icon('close')]
      );

      resultsEl = el('div.search-overlay__results', {
        id: 'search-results',
        role: 'listbox',
        'aria-label': 'Search results',
        tabindex: '-1',
      });

      statusEl = el('p.search-overlay__status', { role: 'status', 'aria-live': 'polite' });

      const seeAll = button({
        label: 'See all results',
        variant: 'ghost',
        block: true,
        className: 'search-overlay__footer-action',
      }).element;
      seeAll.hidden = true;

      const footer = el('div.search-overlay__footer', {}, [
        el('div.search-overlay__hints', {}, [
          kbd('↑'),
          kbd('↓'),
          el('span', { text: 'to navigate' }),
          kbd('Enter'),
          el('span', { text: 'to open' }),
          kbd('Esc'),
          el('span', { text: 'to close' }),
        ]),
        el('div.search-overlay__footer-actions', {}, [seeAll]),
      ]);

      const body = el('div.search-overlay__body', {}, [
        el('div.search-overlay__field', {}, [
          icon('search', { className: 'search-overlay__icon' }),
          inputEl,
          clearButton,
        ]),
        resultsEl,
        statusEl,
        footer,
      ]);

      /* --- Behaviour --------------------------------------------------------- */

      const cleanups = [
        on(inputEl, 'input', () => {
          currentQuery = inputEl.value.trim();
          clearButton.hidden = currentQuery.length === 0;
          seeAll.hidden = currentQuery.length === 0;
          // Any highlight belongs to the previous query; dropping it stops a
          // stale row staying highlighted under freshly typed text.
          setActive(-1);
          schedule(currentQuery);
        }),

        on(inputEl, 'keydown', (event) => onKeyDown(event)),

        on(clearButton, 'click', () => {
          inputEl.value = '';
          currentQuery = '';
          clearButton.hidden = true;
          seeAll.hidden = true;
          setActive(-1);
          renderIdle();
          inputEl.focus();
        }),

        on(seeAll, 'click', () => {
          submitSearch(currentQuery);
        }),

        // Removing a recent term must not follow the row's own link, so the
        // click is stopped before the delegated results handler sees it.
        on(resultsEl, 'click', (event) => {
          const remove = event.target.closest('[data-remove-term]');
          if (remove) {
            event.preventDefault();
            event.stopPropagation();
            const removedIndex = activeIndex;
            history?.forget(remove.dataset.removeTerm);
            setActive(-1);
            renderIdle();
            // Deleting a row shifts every later row up, so the highlight is put
            // back on whatever now occupies that position rather than dropped.
            const options = optionCount();
            if (options > 0) setActive(Math.min(removedIndex, options - 1));
            return;
          }

          const row = event.target.closest('[data-href]');
          if (!row) return;
          context.close();
          navigate(row.dataset.href);
        }),

        on(resultsEl, 'pointermove', (event) => {
          // Hovering moves the highlight so mouse and keyboard cannot disagree
          // about what Enter would open.
          //
          // Matched on the listbox role rather than on `.search-result`: recent
          // searches and suggestions are `role="option"` rows too, they sit in
          // the same index space the arrow keys walk, and matching only product
          // rows left them reachable by keyboard but dead to the mouse.
          const row = event.target.closest('[role="option"]');
          if (!row) return;
          const index = Number(row.dataset.index);
          if (Number.isFinite(index)) setActive(index);
        }),

        // A click outside the list clears the highlight but leaves the dialog
        // open, so tapping the results area does not dismiss the search.
        on(document, 'pointerdown', (event) => {
          if (!panel.isOpen) return;
          if (!body.contains(event.target) && !context.panel.contains(event.target)) {
            setActive(-1);
          }
        }),
      ];

      context.onCleanup(() => {
        clearTimeout(timer);
        controller?.abort();
        cleanups.forEach((fn) => fn());
      });

      // Idle state: suggestions rather than an empty panel. An empty search
      // overlay tells the shopper nothing about what can be found here.
      renderIdle();

      return body;
    },
    onToggle: (isOpen) => {
      if (!isOpen) {
        // Cancel in-flight work, or a late response can repaint a closed dialog.
        controller?.abort();
        clearTimeout(timer);
        return;
      }

      // The panel is created once and reused, so the idle list rendered at
      // creation time is stale after a search has been recorded. Repainting on
      // open is what puts the new term at the top of recent searches.
      if (inputEl?.value.trim() === '') {
        setActive(-1);
        renderIdle();
      }
    },
  });

  /* --- API ------------------------------------------------------------------ */

  function open(options) {
    panel.open(options);
  }

  function close() {
    panel.close();
  }

  function navigate(href) {
    if (onNavigate) onNavigate(href);
    else globalThis.location.assign(href);
  }

  /**
   * Records a text query, then sends the shopper to the results page.
   *
   * Only the two paths that mean "search for this" record anything: see-all and
   * Enter-with-no-highlight. Opening a product or a category is not a search, so
   * it leaves the history alone.
   */
  function submitSearch(query) {
    if (!query) return;
    history?.record(query);
    close();
    navigate(`/collection.html?q=${encodeURIComponent(query)}`);
  }

  function schedule(query) {
    clearTimeout(timer);
    controller?.abort();

    if (query.length < 2) {
      renderIdle();
      return;
    }

    timer = setTimeout(() => run(query), DEBOUNCE_MS);
  }

  async function run(query) {
    // Each request gets its own controller; a newer one aborts the older, so an
    // earlier and slower response cannot land after a later one.
    controller = new AbortController();
    const started = Date.now();

    try {
      const results = await api.searchProducts(query, { limit: 6, signal: controller.signal });

      // Only paint if this is still the newest query.
      if (query !== currentQuery) return;

      setActive(-1);
      renderResults(query, results, Date.now() - started);
    } catch (error) {
      if (error?.name === 'AbortError' || query !== currentQuery) return;
      renderError(query, error);
    }
  }

  /* --- Rendering ------------------------------------------------------------ */

  function renderIdle() {
    const list = resultsNode();
    clear(list);
    setExpanded(false);

    const recent = history?.selectTerms() ?? [];

    // Recent first, then suggestions. A term this shopper actually typed out
    // beats a term we guessed they might want.
    if (recent.length > 0) {
      list.append(
        el('div.search-overlay__group', {}, [
          el('div.search-overlay__group-head', {}, [
            el('p.search-overlay__group-title', { text: 'Recent searches' }),
            el('button.search-overlay__group-clear', {
              type: 'button',
              text: 'Clear',
              onClick: () => {
                history?.clear();
                setActive(-1);
                renderIdle();
              },
            }),
          ]),
          ...recent.map((term, index) => recentRow(term, index)),
        ])
      );
    }

    list.append(
      el('div.search-overlay__group', {}, [
        el('p.search-overlay__group-title', {
          text: recent.length > 0 ? 'Try instead' : 'Popular searches',
        }),
        ...SUGGESTIONS.map((term, index) => {
          const href = `/collection.html?q=${encodeURIComponent(term)}`;

          return el(
            'a.search-suggestion',
            {
              href,
              role: 'option',
              // `aria-activedescendant` must point at a real element id, and these
              // rows are activatable by the arrow keys just like product rows are.
              id: `search-suggestion-${index}`,
              'aria-selected': 'false',
              // Offset by the recent rows above so hovering a suggestion moves the
              // highlight onto it, exactly as hovering a product result does.
              dataset: { index: String(recent.length + index), href },
            },
            [icon('search'), term]
          );
        }),
      ])
    );
  }

  /**
   * One remembered term.
   *
   * A `div` rather than an `a`, because it carries a remove button and a button
   * inside a link is not valid HTML - nor reachable by keyboard. It stays
   * activatable through the same `role="option"` mechanism as every other row,
   * since focus never leaves the input.
   */
  function recentRow(term, index) {
    const href = `/collection.html?q=${encodeURIComponent(term)}`;

    return el(
      'div.search-suggestion',
      {
        role: 'option',
        'aria-selected': 'false',
        id: `search-recent-${index}`,
        dataset: { index: String(index), href },
      },
      [
        icon('clock'),
        el('span.search-suggestion__term', { text: term }),
        el(
          'button.search-suggestion__remove',
          {
            type: 'button',
            'aria-label': `Remove “${term}” from recent searches`,
            dataset: { removeTerm: term },
          },
          [icon('close')]
        ),
      ]
    );
  }

  function renderResults(query, { products, categories }, elapsed) {
    const list = resultsNode();
    clear(list);
    setExpanded(true);

    if (products.length === 0 && categories.length === 0) {
      list.append(
        el('div.search-overlay__group', {}, [
          el('p.search-overlay__group-title', { text: 'No matches' }),
          el('p.search-suggestion', { text: `Nothing matches “${query}”. Try a broader word.` }),
        ])
      );
      announce(`No results for ${query}`);
      return;
    }

    // One running index across every group, because `setActive` and the
    // hover handler both address rows by their position in the whole listbox.
    // Indexing each group separately made hovering a product highlight whatever
    // row happened to be that far down the list - the exact disagreement this
    // panel's keyboard handling exists to prevent.
    let optionIndex = 0;

    // Categories first: a shopper searching "coffee" usually wants the category
    // before they want an individual product.
    if (categories.length > 0) {
      list.append(
        el('div.search-overlay__group', {}, [
          el('p.search-overlay__group-title', { text: 'Categories' }),
          ...categories.map((category) => {
            const index = optionIndex++;
            const href = `/collection.html?category=${encodeURIComponent(category.slug)}`;

            return el(
              'a.search-suggestion',
              {
                href,
                role: 'option',
                // Unique across the listbox, which also holds recent, suggestion and
                // product rows, so `aria-activedescendant` resolves to exactly one node.
                id: `search-category-${index}`,
                'aria-selected': 'false',
                dataset: { index: String(index), href },
              },
              [icon('layers'), category.name]
            );
          }),
        ])
      );
    }

    if (products.length > 0) {
      list.append(
        el('div.search-overlay__group', {}, [
          el('p.search-overlay__group-title', { text: 'Products' }),
          ...products.map((product) => resultRow(product, optionIndex++, query)),
        ])
      );
    }

    announce(
      `${formatNumber(products.length + categories.length)} results for ${query}, in ${Math.round(elapsed)} milliseconds`
    );
  }

  function resultRow(product, index, query) {
    const href = `/product.html?slug=${encodeURIComponent(product.slug)}`;

    return el(
      'a.search-result',
      {
        href,
        role: 'option',
        'aria-selected': 'false',
        id: `search-result-${index}`,
        dataset: { index: String(index), href },
      },
      [
        el('span.search-result__media', {}, [
          el('img', {
            src: product.primary_image,
            alt: '',
            width: 48,
            height: 60,
            loading: 'lazy',
          }),
        ]),
        el('span.search-result__body', {}, [
          el('span.search-result__name', { html: highlight(product.name, query) }),
          el('span.search-result__meta', { text: product.category_name ?? config.store.name }),
        ]),
        el('span.search-result__price', {
          text:
            product.price_max_minor !== product.price_min_minor
              ? `From ${formatMoney(product.price_min_minor)}`
              : formatMoney(product.price_min_minor),
        }),
      ]
    );
  }

  function renderError(query, error) {
    const list = resultsNode();
    clear(list);
    setExpanded(false);
    list.append(
      el('div.search-overlay__group', {}, [
        el('p.search-overlay__group-title', { text: 'Search is unavailable' }),
        el('p.search-suggestion', {
          text: error?.message ?? 'The search service did not respond. Please try again.',
        }),
      ])
    );
    announce('Search is unavailable');
  }

  /**
   * Marks the matched words.
   *
   * `escapeHtml` runs over the name first and the query second, so the only
   * markup in the output is the two <mark> elements this function adds itself.
   */
  function highlight(text, query) {
    const safeText = escapeHtml(text);
    const terms = query.split(/\s+/).filter((term) => term.length > 1);
    if (terms.length === 0) return safeText;

    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    return safeText.replace(pattern, '<mark class="search-highlight">$1</mark>');
  }

  function setExpanded(value) {
    input()?.setAttribute('aria-expanded', String(value));
  }

  function announce(message) {
    const node = qsStatus();
    if (node) node.textContent = message;
  }

  return {
    panel,
    open,
    close,
    toggle: (options) => (panel.isOpen ? panel.close() : panel.open(options)),
  };

  /* --- Node accessors -------------------------------------------------------- */

  // Reading the nodes captured during `render` rather than querying the panel: a
  // query needs a panel that exists, and this component renders before its own
  // panel does.
  function input() {
    return inputEl;
  }

  function resultsNode() {
    return resultsEl;
  }

  function qsStatus() {
    return statusEl;
  }

  /* --- Keyboard -------------------------------------------------------------- */

  /**
   * Moves the highlight. A negative index means "nothing is active", which is a
   * real state and not a wrap-around - wrapping would make clearing the
   * highlight silently select the first row, so Enter would open it.
   */
  function setActive(index) {
    const field = input();
    const options = resultsNode()?.querySelectorAll('[role="option"]') ?? [];
    if (options.length === 0) {
      activeIndex = -1;
      field?.removeAttribute('aria-activedescendant');
      return;
    }

    if (index < 0) {
      activeIndex = -1;
      field?.removeAttribute('aria-activedescendant');
      options.forEach((option) => {
        option.classList.remove('is-active');
        option.setAttribute('aria-selected', 'false');
      });
      return;
    }

    activeIndex = index % options.length;

    options.forEach((option, position) => {
      const isActive = position === activeIndex;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-selected', String(isActive));
      if (isActive) option.scrollIntoView({ block: 'nearest' });
    });

    field?.setAttribute('aria-activedescendant', options[activeIndex].id);
  }

  function onKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(activeIndex + 1);
        break;

      case 'ArrowUp':
        event.preventDefault();
        // From "nothing active", Up goes to the last option rather than being
        // swallowed - a dead arrow key reads as a broken widget.
        setActive(activeIndex <= 0 ? optionCount() - 1 : activeIndex - 1);
        break;

      case 'Enter': {
        if (activeIndex < 0) {
          if (!currentQuery) break;
          // No highlight means "search for this", which is the more common
          // intent than opening whichever row happens to be first.
          event.preventDefault();
          submitSearch(currentQuery);
          break;
        }
        const active = resultsNode()?.querySelectorAll('[role="option"]')[activeIndex];
        if (active?.dataset.href) {
          event.preventDefault();
          close();
          navigate(active.dataset.href);
        }
        break;
      }

      case 'Home':
        if (activeIndex >= 0) {
          event.preventDefault();
          setActive(0);
        }
        break;

      case 'End':
        if (activeIndex >= 0) {
          event.preventDefault();
          setActive(optionCount() - 1);
        }
        break;

      default:
        break;
    }
  }

  function optionCount() {
    return resultsNode()?.querySelectorAll('[role="option"]').length ?? 0;
  }
}

/** Escapes a string for use inside a RegExp. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kbd(label) {
  return el('kbd.kbd', { text: label });
}

export default { createSearchOverlay };
