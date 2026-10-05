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
 * Below this, the API marks a product "Low stock".
 *
 * Only the fixture builder still needs a number, because it has to stand in for
 * the server while the storefront runs on fixtures. Every component now reads
 * `variant.is_low_stock` and `product.is_low_stock`, which the server computes from
 * its own copy of this threshold — so the number is stated once, on the tier that
 * owns the policy, instead of twice with a chance of the two disagreeing.
 *
 * It stays exported because the fixture builder genuinely has to reproduce the
 * server's decision; deleting it would only push the same constant somewhere
 * less honest.
 */
export const LOW_STOCK_THRESHOLD = 5;

/* -------------------------------------------------------------------------- */
/* Attributes                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Attribute keys that are initialisms, so `ram` reads as RAM rather than Ram.
 *
 * An EXPLICIT list, not a length heuristic. "Any bare lowercase token of two to
 * four letters is an acronym" cannot tell `ram` from `new`, `size` or `os` — all
 * of which are ordinary words that would come out shouting. `new` as a filter
 * label is the worst of those, since "NEW" reads as a marketing claim rather than
 * as the name of a facet.
 *
 * Keep this in step with the identical list in
 * `backend/src/services/catalogue.view.js`.
 */
const ATTRIBUTE_ACRONYMS = new Set([
  'ram',
  'rom',
  'ssd',
  'hdd',
  'cpu',
  'gpu',
  'usb',
  'hdmi',
  'nfc',
  'sim',
  'led',
  'lcd',
  'oled',
  'dpi',
  'sd',
]);

/**
 * An attribute key as the shopper reads it.
 *
 * ONE implementation, previously four. `backend/src/services/catalogue.view.js`
 * keeps the server-side twin because the two cannot import each other; what this
 * function is for is that nothing inside the frontend disagrees with itself.
 *
 * The rules, and why each exists:
 *
 *   - Collapse runs of separators. `storage__capacity` and `storage-capacity`
 *     describe the same facet and must produce one label and one filter key, not
 *     two of each.
 *   - Uppercase a listed initialism, and nothing else.
 *
 * @param {string} key
 * @returns {string}
 */
export function humaniseAttribute(key) {
  const spaced = String(key ?? '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return '';

  if (ATTRIBUTE_ACRONYMS.has(spaced.toLowerCase())) return spaced.toUpperCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The union of every attribute key across variants, as sorted unique values.
 *
 * ONE implementation of the empty-value rule, previously three that disagreed.
 * A `null`, `undefined` or empty-string attribute is not an option a shopper can
 * choose, so it is skipped: an empty facet value would render as a blank checkbox
 * that matches every product with that key, which is a filter that appears to work
 * and does nothing.
 *
 * The backend's twin drops the skip, because the column is NOT NULL there and the
 * case cannot arise. The frontend applies it defensively so a fixture or a future
 * loose column cannot produce a dead checkbox.
 *
 * @param {object[]} variants
 * @returns {Record<string, string[]>}
 */
export function mergeAttributes(variants) {
  const merged = {};

  for (const variant of variants ?? []) {
    for (const [key, value] of Object.entries(variant?.attributes ?? {})) {
      if (value === null || value === undefined || value === '') continue;
      (merged[key] ??= new Set()).add(String(value));
    }
  }

  return Object.fromEntries(
    Object.entries(merged).map(([key, values]) => [key, Array.from(values).sort()])
  );
}

/**
 * Option groups for a variant picker: key, human label, values.
 *
 * The picker chooses a control per group, so the label must be readable and the
 * value order stable. Sorting puts sizes in "10, 11, 40, 42" order rather than
 * whatever order the data happened to arrive in.
 *
 * @param {object[]} variants
 * @returns {Array<{key:string, label:string, values:string[]}>}
 */
export function buildAttributeOptions(variants) {
  return Object.entries(mergeAttributes(variants)).map(([key, values]) => ({
    key,
    label: humaniseAttribute(key),
    values,
  }));
}

/* -------------------------------------------------------------------------- */
/* Badges                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Badge vocabulary.
 *
 * Keys come from the server; this maps them to wording, and adds the `new` and
 * `featured` keys the fixture catalogue derives from product flags.
 *
 * `new` and `featured` are FIXTURE-ONLY. The API deliberately reports
 * `is_featured: false` because there is no merchandising flag in the schema and
 * "Featured" would be a fabricated editorial claim, so no server response will
 * ever contain either key. They stay here so the fixtures still render; they must
 * not be read as vocabulary the server shares.
 *
 * `sale-<percent>` is deliberately not listed: the percentage comes from the
 * discount calculation, so a static map cannot enumerate it. `badgeLabel` handles
 * the family by pattern.
 *
 * `backend/src/services/catalogue.view.js` holds the server twin. The two cannot
 * be one module, so parity is checked by a test on each side rather than assumed:
 * a new server key with no wording here renders as an empty pill, which reads as
 * a CSS bug rather than a missing string.
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
