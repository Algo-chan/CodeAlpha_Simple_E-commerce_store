/**
 * Collection page.
 *
 * A thin adapter. Everything the page does lives in
 * `components/collection/collection-page.js`, because the toolbar, chip row,
 * grid and pager are all views of a single query result and have to agree with
 * each other - splitting them into components that each subscribe independently
 * is how a storefront ends up showing "24 results" above a grid of 12 cards.
 *
 * What this module owns is the wiring the controller should not know about: the
 * page container, and the quick-view trigger (so the controller stays free of any
 * dependency on overlays and could be rendered without one).
 */
import { el } from '../core/dom.js';
import { createCollectionPage } from '../components/collection/collection-page.js';

export default function collectionPage({ host, filters, catalogue, wishlist, ui, quickView }) {
  const page = createCollectionPage({
    filters,
    catalogue,
    wishlist,
    ui,
    // Cards hand back the trigger they were opened from, so focus returns to that
    // card rather than to the top of the page.
    onQuickView: quickView ? (product, trigger) => quickView.open(product, { trigger }) : null,
  });

  host.replaceChildren(el('div.container', {}, [page.element]));
  return page;
}
