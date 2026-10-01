/**
 * _reference_time.js — the demo's "present moment".
 *
 * The seeded store tells a story spread over a few days in January 2026, and
 * the order numbers encode those dates (ORD-20260115-0001, ORD-20260120-0002,
 * ORD-20260122-0003). If each seed file called NOW(), every column would move
 * on every run, so two databases seeded from the same commit would not match
 * and `npm run seed` would look like it mutated the data.
 *
 * Everything time-shaped in the seeds is therefore expressed as an offset from
 * SEED_NOW, and the resulting timestamps are passed as bound parameters rather
 * than inlined as SQL, so nothing depends on the session clock.
 *
 * This file is named without the `.seed.js` suffix on purpose: the runner only
 * executes `*.seed.js`.
 */

/** 2026-01-23T09:00:00Z — after the last seeded order. */
export const SEED_NOW = '2026-01-23T09:00:00+00:00';

/**
 * Build an ISO timestamp `days` before SEED_NOW.
 *
 * @param {number} days Whole days to subtract.
 * @param {number} [hours = 0] Extra hours to subtract, on top of the days.
 * @returns {string} An ISO 8601 timestamp that `pg` sends as `timestamptz`.
 */
export function daysBeforeNow(days, hours = 0) {
  const base = new Date(SEED_NOW).getTime();
  return new Date(base - (days * 24 + hours) * 60 * 60 * 1000).toISOString();
}

/**
 * Build an ISO timestamp `days` after SEED_NOW, used for forward-looking
 * columns such as cart expiry.
 *
 * @param {number} days Whole days to add.
 * @returns {string} An ISO 8601 timestamp that `pg` sends as `timestamptz`.
 */
export function daysAfterNow(days) {
  return daysBeforeNow(-days);
}
