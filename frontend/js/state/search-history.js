/**
 * Recent searches.
 *
 * A shopper who searched "leather" and then wandered off has almost certainly
 * come back for "leather" next time, which makes it the one piece of search
 * state worth keeping between visits. The overlay showed a fixed suggestion list
 * instead, so every visit started from the same five terms regardless of what
 * this particular shopper was looking for.
 *
 * Deliberate constraints:
 *
 *   - TEXT QUERIES ONLY. A product or category click is not a search; recording
 *     those would pad the list with names that are not really queries.
 *   - CASE-INSENSITIVELY DEDUPLICATED. "Leather" twice means one entry, moved to
 *     the top, not two rows.
 *   - STORED LOCALLY AND VERSIONED. Handing a shopper's search history to a
 *     server would be data they never asked us to keep. `readPersisted` bumps
 *     invalidate rather than migrate, so a shape change drops old terms instead
 *     of half-reading them.
 *   - SHORT BY DEFAULT. Six terms is enough to be useful and short enough to
 *     leave room for the suggestion list underneath.
 */
import { createStore } from './store.js';

/** Terms kept, newest first. */
const MAX_TERMS = 6;

/** Below this, a "search" is a typo rather than an intent. */
const MIN_TERM_LENGTH = 2;

/**
 * @param {{ limit?: number }} [options]
 */
export function createSearchHistory({ limit = MAX_TERMS } = {}) {
  const store = createStore(
    { terms: [] },
    {
      name: 'search-history',
      persist: {
        key: 'search-history',
        version: 1,
        // Only the terms are persisted. Projecting on the way out as well as in
        // keeps anything added to this state later from silently reaching
        // storage by default.
        select: ({ terms }) => ({ terms }),
      },
    }
  );

  const selectTerms = store.select(({ terms }) => terms);

  /**
   * Moves a term to the front, or inserts it if new.
   * @param {string} value
   * @returns {string[]} the terms after the change
   */
  function record(value) {
    const term = String(value ?? '').trim();
    if (term.length < MIN_TERM_LENGTH) return selectTerms();

    store.setState(({ terms }) => {
      const withoutDuplicate = terms.filter(
        (existing) => existing.toLowerCase() !== term.toLowerCase()
      );
      return { terms: [term, ...withoutDuplicate].slice(0, limit) };
    });

    return selectTerms();
  }

  /**
   * Drops one term. Used by the per-row remove control, so a shopper can forget
   * one search without losing the rest.
   * @param {string} value
   */
  function forget(value) {
    const term = String(value ?? '').toLowerCase();
    store.setState(({ terms }) => ({
      terms: terms.filter((existing) => existing.toLowerCase() !== term),
    }));
  }

  /** Forgets everything. Wired to a single "Clear" control in the idle state. */
  function clear() {
    store.setState({ terms: [] });
  }

  return {
    record,
    forget,
    clear,
    selectTerms,
    subscribe: store.subscribe,
    getState: store.getState,
  };
}

export default { createSearchHistory };
