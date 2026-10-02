/**
 * Empty, error and information states.
 *
 * Every list in this storefront can end up empty, and the three cases are
 * genuinely different and must not share one component's copy:
 *
 *   EMPTY  - nothing here yet, and that is fine. Offer the way out.
 *   ERROR  - something failed. Offer a retry, and say what failed.
 *   INFO   - there is nothing because of a choice the shopper made. Undo it.
 *
 * Collapsing these into a single "No results" is the most common way a
 * storefront tells a shopper nothing at the exact moment they need telling.
 */
import { el } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { button } from '../ui/button.js';

/**
 * @param {object} options
 * @param {'empty'|'error'|'info'|'warning'} [options.variant]
 * @param {string} options.icon
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {Array<{label:string, href?:string, onClick?:Function, variant?:string}>} [options.actions]
 * @param {boolean} [options.compact]
 * @param {string} [options.dividerText] rendered above the state, e.g. a filter summary
 * @returns {HTMLElement}
 */
export function state({
  variant = 'empty',
  icon: iconName,
  title,
  description = null,
  actions = [],
  compact = false,
  dividerText = null,
}) {
  const node = el(`div.state.state--${variant}`, {
    // Errors are assertive because the shopper may be waiting on a promise
    // that has now failed; everything else is polite.
    role: variant === 'error' ? 'alert' : 'status',
  }, [
      dividerText ? el('p.state__divider-text', { text: dividerText }) : null,
      el('div.state__icon', { 'aria-hidden': 'true' }, [icon(iconName, { size: 28 })]),
      el('div.state__body', {}, [
        el('h2.state__title', { text: title }),
        description ? el('p.state__description', { text: description }) : null,
      ]),
      actions.length > 0
        ? el(
            'div.state__actions',
            {},
            actions.map((action) =>
              button({
                label: action.label,
                variant: action.variant ?? 'secondary',
                ...(action.href ? { href: action.href } : {}),
                ...(action.onClick ? { onClick: action.onClick } : {}),
              }).element
            )
          )
        : null,
    ]
  );

  if (compact) node.classList.add('state--compact');
  return node;
}

/** Nothing matched the current filters - offer to clear them. */
export function noResultsState({ total, onClearFilters, onClearSearch }) {
  const actions = [];
  if (onClearSearch) {
    actions.push({ label: 'Clear search', variant: 'ghost', onClick: onClearSearch });
  }
  if (onClearFilters) {
    actions.push({ label: 'Clear all filters', variant: 'secondary', onClick: onClearFilters });
  }

  return state({
    variant: 'info',
    icon: 'search',
    title: 'No products match your filters',
    description: total
      ? `All ${total} products were filtered out. Removing a filter will bring some back.`
      : 'Try a different search term, or browse a category instead.',
    actions,
  });
}

/** A request failed. Always offers a retry. */
export function errorState({ error, onRetry, title = 'Something went wrong' }) {
  return state({
    variant: 'error',
    icon: 'alert-circle',
    title,
    description: describeError(error),
    actions: onRetry ? [{ label: 'Try again', variant: 'primary', onClick: onRetry }] : [],
  });
}

/** Saved items. Empty is the expected state for most people. */
export function emptyWishlistState() {
  return state({
    variant: 'empty',
    icon: 'heart',
    title: 'Nothing saved yet',
    description: 'Tap the heart on any product to keep it here for later.',
    actions: [{ label: 'Browse products', href: '/collection.html', variant: 'primary' }],
  });
}

/** The basket. */
export function emptyCartState() {
  return state({
    variant: 'empty',
    icon: 'cart',
    title: 'Your cart is empty',
    description: 'Nothing here yet. Anything you add will show up in this drawer.',
    actions: [{ label: 'Start shopping', href: '/collection.html', variant: 'primary' }],
    compact: true,
  });
}

/** A section that legitimately has nothing to show, like "Your saved items". */
export function quietEmptyState({ icon: iconName, title, description, href, label }) {
  return state({
    variant: 'info',
    icon: iconName,
    title,
    description,
    actions: href && label ? [{ label, href, variant: 'ghost' }] : [],
  });
}

/**
 * Turns an ApiError into something a shopper can act on. A raw status code or
 * a "NETWORK_ERROR" string is not an explanation.
 */
function describeError(error) {
  if (!error) return 'An unexpected problem stopped this from loading.';

  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'We could not reach the store. Check your connection, then try again.';
    case 'PRODUCT_NOT_FOUND':
      return 'That product is no longer available. It may have been removed.';
    case 'REQUEST_TIMEOUT':
      return 'That took too long. Check your connection, then try again.';
    case 'MOCK_FAILURE':
      return 'A test failure was injected on purpose. Remove it by clearing the fail flag.';
    default:
      return error.message ?? 'An unexpected problem stopped this from loading.';
  }
}

export default {
  state,
  noResultsState,
  errorState,
  emptyWishlistState,
  emptyCartState,
  quietEmptyState,
};