/**
 * Delivery service — the one authority on what delivery costs.
 *
 * Delivery rules are explicitly not finalised, so this module is a thin,
 * configurable policy rather than a hard-coded tariff:
 *
 *   - a flat `DEFAULT_FEE_MINOR`, waived once the subtotal reaches
 *     `FREE_THRESHOLD_MINOR`;
 *   - an ordered `ZONES` list a future per-area tariff can populate. A zone may
 *     narrow by lower-cased `city` and/or `area`, carry its own fee/ETA window,
 *     and mark itself unavailable; the first match wins, and an absent match
 *     falls through to the default zone.
 *
 * Everything is integer minor units. Nothing here reads the database or the
 * request, so the fee is deterministic and trivially unit-testable, and the
 * checkout transaction calls it while holding its locks.
 *
 * The result is a breakdown, not just a number, because the confirmation page
 * and the order snapshot both want to explain *why* a fee was charged or waived
 * and when the parcel is expected.
 */
import { DELIVERY, ERROR_CODES } from '../config/constants.js';
import { AppError } from '../utils/app-error.js';

const clampFee = (fee) =>
  Math.min(Math.max(0, Math.trunc(Number(fee) || 0)), DELIVERY.MAX_FEE_MINOR);

/** Keeps an ETA window sane and ordered: `0 <= min <= max <= MAX_ETA_DAYS`. */
function clampDays(value, fallback) {
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days)) return fallback;
  return Math.min(Math.max(0, days), DELIVERY.MAX_ETA_DAYS);
}

function toEta(zone) {
  const min = clampDays(zone.etaMinDays, DELIVERY.DEFAULT_ETA_MIN_DAYS);
  const max = Math.max(min, clampDays(zone.etaMaxDays, DELIVERY.DEFAULT_ETA_MAX_DAYS));
  return { etaMinDays: min, etaMaxDays: max };
}

/**
 * The zone a destination falls into.
 *
 * A zone with `city: null` matches any destination; that is how the fallback is
 * modelled rather than as a special case in the fee maths. Alongside the fee, a
 * zone carries its estimated-delivery window and whether the store can deliver
 * there at all — the two facts a shopper needs before paying.
 *
 * @param {{ city?: string|null, area?: string|null }} destination
 * @returns {{ name: string, city: string|null, area: string|null,
 *             feeMinor: number, freeThresholdMinor: number,
 *             etaMinDays: number, etaMaxDays: number, available: boolean }}
 */
export function resolveZone(destination = {}) {
  const city = normalise(destination.city);
  const area = normalise(destination.area);

  for (const zone of DELIVERY.ZONES) {
    const cityMatches = !zone.city || zone.city === city;
    const areaMatches = !zone.area || zone.area === area;
    if (cityMatches && areaMatches) {
      return {
        name: zone.name,
        city: zone.city ?? null,
        area: zone.area ?? null,
        feeMinor: clampFee(zone.feeMinor ?? DELIVERY.DEFAULT_FEE_MINOR),
        freeThresholdMinor: clampFee(zone.freeThresholdMinor ?? DELIVERY.FREE_THRESHOLD_MINOR),
        ...toEta(zone),
        available: zone.available !== false,
      };
    }
  }

  return {
    name: 'Standard',
    city: null,
    area: null,
    feeMinor: clampFee(DELIVERY.DEFAULT_FEE_MINOR),
    freeThresholdMinor: clampFee(DELIVERY.FREE_THRESHOLD_MINOR),
    etaMinDays: DELIVERY.DEFAULT_ETA_MIN_DAYS,
    etaMaxDays: DELIVERY.DEFAULT_ETA_MAX_DAYS,
    available: true,
  };
}

/** A human label for a zone's ETA window, e.g. `2–5 business days`. */
export function formatEta(zone) {
  const { etaMinDays, etaMaxDays } = zone;
  const unit = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (etaMinDays === etaMaxDays) return unit(etaMinDays);
  return `${etaMinDays}–${etaMaxDays} days`;
}

/**
 * The delivery promise for a destination: which zone, whether it is served, the
 * fee rule and the estimated window. This is the single object the storefront,
 * the checkout transaction and the order read model all derive from, so they
 * cannot advertise different ETAs.
 *
 * @param {{ city?: string|null, area?: string|null }} destination
 */
export function estimateDelivery(destination = {}) {
  const zone = resolveZone(destination);
  return {
    zone: zone.name,
    available: zone.available,
    feeMinor: zone.feeMinor,
    freeThresholdMinor: zone.freeThresholdMinor,
    etaMinDays: zone.etaMinDays,
    etaMaxDays: zone.etaMaxDays,
    etaLabel: formatEta(zone),
  };
}

/** Whether the store delivers to a destination at all. */
export function isServiceAvailable(destination = {}) {
  return resolveZone(destination).available;
}

/**
 * The delivery fee for a basket.
 *
 * Refuses a destination the store does not serve before any money is
 * computed — an unroutable order must never be priced, let alone placed.
 *
 * @param {{ subtotalMinor: number, city?: string|null, area?: string|null }} input
 * @returns {{ feeMinor: number, isFree: boolean, zone: string,
 *             freeThresholdMinor: number, remainingForFreeMinor: number,
 *             etaMinDays: number, etaMaxDays: number }}
 */
export function calculateDeliveryFee({ subtotalMinor, city = null, area = null } = {}) {
  const subtotal = Math.max(0, Math.trunc(Number(subtotalMinor) || 0));
  const zone = resolveZone({ city, area });

  if (!zone.available) {
    throw new AppError(
      `Delivery is not available to ${city ? `"${city}"` : 'this address'} yet.`,
      422,
      ERROR_CODES.DELIVERY_UNAVAILABLE,
      { zone: zone.name }
    );
  }

  const isFree = subtotal >= zone.freeThresholdMinor;
  const feeMinor = isFree ? 0 : zone.feeMinor;

  return {
    feeMinor,
    isFree,
    zone: zone.name,
    freeThresholdMinor: zone.freeThresholdMinor,
    remainingForFreeMinor: Math.max(0, zone.freeThresholdMinor - subtotal),
    etaMinDays: zone.etaMinDays,
    etaMaxDays: zone.etaMaxDays,
  };
}

/**
 * The delivery options the storefront can display. Kept here so the checkout
 * form and the order service cannot advertise different rules.
 */
export function getDeliveryOptions() {
  return {
    currency: 'ETB',
    defaultFeeMinor: clampFee(DELIVERY.DEFAULT_FEE_MINOR),
    freeThresholdMinor: clampFee(DELIVERY.FREE_THRESHOLD_MINOR),
    defaultEta: {
      minDays: DELIVERY.DEFAULT_ETA_MIN_DAYS,
      maxDays: DELIVERY.DEFAULT_ETA_MAX_DAYS,
      label: formatEta({
        etaMinDays: DELIVERY.DEFAULT_ETA_MIN_DAYS,
        etaMaxDays: DELIVERY.DEFAULT_ETA_MAX_DAYS,
      }),
    },
    zones: DELIVERY.ZONES.map((zone) => {
      const eta = toEta(zone);
      return {
        name: zone.name,
        city: zone.city ?? null,
        area: zone.area ?? null,
        feeMinor: clampFee(zone.feeMinor ?? DELIVERY.DEFAULT_FEE_MINOR),
        freeThresholdMinor: clampFee(zone.freeThresholdMinor ?? DELIVERY.FREE_THRESHOLD_MINOR),
        available: zone.available !== false,
        ...eta,
        etaLabel: formatEta(eta),
      };
    }),
  };
}

function normalise(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text === '' ? null : text;
}

/** Guards a fee the database would reject, with a message instead of a 422. */
export function assertValidFee(feeMinor) {
  if (!Number.isInteger(feeMinor) || feeMinor < 0 || feeMinor > DELIVERY.MAX_FEE_MINOR) {
    throw new AppError('The delivery fee could not be calculated.', 500, 'INTERNAL_SERVER_ERROR');
  }
  return feeMinor;
}

export default {
  resolveZone,
  calculateDeliveryFee,
  estimateDelivery,
  isServiceAvailable,
  formatEta,
  getDeliveryOptions,
  assertValidFee,
};
