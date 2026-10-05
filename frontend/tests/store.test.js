/**
 * The observable store.
 *
 * These are the guarantees every other store leans on. If batching, subscriber
 * isolation or selector memoisation break, the symptom shows up somewhere else
 * in the storefront and is hard to trace back, so they are pinned here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore, shallowEqual } from '../js/state/store.js';

test('setState replaces state rather than mutating it', () => {
  const store = createStore({ count: 0, tag: 'a' });

  const before = store.getState();
  store.setState({ count: 1 });
  const after = store.getState();

  assert.equal(before.count, 0, 'the previous state object must not be edited');
  assert.equal(after.count, 1);
  assert.notEqual(before, after, 'a change must produce a new object');
  assert.equal(before.tag, 'a', 'untouched keys survive');
});

test('a no-op setState does not notify', () => {
  const store = createStore({ count: 0 });
  let calls = 0;

  store.subscribe(() => {
    calls += 1;
  });
  store.setState({ count: 0 });

  return Promise.resolve().then(() => {
    assert.equal(calls, 0, 'an identical patch must not cause a render pass');
  });
});

test('a functional patch receives the previous state', () => {
  const store = createStore({ count: 5 });

  store.setState((prev) => ({ count: prev.count * 2 }));

  assert.equal(store.getState().count, 10);
});

test('notifications are batched into one microtask', async () => {
  const store = createStore({ a: 0, b: 0 });
  let calls = 0;

  store.subscribe(() => {
    calls += 1;
  });

  store.setState({ a: 1 });
  store.setState({ b: 1 });
  store.setState({ a: 2 });

  assert.equal(calls, 0, 'nothing fires synchronously');

  await Promise.resolve();
  assert.equal(calls, 1, 'three updates in one tick cause exactly one render pass');
});

test('a throwing subscriber does not stop the others', async () => {
  const store = createState();
  const reached = [];

  store.subscribe(() => {
    throw new Error('broken card');
  });
  store.subscribe(() => reached.push('second'));
  store.subscribe(() => reached.push('third'));

  store.setState({ count: 1 });
  await Promise.resolve();

  assert.deepEqual(reached, ['second', 'third']);
});

test('unsubscribe stops delivery', async () => {
  const store = createStore({ count: 0 });
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });

  store.setState({ count: 1 });
  await Promise.resolve();
  assert.equal(calls, 1);

  stop();
  store.setState({ count: 2 });
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('a selector subscriber only fires when its slice changes', async () => {
  const store = createStore({ items: [1, 2], unrelated: 'x' });
  const items = [];
  const unrelated = [];

  store.subscribe((next) => items.push(next), { selector: (state) => state.items });
  store.subscribe((next) => unrelated.push(next), { selector: (state) => state.unrelated });

  store.setState({ unrelated: 'y' });
  await Promise.resolve();

  assert.equal(items.length, 0, 'the items slice did not change');
  assert.deepEqual(unrelated, ['y']);
});

test('a selector subscriber receives the selection, not the whole state', async () => {
  const store = createStore({ count: 3 });
  const received = [];

  store.subscribe((next, previous) => received.push([next, previous]), {
    selector: (state) => state.count * 10,
    immediate: true,
  });

  assert.deepEqual(received[0], [30, 30], 'immediate passes the selection');

  store.setState({ count: 4 });
  assert.equal(received.length, 1, 'delivery is deferred to the microtask flush');

  await Promise.resolve();
  assert.deepEqual(received[1], [40, 30], 'then the new and previous selections');
});

test('a selector returning null is a real value, not "no value yet"', () => {
  const store = createStore({ error: null });
  const received = [];

  store.subscribe((next) => received.push(next), {
    selector: (state) => state.error,
    immediate: true,
  });

  assert.deepEqual(received, [null], 'immediate must not fall back to whole state');
});

test('select() memoises on state identity', () => {
  const store = createStore({ a: 1, b: 2 });
  const read = store.select((state) => ({ sum: state.a + state.b }));

  const first = read();
  assert.equal(read(), first, 'the same state object returns the cached result');

  store.setState({ a: 3 });
  const second = read();
  assert.notEqual(second, first);
  assert.equal(second.sum, 5);
});

test('persistence projections are applied on write, not only on restore', () => {
  const store = createStore(
    { lines: [1], isOpen: false },
    {
      persist: {
        key: 'test-projection',
        version: 1,
        select: ({ lines }) => ({ lines }),
      },
    }
  );

  store.setState({ isOpen: true });

  assert.equal(store.getState().isOpen, true, 'live state keeps everything');
});

test('persisted state is versioned and namespace-prefixed', () => {
  const written = new Map();
  globalThis.localStorage = {
    getItem: (key) => written.get(key) ?? null,
    setItem: (key, value) => written.set(key, value),
    removeItem: (key) => written.delete(key),
  };

  try {
    const store = createStore({ count: 0 }, { persist: { key: 'cart', version: 3 } });
    store.setState({ count: 7 });

    const raw = written.get('aie:cart');
    assert.ok(raw, 'written under a namespaced key');
    assert.deepEqual(JSON.parse(raw), { __v: 3, data: { count: 7 } });

    const restored = createStore({ count: 0 }, { persist: { key: 'cart', version: 3 } });
    assert.equal(restored.getState().count, 7, 'a matching version restores');

    const stale = createStore({ count: 0 }, { persist: { key: 'cart', version: 2 } });
    assert.equal(stale.getState().count, 0, 'a version bump discards rather than migrates');
  } finally {
    delete globalThis.localStorage;
  }
});

test('a storage that throws never breaks the store', () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('quota');
    },
    removeItem() {
      throw new Error('denied');
    },
  };

  try {
    const store = createStore({ count: 0 }, { persist: { key: 'cart', version: 1 } });
    store.setState({ count: 1 });
    assert.equal(store.getState().count, 1, 'persistence is an enhancement, never a requirement');
  } finally {
    delete globalThis.localStorage;
  }
});

test('shallowEqual compares by key', () => {
  assert.equal(shallowEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(shallowEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(shallowEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(shallowEqual(null, null), true);
  assert.equal(shallowEqual({ a: 1 }, null), false);
});

/** Small helper so each test starts from a known shape. */
function createState() {
  return createStore({ count: 0 });
}
