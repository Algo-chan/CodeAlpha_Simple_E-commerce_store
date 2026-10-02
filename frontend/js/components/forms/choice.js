/**
 * Checkbox and radio groups.
 *
 * Generic form primitives: a checkbox, a radio, and a fieldset of checkboxes.
 *
 * NOTE: the collection filter panel does not use these. It builds its own
 * `.filter-radio-row` controls inside a `<details>` disclosure so the group can
 * carry a summary and animated indicator, which this component has no slot for.
 * That duplication is real and is worth collapsing, but it is a deliberate
 * difference rather than an oversight - see `collection/collection-page.js`.
 *
 * The visible box is a sibling of the real input rather than a styled input,
 * because `appearance: none` on a checkbox cannot express the hover and focus
 * states this design uses, and because hiding the real input with `opacity: 0`
 * breaks pointer events on some touch browsers.
 *
 * The input stays in the DOM, visually hidden but focusable, so:
 *   - Tab reaches it,
 *   - Space toggles it,
 *   - a screen reader announces the real label and state.
 */
import { el, on, delegate } from '../../core/dom.js';

let sequence = 0;

/**
 * @param {object} options
 * @param {string} options.label
 * @param {string} [options.value]
 * @param {boolean} [options.checked]
 * @param {number}  [options.count]     rendered as "(6)" for facets
 * @param {boolean} [options.disabled]
 * @param {boolean} [options.indeterminate]
 * @returns {HTMLElement}
 */
export function checkbox({
  label,
  value = '',
  checked = false,
  count = null,
  disabled = false,
  indeterminate = false,
  onChange,
}) {
  sequence += 1;
  const id = `choice-${sequence}`;

  const input = el('input.choice__input', {
    type: 'checkbox',
    id,
    value,
    checked: checked || undefined,
    disabled: disabled || undefined,
  });
  input.indeterminate = indeterminate;

  const control = el('span.choice__control.choice__control--checkbox', { 'aria-hidden': 'true' });

  const element = el(
    `label.choice${disabled ? '.choice--disabled' : ''}`,
    { for: id, dataset: { choiceValue: value } },
    [
      input,
      control,
      el('span.choice__label', {}, [
        label,
        count === null ? null : el('span.choice__count', { text: `(${count})` }),
      ]),
    ]
  );

  if (onChange) on(input, 'change', onChange);
  if (indeterminate) input.setAttribute('aria-checked', 'mixed');

  element.control = input;
  return element;
}

/**
 * A radio group. Grouped checkboxes with a single selectable value, e.g. a
 * delivery speed or a one-of-three delivery address.
 * @param {{ name:string, label:string, value:string, checked?:boolean,
 *           disabled?:boolean, onChange?:Function }} options
 */
export function radio({ name, label, value, checked = false, disabled = false, onChange }) {
  sequence += 1;
  const id = `radio-${sequence}`;

  const input = el('input.choice__input', {
    type: 'radio',
    id,
    name,
    value,
    checked: checked || undefined,
    disabled: disabled || undefined,
  });

  const element = el(`label.choice${disabled ? '.choice--disabled' : ''}`, { for: id }, [
    input,
    el('span.choice__control.choice__control--radio', { 'aria-hidden': 'true' }),
    el('span.choice__label', { text: label }),
  ]);

  if (onChange) on(input, 'change', onChange);

  element.control = input;
  return element;
}

/**
 * A fieldset of checkboxes - the shape every filter facet needs.
 *
 * @param {object} options
 * @param {string} options.legend
 * @param {Array<{label:string, value:string, count?:number, checked?:boolean}>} options.items
 * @param {(value:string, checked:boolean) => void} [options.onChange]
 * @param {boolean} [options.collapsible]
 * @param {number}  [options.initialVisible] how many to show before "Show more"
 * @returns {{ element: HTMLElement, setChecked(value:string, checked:boolean):void }}
 */
export function checkboxGroup({
  legend,
  items = [],
  onChange,
  collapsible = true,
  initialVisible = 6,
}) {
  const name = `group-${legend.toLowerCase().replace(/\s+/g, '-')}`;
  const limit = collapsible && items.length > initialVisible ? initialVisible : items.length;
  const hidden = collapsible && items.length > initialVisible ? items.slice(limit) : [];

  // One delegated listener on the list handles every facet, rather than one
  // listener per checkbox. Passing onChange into each checkbox as well would
  // fire the handler twice per click.
  const visibleNodes = items.slice(0, limit).map((item) => checkbox(item));
  const hiddenNodes = hidden.map((item) => checkbox(item));

  for (const node of hiddenNodes) node.hidden = true;

  const toggle =
    collapsible && hidden.length > 0
      ? el('button.choice__more', {
          type: 'button',
          'aria-expanded': 'false',
          text: `Show ${hidden.length} more`,
        })
      : null;

  const list = el('div.choice__list', {}, [...visibleNodes, ...hiddenNodes]);

  const element = el('fieldset.filter-group', {}, [
    el('legend.filter-group__legend', { text: legend }),
    list,
    toggle,
  ]);

  // Show more / show fewer. Hiding with the `hidden` attribute rather than a
  // class means the checkboxes leave the tab order and the accessibility tree
  // for free.
  toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.textContent = expanded ? `Show ${hidden.length} more` : 'Show fewer';
    hiddenNodes.forEach((node) => {
      node.hidden = expanded;
    });
  });

  if (onChange) {
    // `name` is asserted so the group is discoverable from the DOM even though
    // native radio grouping is not used for checkboxes.
    list.dataset.group = name;
    delegate(list, 'change', '.choice__input', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement) onChange(target.value, target.checked);
    });
  }

  return {
    element,
    /** Reflects a programmatic change back into the control's state. */
    setChecked(value, checked) {
      for (const node of [...visibleNodes, ...hiddenNodes]) {
        if (node.control.value === value) node.control.checked = checked;
      }
    },
  };
}

export default { checkbox, radio, checkboxGroup };
