/**
 * Quantity stepper.
 *
 * Used in the cart drawer and in the quick view. Two accessibility decisions
 * that are not obvious:
 *
 *   - The number is a real `<input type="number">`, not a styled `<div>`. That
 *     gives keyboard entry, screen reader support and mobile numeric keypads
 *     for free. The buttons sit alongside it rather than replacing it.
 *   - The buttons are `type="button"`. Without that they submit any enclosing
 *     form, which in a cart drawer means an unwanted page reload.
 *
 * The value is clamped and committed on `change`, not on every keystroke, so
 * typing "10" does not fire two updates of "1" and "10" on the way.
 */
import { el, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';

let sequence = 0;

/**
 * @param {object} options
 * @param {number} [options.value]
 * @param {number} [options.min]
 * @param {number} [options.max]
 * @param {number} [options.step]
 * @param {boolean} [options.small]
 * @param {boolean} [options.disabled]
 * @param {string} [options.label]        accessible name for the group
 * @param {string} [options.singular]     item noun, for the status message
 * @param {(quantity: number) => void} [options.onChange]
 * @returns {{ element: HTMLElement, setValue(v:number):void, getValue():number,
 *             setMax(max:number|null):void, setDisabled(disabled:boolean):void }}
 */
export function stepper({
  value = 1,
  min = 1,
  max = 10,
  step = 1,
  small = false,
  disabled = false,
  label = 'Quantity',
  singular = 'item',
  onChange,
} = {}) {
  sequence += 1;
  const inputId = `stepper-${sequence}`;
  let current = clamp(value, min, max);
  let ceiling = max;

  const input = el('input.stepper__input', {
    type: 'number',
    id: inputId,
    value: String(current),
    min: String(min),
    max: String(max),
    step: String(step),
    inputmode: 'numeric',
    autocomplete: 'off',
    // The label is on the group; the input itself is described by it so a
    // screen reader announces "Quantity, spin button, 1".
    'aria-label': `${label} for one ${singular}`,
    disabled: disabled || undefined,
  });

  const decrement = el(
    'button.stepper__button',
    {
      type: 'button',
      'aria-label': `Decrease ${label.toLowerCase()}`,
      disabled: disabled || current <= min || undefined,
    },
    [icon('minus')]
  );

  const increment = el(
    'button.stepper__button',
    {
      type: 'button',
      'aria-label': `Increase ${label.toLowerCase()}`,
      disabled: disabled || current >= ceiling || undefined,
    },
    [icon('plus')]
  );

  const element = el(
    `div.stepper${small ? '.stepper--sm' : ''}`,
    { role: 'group', 'aria-label': label },
    [decrement, input, increment]
  );

  function sync() {
    input.value = String(current);
    decrement.disabled = disabled || current <= min;
    increment.disabled = disabled || current >= ceiling;
  }

  function commit(next) {
    const clamped = clamp(next, min, ceiling);
    // Only notify on a real change, so a click at the limit is inert.
    if (clamped === current) {
      sync();
      return current;
    }
    current = clamped;
    sync();
    onChange?.(current);
    return current;
  }

  const cleanups = [
    on(decrement, 'click', () => commit(current - step)),
    on(increment, 'click', () => commit(current + step)),
    // `change` fires on blur or Enter, not per keystroke.
    on(input, 'change', () => commit(Number.parseInt(input.value, 10))),
    // Nudge with arrow keys without letting the field go out of range silently.
    on(input, 'keydown', (event) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        commit(current + step);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        commit(current - step);
      }
    }),
  ];

  return {
    element,
    getValue: () => current,
    setValue: (next) => {
      current = clamp(next, min, ceiling);
      sync();
    },
    /** Null means unbounded, for digital goods with no stock ceiling. */
    setMax(next) {
      ceiling = next ?? MAX_UNBOUNDED;
      input.max = next === null || next === undefined ? '' : String(next);
      commit(current);
    },
    setDisabled(next) {
      disabled = Boolean(next);
      input.disabled = disabled;
      decrement.disabled = disabled || current <= min;
      increment.disabled = disabled || current >= ceiling;
    },
    focus: () => input.focus(),
    destroy: () => cleanups.forEach((fn) => fn()),
  };
}

/**
 * A practical stand-in for "no ceiling". Not infinity - a number the input can
 * hold and the increment button can compare against.
 */
const MAX_UNBOUNDED = 9999;

function clamp(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

export default { stepper };
