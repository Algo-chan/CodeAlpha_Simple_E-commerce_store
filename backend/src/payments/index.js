/**
 * Payment provider registry.
 *
 * The payment service resolves providers by name through this module rather
 * than importing a concrete adapter. That is the seam a real gateway plugs
 * into: register the adapter here, name it in `PAYMENT_PROVIDER`, and nothing
 * else changes.
 *
 * Lookups are case-insensitive because provider names arrive from two places
 * with different conventions: `env.PAYMENT_PROVIDER` (upper-case constants) and
 * a webhook URL path parameter (any case a gateway chooses).
 */
import env from '../config/env.js';
import { PAYMENT_PROVIDER } from '../config/constants.js';
import { codProvider } from './cod.provider.js';
import { mockProvider } from './mock.provider.js';

const REGISTRY = new Map(
  [codProvider, mockProvider].map((provider) => [provider.name, Object.freeze(provider)])
);

/**
 * @param {string} name
 * @returns {object|null} the adapter, or null when the name is unknown
 */
export function getProvider(name) {
  if (!name) return null;
  return REGISTRY.get(String(name).trim().toUpperCase()) ?? null;
}

/**
 * The provider configured to handle ONLINE payments for this deployment.
 * `PAYMENT_PROVIDER=NONE`, an unknown name, or a provider that cannot go online
 * all resolve to null, which the payment service treats as "online is off".
 *
 * @returns {object|null}
 */
export function getActiveOnlineProvider() {
  const configured = String(env.PAYMENT_PROVIDER ?? '')
    .trim()
    .toUpperCase();
  if (!configured || configured === 'NONE') return null;

  const provider = REGISTRY.get(configured) ?? null;
  return provider?.supportsOnline ? provider : null;
}

/** Capability summary safe to expose to a client (no secrets). */
export function listProviders() {
  return [...REGISTRY.values()].map((provider) => ({
    name: provider.name,
    supportsOnline: Boolean(provider.supportsOnline),
    supportsRefunds: Boolean(provider.supportsRefunds),
  }));
}

/** The provider written on a COD payment row (the store itself). */
export const COD_PROVIDER_NAME = PAYMENT_PROVIDER.INTERNAL;

export default { getProvider, getActiveOnlineProvider, listProviders, COD_PROVIDER_NAME };
