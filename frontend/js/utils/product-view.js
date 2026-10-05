/**
 * Product view vocabulary and variant selection.
 *
 * These live outside `mock/` on purpose. They are not mock data — they are the
 * rules that turn a product view model into UI decisions, and the real API client
 * produces the same view model. A component importing from `mock/` is a component
 * wired to fixtures, which is exactly what Phase 6 removes.
 *
 * `mock/view.js` builds view models from fixtures and imports from here; every
 * component imports from here. Nothing here imports from `mock/`, so there is no
 * cycle and the dependency points one way: mock data in, these rules out.
 */

/**
 * Below this, a product is badged "Low stock" rather than merely "In stock".
 *
 * A threshold rather than a boolean because "Low stock" only means something
 * relative to a number, and the number belongs to the shop, not to the component.
 */
export const LOW_STOCK_THRESHOLD = 5;

/* -------------------------------------------------------------------------- */
/* Badges                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Badge vocabulary.
 *
 * Keys come from the server; this maps them to wording, and adds the `new` and
 * `featured` keys the fixture catalogue derives from product flags.
 *
 * `sale-<percent>` is deliberately not listed: the percentage comes from the
 * discount calculation, so a static map cannot enumerate it. `badgeLabel` handles
 * the family by pattern.
 */
export const BADGE_LABELS = Object.freeze({
  digital: 'Instant download',
  'sold-out': 'Sold out',
  unavailable: 'Not available',
  'low-stock': 'Low stock',
  new: 'New',
  featured: 'Featured',
});

/**
 * Human text for a badge key, or null when the badge is unknown.
 *
 * Returns null rather than echoing the key: an unrecognised badge means the server
 * sent something this UI has no wording for, and printing `some-new-badge` into
 * the page is worse than showing nothing. The key is data, not a sentence.
 *
 * @param {string} badge
 * @returns {string|null}
 */
export function badgeLabel(badge) {
  if (badge === null || badge === undefined) return null;

  const saleMatch = /^sale-(\d+)$/.exec(String(badge));
  if (saleMatch) return `${saleMatch[1]}% off`;

  return BADGE_LABELS[badge] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Variant selection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The variant matching a partial selection, or null when none does.
 *
 * Partial matching matters: while a shopper has chosen "Black" but not yet a size,
 * the card still needs to show the Black prices rather than nothing at all.
 *
 * An empty selection returns the default variant, which is what makes a
 * single-variant product work without any special case at the call site.
 *
 * @param {object} product view model
 * @param {Record<string, string>} selection
 * @returns {object|null} the variant, or null when nothing matches
 */
export function findVariantFor(product, selection) {
  const entries = Object.entries(selection ?? {}).filter(([, value]) => value);
  if (entries.length === 0) return product?.default_variant ?? null;

  return (
    (product?.variants ?? []).find((variant) =>
      entries.every(([key, value]) => String(variant.attributes?.[key]) === String(value))
    ) ?? null
  );
}

/**
 * Whether an option value can be reached from the current selection.
 *
 * This is what prevents the classic dead end: "Black / 42" is sold out and the
 * shopper cannot work out that switching to White fixes it. The check honours the
 * OTHER chosen attributes but ignores the option's own key, so a bad choice is
 * always undoable.
 *
 * @param {object} product view model
 * @param {string} key          the option being tested
 * @param {string} value        the candidate value
 * @param {Record<string, string>} selection current selection
 * @returns {{ enabled: boolean, variant: object|null }}
 */
export function canSelectAttribute(product, key, value, selection) {
  const others = Object.entries(selection ?? {}).filter(
    ([otherKey, otherValue]) => otherKey !== key && otherValue
  );

  const variant = (product?.variants ?? []).find((candidate) => {
    if (String(candidate.attributes?.[key]) !== String(value)) return false;
    return others.every(
      ([otherKey, otherValue]) => String(candidate.attributes?.[otherKey]) === String(otherValue)
    );
  });

  return { enabled: Boolean(variant?.is_purchasable), variant: variant ?? null };
}
