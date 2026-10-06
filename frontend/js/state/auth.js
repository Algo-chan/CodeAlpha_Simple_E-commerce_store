/**
 * Authentication state.
 *
 * One small store wrapping the three `/auth` calls that matter to the
 * storefront: `me` (who am I), login/register (become someone) and logout
 * (stop being that person). Account management - profile, addresses, password -
 * is called directly through the API client from the account page, because
 * that page never needs to broadcast anything.
 *
 * The persisted slice is deliberately just `{ user }`. Re-hydrating a name and
 * email from the last session lets the header label the account action the
 * instant the page paints; `refresh()` then re-validates the session against
 * the server. A session that expired on the server shelves the cached user,
 * and a cached user is never trusted past that first re-check - this store
 * holds an identity, not a credential.
 */
import { api } from '../core/api.js';
import { createStore } from './store.js';

export const AUTH_STORAGE_VERSION = 1;

export const AUTH_STATUS = Object.freeze({
  /** Session not yet verified against the server. */
  UNKNOWN: 'unknown',
  /** The user has a valid session. */
  AUTHENTICATED: 'authenticated',
  /** No session, and one was checked for. */
  GUEST: 'guest',
  /** Session check failed for a reason other than "not signed in". */
  FAILURE: 'failure',
});

const initialState = {
  status: AUTH_STATUS.UNKNOWN,
  user: null,
  error: null,
};

/**
 * @param {{ client?: object, onSessionChange?: (user: object|null, reason: string) => void }} [deps]
 * @returns {import('./store.js').StoreApi & {
 *   refresh(): Promise<object|null>,
 *   signIn(credentials): Promise<object>,
 *   register(payload): Promise<object>,
 *   signOut(): Promise<void>,
 *   updateProfile(fields): Promise<object|null>,
 *   selectStatus(): string,
 *   selectUser(): object|null,
 *   selectIsAuthenticated(): boolean,
 *   selectIsGuest(): boolean,
 * }}
 */
export function createAuthStore({ client = api, onSessionChange = () => {} } = {}) {
  const store = createStore(initialState, {
    name: 'auth',
    persist: {
      key: 'auth',
      version: AUTH_STORAGE_VERSION,
      select: ({ user }) => ({ user }),
    },
  });

  /**
   * Re-validates the session against the server.
   *
   * A 401 means "no session" and is the *expected* answer for most visitors;
   * it must not surface as a failure. Anything else - the API being down,
   * a timeout - is a real fault, and the status records it so the account
   * page can say "we could not reach the store" instead of "sign in please"
   * when there may already be a valid session.
   *
   * @returns {Promise<object|null>} the user, or null when unauthenticated
   */
  async function refresh() {
    try {
      const data = await client.get('/auth/me');
      const user = data?.user ?? null;
      store.setState({
        status: user ? AUTH_STATUS.AUTHENTICATED : AUTH_STATUS.GUEST,
        user,
        error: null,
      });
      // A session found at boot is a homecoming, not a fresh sign-in, but the
      // app still needs to know so a basket left pending by an earlier
      // transition can be settled.
      if (user) onSessionChange(user, 'restore');
      return user;
    } catch (error) {
      if (error?.status === 401) {
        store.setState({ status: AUTH_STATUS.GUEST, user: null, error: null });
        return null;
      }
      store.setState({ status: AUTH_STATUS.FAILURE, user: null, error });
      return null;
    }
  }

  async function signIn(credentials) {
    const data = await client.post('/auth/login', credentials);
    const user = data?.user ?? null;
    store.setState({ status: AUTH_STATUS.AUTHENTICATED, user, error: null });
    onSessionChange(user, 'login');
    return user;
  }

  async function register(payload) {
    const data = await client.post('/auth/register', payload);
    const user = data?.user ?? null;
    store.setState({ status: AUTH_STATUS.AUTHENTICATED, user, error: null });
    onSessionChange(user, 'register');
    return user;
  }

  async function signOut() {
    // A failed logout must not keep the shopper signed in. The server session
    // expiry will catch the case where the DELETE did not land; clearing
    // locally is still correct.
    try {
      await client.post('/auth/logout');
    } catch {
      /* clear anyway - see above */
    }
    store.setState({ status: AUTH_STATUS.GUEST, user: null, error: null });
    onSessionChange(null, 'logout');
  }

  /**
   * Updates the current user's profile fields.
   * @param {object} fields
   * @returns {Promise<object|null>} the updated user
   */
  async function updateProfile(fields) {
    const data = await client.patch('/auth/profile', fields);
    const user = data?.user ?? null;
    if (user) store.setState({ user });
    return user;
  }

  const selectStatus = store.select(({ status }) => status);
  const selectUser = store.select(({ user }) => user);
  const selectIsAuthenticated = store.select(({ status }) => status === AUTH_STATUS.AUTHENTICATED);
  const selectIsGuest = store.select(
    ({ status }) => status === AUTH_STATUS.GUEST || status === AUTH_STATUS.UNKNOWN
  );

  return {
    ...store,
    refresh,
    signIn,
    register,
    signOut,
    updateProfile,
    selectStatus,
    selectUser,
    selectIsAuthenticated,
    selectIsGuest,
  };
}

export default { createAuthStore, AUTH_STATUS, AUTH_STORAGE_VERSION };
