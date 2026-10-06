/**
 * The auth store.
 *
 * The store is a thin wrapper around three network calls, so most of what needs
 * pinning is the decision-making around a 401: a "no session" answer is the
 * expected one for most visitors and must not surface as a failure, while a
 * down API must. The `onSessionChange` hook is what the app hangs its guest
 * basket transition on, so the reasons it fires are pinned too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthStore, AUTH_STATUS } from '../js/state/auth.js';
import { ApiError } from '../js/core/api.js';

const USER = { id: 7, name: 'Hanna Bekele', email: 'hanna@example.com', phone: '+251911000000' };

/** A call-recording stand-in for the API client. Network never happens. */
function fakeClient(overrides = {}) {
  const calls = { get: [], post: [], patch: [] };

  return {
    calls,
    async get(path) {
      calls.get.push(path);
      if (overrides.get) return overrides.get(path);
      return { user: null };
    },
    async post(path, body) {
      calls.post.push([path, body]);
      if (overrides.post) return overrides.post(path, body);
      return { user: USER };
    },
    async patch(path, body) {
      calls.patch.push([path, body]);
      if (overrides.patch) return overrides.patch(path, body);
      return { user: USER };
    },
  };
}

function noSession() {
  return { get: () => Promise.reject(new ApiError('No session', { status: 401 })) };
}

function downApi() {
  return { get: () => Promise.reject(new ApiError('Connection refused', { status: 0 })) };
}

test('refresh treats a 401 as the expected "no session" guest state', async () => {
  const client = fakeClient(noSession());
  let hookCalls = 0;

  const auth = createAuthStore({
    client,
    onSessionChange: () => {
      hookCalls += 1;
    },
  });
  const user = await auth.refresh();

  assert.equal(user, null);
  assert.equal(auth.selectStatus(), AUTH_STATUS.GUEST);
  assert.equal(auth.selectUser(), null);
  assert.equal(auth.selectIsGuest(), true);
  assert.equal(hookCalls, 0, 'being a guest is not an event worth broadcasting');
});

test('refresh promotes a found session to authenticated and announces "restore"', async () => {
  const client = fakeClient({ get: () => Promise.resolve({ user: USER }) });
  const reasons = [];

  const auth = createAuthStore({
    client,
    onSessionChange: (user, reason) => reasons.push([user, reason]),
  });
  const user = await auth.refresh();

  assert.equal(user, USER);
  assert.equal(auth.selectStatus(), AUTH_STATUS.AUTHENTICATED);
  assert.equal(auth.selectIsAuthenticated(), true);
  assert.deepEqual(reasons, [[USER, 'restore']]);
});

test('refresh records a real failure distinctly from a 401', async () => {
  const client = fakeClient(downApi());

  const auth = createAuthStore({ client });
  const user = await auth.refresh();

  assert.equal(user, null);
  assert.equal(auth.selectStatus(), AUTH_STATUS.FAILURE);
  assert.equal(auth.selectIsAuthenticated(), false);
  assert.equal(auth.selectIsGuest(), false, 'a down API must not be labelled "guest"');
});

test('signIn posts to /auth/login and announces "login"', async () => {
  const client = fakeClient();
  const reasons = [];

  const auth = createAuthStore({
    client,
    onSessionChange: (user, reason) => reasons.push([user, reason]),
  });
  const user = await auth.signIn({ email: 'hanna@example.com', password: 'correct horse' });

  assert.deepEqual(client.calls.post[0], [
    '/auth/login',
    { email: 'hanna@example.com', password: 'correct horse' },
  ]);
  assert.equal(user, USER);
  assert.equal(auth.selectStatus(), AUTH_STATUS.AUTHENTICATED);
  assert.deepEqual(reasons, [[USER, 'login']]);
});

test('register posts to /auth/register and announces "register"', async () => {
  const client = fakeClient();
  let reason = null;

  const auth = createAuthStore({
    client,
    onSessionChange: (user, r) => {
      reason = r;
    },
  });
  await auth.register({ name: 'Hanna Bekele', email: 'hanna@example.com' });

  assert.equal(client.calls.post[0][0], '/auth/register');
  assert.equal(reason, 'register');
});

test('signOut revokes then clears, even when the request fails', async () => {
  const client = fakeClient({
    post: (path) => {
      if (path === '/auth/logout')
        return Promise.reject(new ApiError('Network down', { status: 0 }));
      return Promise.resolve({ user: USER });
    },
  });
  let reason = null;

  const auth = createAuthStore({
    client,
    onSessionChange: (user, r) => {
      reason = r;
    },
  });
  await auth.signIn({ email: 'hanna@example.com', password: 'x' });
  await auth.signOut();

  assert.equal(client.calls.post.at(-1)[0], '/auth/logout');
  assert.equal(auth.selectStatus(), AUTH_STATUS.GUEST);
  assert.equal(auth.selectUser(), null, 'a failed logout must not keep the shopper signed in');
  assert.equal(reason, 'logout');
});

test('updateProfile PATCHes the new fields onto the live user', async () => {
  const updated = { ...USER, phone: '+251922000000' };
  const client = fakeClient({ patch: () => Promise.resolve({ user: updated }) });

  const auth = createAuthStore({ client });
  await auth.signIn({ email: 'hanna@example.com', password: 'x' });
  const user = await auth.updateProfile({ phone: '+251922000000' });

  assert.deepEqual(client.calls.patch[0], ['/auth/profile', { phone: '+251922000000' }]);
  assert.equal(user.phone, '+251922000000');
  assert.equal(auth.selectUser().phone, '+251922000000');
});

test('the last known user is persisted and survives a new store', async () => {
  const written = new Map();
  globalThis.localStorage = {
    getItem: (key) => written.get(key) ?? null,
    setItem: (key, value) => written.set(key, value),
    removeItem: (key) => written.delete(key),
  };

  try {
    const client = fakeClient();
    await createAuthStore({ client }).signIn({ email: 'hanna@example.com', password: 'x' });
    assert.equal(written.has('aie:auth'), true, 'the user slice is written to storage');

    const restored = createAuthStore({ client });
    assert.equal(
      restored.selectUser().email,
      USER.email,
      'the eager header label comes from storage'
    );

    // ...but the cached identity is only a label until refresh() re-validates it.
    const expired = createAuthStore({ client: fakeClient(noSession()) });
    await expired.refresh();
    assert.equal(
      expired.selectStatus(),
      AUTH_STATUS.GUEST,
      'an expired session shelves the cached user'
    );
  } finally {
    delete globalThis.localStorage;
  }
});
