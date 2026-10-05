/**
 * Variant picker.
 *
 * Consumes a product view model and knows nothing about what "size" or "colour"
 * means, so a jacket (colour / size) and a phone (storage / RAM) work through
 * the same component.
 *
 *   - `color`  -> swatches, because colour is best identified by colour
 *   - <= 6 values -> text buttons, because the values are short and few
 *   - longer     -> a select, because twelve buttons is a wall
 *
 * The hard part is not rendering, it is *availability*. Three rules:
 *
 *   1. An option is unavailable when no purchasable variant matches it together
 *      with everything else already chosen. Choosing "Black / 42" when that pair
 *      is sold out must not be possible.
 *   2. Availability is re-evaluated after every change, so a shopper who has
 *      chosen Black and then switches to White sees the size options update.
 *   3. Values that become unreachable are dropped from the selection, because
 *      leaving them behind produces a state the shopper cannot escape except by
 *      guessing which control is lying - and "add to cart" would be a lie.
 *
 * Rule 3 is why the groups redraw on selection rather than flipping an
 * `aria-pressed` attribute: a redraw is a few dozen nodes and always yields a
 * consistent state, where incremental updates would have to reason about the
 * interaction between every pair of groups.
 */
import { el, qs } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { select } from '../forms/field.js';
import { canSelectAttribute, findVariantFor } from '../../utils/product-view.js';

/** Attributes rendered as colour swatches rather than text buttons. */
const COLOR_KEYS = new Set(['color', 'colour']);

/** Above this many values, buttons become a wall and a select is kinder. */
const BUTTON_LIMIT = 6;

/**
 * Humanises a value without mangling the ones that are codes.
 * "black" -> "Black", but "XL" and "128GB" are left as written - lowercasing
 * "XL" reads as a bug.
 */
export function humaniseVariantValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  if (/^[A-Za-z0-9./+-]{1,4}$/.test(text)) {
    return text === text.toUpperCase() ? text : text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Maps a variant value to a paintable colour.
 *
 * Unrecognised values still get a deterministic colour rather than a grey
 * placeholder - two different fabrics must never be shown identically.
 *
 * @param {string} value
 * @returns {string} any CSS colour
 */
export function swatchColour(value) {
  const named = String(value).trim().toLowerCase();
  const table = SWATCHES[named];
  if (table) return table;

  const hue = [...named].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 360,
    7
  );
  return `hsl(${hue} 28% 62%)`;
}

const SWATCHES = {
  black: '#1b1b1b',
  white: '#f4f2ee',
  ivory: '#f2ecdf',
  cream: '#f0e9d8',
  bone: '#ebe8e2',
  grey: '#8a8a86',
  gray: '#8a8a86',
  charcoal: '#3b3b3f',
  navy: '#22314f',
  blue: '#3a6ea5',
  'denim blue': '#3f5f8a',
  sky: '#a8c6de',
  sage: '#8a9a7b',
  olive: '#5f6a45',
  green: '#3f7a52',
  forest: '#2f5340',
  rust: '#9c4a2c',
  clay: '#b5654a',
  terracotta: '#c0704f',
  brick: '#9e3b2b',
  ember: '#b04a29',
  amber: '#c8912f',
  mustard: '#d3a63c',
  yellow: '#e0b93a',
  brown: '#6f4a30',
  tan: '#c19a6b',
  camel: '#c2a074',
  chocolate: '#4a3125',
  burgundy: '#6d2233',
  maroon: '#5e1f26',
  plum: '#5b3a55',
  lilac: '#b3a1c7',
  purple: '#6a4b8a',
  pink: '#d59aa7',
  blush: '#e8c4c0',
  red: '#b3261e',
  orange: '#d1662a',
  silver: '#c9ccd1',
  gold: '#c9a227',
  brass: '#b08d4a',
  steel: '#7d858c',
};

/**
 * @param {object} options
 * @param {object} options.product           product view model
 * @param {Record<string,string>} [options.selected]
 * @param {(selection: object, variant: object|null) => void} [options.onChange]
 * @param {boolean} [options.small]
 * @param {boolean} [options.showWarning]
 * @param {boolean} [options.showSummary]
 * @returns {{ element: HTMLElement, getSelection: () => object,
 *             getVariant: () => object|null, getSummaryNode: () => HTMLElement|null,
 *             setSelected: (map: object) => void, destroy: () => void }}
 */
export function variantPicker({
  product,
  selected = {},
  onChange,
  small = false,
  showWarning = true,
  showSummary = true,
} = {}) {
  const attributes = (product?.attribute_options ?? []).filter(
    (attribute) => (attribute.values ?? []).length > 0
  );

  let selection = { ...selected };
  let matched = product?.default_variant ?? null;

  const element = el('div.variant-picker');

  // With nothing to choose, the picker is a wrapper around an empty list. The
  // digital-product case lands here, and an empty bordered box reads as a bug.
  if (attributes.length === 0) {
    element.hidden = true;
    return {
      element,
      getSelection: () => ({}),
      getVariant: () => product?.default_variant ?? null,
      getSummaryNode: () => null,
      setSelected: () => {},
      destroy: () => {},
    };
  }

  const groups = attributes.map((attribute) => {
    const isColor = COLOR_KEYS.has(String(attribute.key).toLowerCase());
    const useSelect = !isColor && attribute.values.length > BUTTON_LIMIT;
    const label = attribute.label ?? humaniseVariantValue(attribute.key);
    const headingId = `variant-${attribute.key}-label`;

    const valueNode = el('span.variant-group__value');
    const optionsHost = el(
      'div.variant-group__options',
      useSelect ? {} : { role: 'group', 'aria-labelledby': headingId }
    );
    const warningText = el('span');
    const warning = el('p.variant-warning', { role: 'status', hidden: true }, [
      icon('alert-circle'),
      warningText,
    ]);

    const group = el(`div.variant-group${useSelect ? '.variant-group--select' : ''}`, {}, [
      el('div.variant-group__header', {}, [
        el('span.variant-group__label', { id: headingId, text: label }),
        valueNode,
      ]),
      optionsHost,
      showWarning ? warning : null,
    ]);

    return {
      attribute,
      label,
      isColor,
      useSelect,
      group,
      optionsHost,
      valueNode,
      warning,
      warningText,
    };
  });

  element.append(...groups.map((entry) => entry.group));

  const summary = showSummary ? el('div.variant-summary', { 'aria-live': 'polite' }) : null;
  if (summary) element.append(summary);

  /* --- Availability -------------------------------------------------------- */

  /** Is this value reachable, holding every *other* group as chosen? */
  function availableIn(key, value) {
    return canSelectAttribute(product, key, value, selection).enabled;
  }

  /**
   * Drops values that no longer lead to anything purchasable.
   *
   * Repeated because dropping one value can strand another; the loop terminates
   * because each pass removes at least one key or changes nothing.
   */
  function reconcile() {
    for (let pass = 0; pass <= groups.length; pass += 1) {
      const stranded = Object.keys(selection).find((key) => {
        const group = groups.find((entry) => entry.attribute.key === key);
        // A key that no longer exists in the view model is dropped outright.
        return !group || !availableIn(key, selection[key]);
      });

      if (!stranded) return;
      delete selection[stranded];
    }
  }

  /* --- Rendering ----------------------------------------------------------- */

  function draw() {
    matched = findVariantFor(product, selection);

    for (const entry of groups) {
      const current = selection[entry.attribute.key] ?? '';
      entry.valueNode.textContent = current ? humaniseVariantValue(current) : 'Choose';

      if (entry.useSelect) drawSelect(entry);
      else drawOptions(entry);

      // Warn only about a value that is selected *and* unreachable, which after
      // `reconcile` means the whole combination is gone - for instance a product
      // that has just sold out in every size the shopper could choose.
      const stranded =
        Boolean(current) &&
        entry.attribute.values.every((value) => !availableIn(entry.attribute.key, value));

      entry.warningText.textContent = stranded
        ? `${humaniseVariantValue(current)} is sold out. Try another option.`
        : '';

      // The icon inside the warning would otherwise stay visible next to an empty
      // sentence, because only the text node was being emptied.
      entry.warning.hidden = !stranded;
    }

    drawSummary();
  }

  function drawOptions(entry) {
    const { key, values } = entry.attribute;

    entry.optionsHost.replaceChildren(
      ...values.map((value) => {
        const text = humaniseVariantValue(value);
        const enabled = availableIn(key, value);
        const isSelected = selection[key] === String(value);

        if (entry.isColor) {
          return el(
            'button.variant-swatch',
            {
              type: 'button',
              className: small ? 'variant-swatch--sm' : null,
              // `aria-disabled`, not `disabled`: an unavailable swatch must stay
              // reachable so a screen reader can read why the combination is not
              // for sale. A truly disabled control would be skipped silently.
              'aria-disabled': enabled ? null : 'true',
              'aria-pressed': String(isSelected),
              'aria-label': enabled ? text : `${text}, unavailable`,
              style: `--swatch-color: ${swatchColour(value)}`,
              onClick: () => choose(key, value),
            },
            [el('span.variant-swatch__chip')]
          );
        }

        return el('button.variant-option', {
          type: 'button',
          className: small ? 'variant-option--sm' : null,
          'aria-disabled': enabled ? null : 'true',
          'aria-pressed': String(isSelected),
          text: enabled ? text : `${text} — unavailable`,
          onClick: () => choose(key, value),
        });
      })
    );
  }

  function drawSelect(entry) {
    const { key, values } = entry.attribute;

    const { element: control } = select({
      id: `variant-${key}`,
      // The label is asked for because `select` only renders one when it is
      // given; in select mode the group wrapper carries no `aria-labelledby`, so
      // without this the control has no accessible name at all.
      label: entry.label,
      value: selection[key] ?? '',
      options: [
        // "Any" is the honest label for the empty option: empty means "not
        // restricted", not "out of stock".
        { value: '', label: `Any ${entry.label.toLowerCase()}` },
        ...values.map((value) => ({
          value: String(value),
          label: humaniseVariantValue(value),
          disabled: !availableIn(key, value),
        })),
      ],
      onChange: (event) => choose(key, event.target.value),
    });

    // The select already sits under a labelled group heading, so the field's own
    // label would be read twice. It is kept, visually hidden, because a native
    // select with no associated label is an accessibility failure.
    const ownLabel = qs('label', control);
    ownLabel?.classList.add('visually-hidden');

    entry.optionsHost.replaceChildren(control);
  }

  function drawSummary() {
    if (!summary) return;
    const label = matched?.label ?? null;
    summary.replaceChildren(
      label ? el('span', { text: `Selected: ${label}` }) : null,
      matched?.sku ? el('span.variant-summary__sku', { text: matched.sku }) : null
    );
  }

  /* --- Selection ----------------------------------------------------------- */

  function choose(key, rawValue) {
    const value = String(rawValue ?? '');

    if (value === '' || value === selection[key]) {
      delete selection[key];
    } else {
      // Refused silently: the option is already marked unavailable three ways,
      // and a dialog here would be a step backwards in the interaction.
      if (!availableIn(key, value)) return;
      selection[key] = value;
    }

    reconcile();
    draw();
    onChange?.({ ...selection }, matched);
  }

  reconcile();
  draw();

  return {
    element,
    getSelection: () => ({ ...selection }),
    getVariant: () => matched,
    getSummaryNode: () => summary,
    setSelected(next) {
      selection = { ...next };
      reconcile();
      draw();
    },
    destroy: () => {
      // Every listener is bound in markup that this component rebuilds, so the
      // discarded nodes take their listeners with them. There is nothing to
      // detach by hand.
    },
  };
}

export default { variantPicker, swatchColour, humaniseVariantValue };
