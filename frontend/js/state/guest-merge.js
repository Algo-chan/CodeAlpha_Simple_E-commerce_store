/**
 * Guest-to-customer basket transition.
 *
 * A visitor shops while signed out; the cart and wishlist live in
 * localStorage. When they sign in the transition has to answer one question
 * before anything else: what happens to the basket they built as a guest?
 *
 * The answer this module enforces is: nothing, and indelibly. The guest basket
 * is snapshotted into a one-time "pending sync" record at the moment of
 * sign-in. A signed-in cart API does not exist yet (Phase 7), so "syncing"
 * today means keeping the local cart and standing down the record; when the
 * server cart arrives, the same snapshot feeds the real upload instead, and
 * nothing on the sign-in page changes.
 *
 * The snapshot is captured *before* the session swap, not after - a transition
 * that reads the basket too late would document exactly what it already
 * destroyed. `snapshotGuestState` is called by the app's session-change
 * handler at sign-in, and `finalizeGuestTransition` by the next boot.
 */
import { readPersisted, writePersisted, clearPersisted } from './store.js';

export const GUEST_SYNC_KEY = 'guest-sync';
export const GUEST_SYNC_VERSION = 1;

/**
 * Records the guest basket so the pending-sync survives navigation. Idempotent:
 * the first snapshot wins, so a second sign-in cannot overwrite a basket that
 * was never accounted for.
 *
 * @param {{ lines: Array<object>, productIds: string[] }} basket
 * @returns {boolean} true when a snapshot was written
 */
export function snapshotGuestState({ lines = [], productIds = [] } = {}) {
  if (hasPendingGuestSync()) return false;
  return writePersisted(GUEST_SYNC_KEY, GUEST_SYNC_VERSION, {
    at: new Date().toISOString(),
    lines,
    productIds,
  });
}

/**
 * @returns {object|null} the pending snapshot, or null when there is none
 */
export function pendingGuestSync() {
  return readPersisted(GUEST_SYNC_KEY, GUEST_SYNC_VERSION) ?? null;
}

export function hasPendingGuestSync() {
  return pendingGuestSync() !== null;
}

export function clearGuestSync() {
  clearPersisted(GUEST_SYNC_KEY);
}

/**
 * Applies a pending snapshot to the live baskets and stands the record down.
 *
 * A snapshot is only applied where it is needed. If the shopper already has
 * lines in the cart (the usual case - the local basket survives sign-in), they
 * win and the snapshot is dropped unmerged. If the basket is empty, the
 * snapshot is restored so the transition never reads as a data loss.
 *
 * @param {{ cart: object, wishlist: object }} stores
 * @returns {{ cleared: boolean, restoredLines: number, restoredSaved: number }}
 */
export function finalizeGuestTransition({ cart, wishlist } = {}) {
  const snapshot = pendingGuestSync();
  if (!snapshot) return { cleared: false, restoredLines: 0, restoredSaved: 0 };

  let restoredLines = 0;
  let restoredSaved = 0;

  if (cart && snapshot.lines?.length > 0 && cart.selectLines().length === 0) {
    for (const line of snapshot.lines) {
      if (cart.restoreLine(line).ok) restoredLines += 1;
    }
  }

  if (wishlist && snapshot.productIds?.length > 0 && wishlist.getState().productIds.length === 0) {
    for (const productId of snapshot.productIds) {
      if (wishlist.add(productId)) restoredSaved += 1;
    }
  }

  clearGuestSync();
  return { cleared: true, restoredLines, restoredSaved };
}

export default {
  snapshotGuestState,
  pendingGuestSync,
  hasPendingGuestSync,
  clearGuestSync,
  finalizeGuestTransition,
  GUEST_SYNC_KEY,
  GUEST_SYNC_VERSION,
};
