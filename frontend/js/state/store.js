/**
 * The store.
 *
 * A deliberately small observable store - roughly 90 lines doing the job Redux
 * does in thousands. It exists so that "add to cart" updates the header badge,
 * the cart drawer and any open product card without any of them knowing about
 * each other.
 *
 * Rules that keep this predictable:
 *   1. State is replaced, never mutated. Every update produces a new object,
 *      so `prev !== next` is always true for subscribers.
 *   2. Notifications are batched into a microtask. Three subscribers calling
 *      `setState` synchronously in one tick cause exactly one render pass.
 *   3. A subscriber that throws is logged and skipped. One broken card cannot
 *      take down the cart badge.
 *   4. Selectors are plain functions of state, memoised on a reference check,
 *      so a component can skip work when its slice has not changed.
 */

/**
 * Notification scheduler shared by every store.
 *
 * A microtask rather than a synchronous call: three subscribers updating state
 * during one event handler should cause one render pass, not three. The set
 * holds `{ notify }` handles rather than store objects, because the flush
 * function closes over the subscribers it needs to walk.
 */
const pending = new Set();
let flushQueued = false;

function scheduleNotify(handle) {
  pending.add(handle);
  if (flushQueued) return;
  flushQueued = true;

  queueMicrotask(() => {
    flushQueued = false;
    const handles = Array.from(pending);
    pending.clear();
    for (const item of handles) {
      try {
        item.notify();
      } catch (error) {
        console.error('[store] flush failed', error);
      }
    }
  });
}

/**
 * @template T
 * @param {T} initialState
 * @param {{ name?: string, persist?: { key: string, version?: number,
 *           select?: (state: T) => unknown } | null }} [options]
 */
export function createStore(initialState, options = {}) {
  const { name = 'store', persist = null } = options;

  let state = initialState;

  /** @type {Set<{ listener: Function, selector: Function|null, last: unknown }>} */
  const subscribers = new Set();

  /** Restored state, merged over the initial state so new keys always exist. */
  if (persist) {
    const restored = readPersisted(persist.key, persist.version ?? 1);
    if (restored) {
      state = typeof persist.select === 'function' ? persist.select(restored) : restored;
      state = { ...initialState, ...state };
    }
  }

  /**
   * @param {Partial<T> | ((prev: T) => Partial<T>)} patch
   */
  function setState(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return state;
    const merged = { ...state, ...next };
    if (shallowEqual(merged, state)) return state;

    state = merged;
    if (persist) writePersisted(persist.key, persist.version ?? 1, state);
    scheduleNotify({ notify });
    return state;
  }

  function getState() {
    return state;
  }

  /**
   * Subscribes to the whole store, or to a slice when a selector is given.
   *
   * @param {(state: T, previous: T) => void} listener
   * @param {{ selector?: (state: T) => unknown, immediate?: boolean }} [options]
   * @returns {() => void} unsubscribe
   */
  function subscribe(listener, { selector, immediate = false } = {}) {
    const entry = {
      listener,
      selector: selector ?? null,
      last: selector ? selector(state) : null,
    };
    subscribers.add(entry);

    if (immediate) listener(state, state);

    return () => subscribers.delete(entry);
  }

  /** Derives a value, recomputing only when the underlying slice changes. */
  function select(selector) {
    let lastInput = state;
    let lastOutput = selector(state);
    return () => {
      if (state === lastInput) return lastOutput;
      lastInput = state;
      lastOutput = selector(state);
      return lastOutput;
    };
  }

  function notify() {
    for (const entry of subscribers) {
      try {
        if (entry.selector) {
          const next = entry.selector(state);
          if (Object.is(next, entry.last)) continue;
          const previous = entry.last;
          entry.last = next;
          entry.listener(state, previous);
        } else {
          entry.listener(state, state);
        }
      } catch (error) {
        // One broken subscriber must not stop the rest from updating, and must
        // not lose the others' changes.
        console.error(`[${name}] subscriber failed`, error);
      }
    }
  }

  return { getState, setState, subscribe, select, name };
}

/** Reference equality per key. Good enough: state here is flat and shallow. */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) => Object.is(a[key], b[key]));
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const NAMESPACE = 'aie';

/**
 * Storage can throw: Safari private mode, disabled cookies, quota. Persistence
 * is an enhancement, never a requirement, so every access is guarded.
 */
function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {number} version
 * @returns {object|null}
 */
export function readPersisted(key, version = 1) {
  const store = storage();
  if (!store) return null;

  try {
    const rawValue = store.getItem(`${NAMESPACE}:${key}`);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    // A version bump invalidates old payloads instead of trying to migrate
    // them, which keeps the shape honest as the storefront evolves.
    if (parsed?.__v !== version) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

/** @param {string} key @param {number} version @param {unknown} data */
export function writePersisted(key, version, data) {
  const store = storage();
  if (!store) return false;

  try {
    store.setItem(`${NAMESPACE}:${key}`, JSON.stringify({ __v: version, data }));
    return true;
  } catch {
    // Most likely QuotaExceededError. Drop the key so the next write can work.
    try {
      store.removeItem(`${NAMESPACE}:${key}`);
    } catch {
      /* nothing further to try */
    }
    return false;
  }
}

/** @param {string} key */
export function clearPersisted(key) {
  const store = storage();
  try {
    store?.removeItem(`${NAMESPACE}:${key}`);
  } catch {
    /* ignore */
  }
}

export default { createStore, shallowEqual, readPersisted, writePersisted, clearPersisted };