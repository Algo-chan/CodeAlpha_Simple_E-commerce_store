/**
 * Form fields.
 *
 * Every input in the storefront is built here so that labelling, error wiring
 * and validation messaging cannot be forgotten at a call site. Two rules the
 * markup enforces structurally rather than by convention:
 *
 *   1. THE LABEL IS ALWAYS PRESENT and always linked by id. Placeholder text is
 *      not a label: it disappears the moment the shopper types.
 *   2. THE ERROR IS ALWAYS IN AN `aria-live` region tied by `aria-describedby`,
 *      so a validation message is announced when it appears rather than only
 *      when the shopper next focuses the field.
 */
import { el, on } from '../../core/dom.js';

let sequence = 0;

/** Collision-free id, prefixed for readability in the DOM inspector. */
function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

/**
 * @typedef {object} FieldOptions
 * @property {string} [label]
 * @property {'text'|'email'|'tel'|'search'|'number'|'url'|'password'|'date'} [type]
 * @property {string} [name]
 * @property {string} [value]
 * @property {string} [placeholder]
 * @property {string} [hint]
 * @property {boolean} [required]
 * @property {boolean} [optional]     renders an "(optional)" marker
 * @property {string} [id]
 * @property {boolean} [inline]
 * @property {boolean} [disabled]
 * @property {boolean} [readonly]
 * @property {string} [autocomplete]
 * @property {string} [inputmode]
 * @property {number}  [min]
 * @property {number}  [max]
 * @property {number}  [step]
 * @property {string}  [maxlength]
 * @property {boolean} [noValidate]   suppress the browser's own bubble
 * @property {(event: Event) => void} [onInput]
 * @property {(event: Event) => void} [onChange]
 */

/**
 * @param {FieldOptions} options
 * @returns {{ element: HTMLElement, input: HTMLInputElement, setValue(v:string):void,
 *             getValue():string, setError(msg:string|null):void, clearError():void,
 *             focus():void }}
 */
export function field(options = {}) {
  const {
    label,
    type = 'text',
    name,
    value = '',
    placeholder,
    hint,
    required = false,
    optional = false,
    id,
    inline = false,
    disabled = false,
    readonly = false,
    autocomplete,
    inputmode,
    min,
    max,
    step,
    maxlength,
    noValidate = false,
    onInput,
    onChange,
  } = options;

  const inputId = id ?? nextId('field');
  const hintId = hint ? `${inputId}-hint` : null;
  const errorId = `${inputId}-error`;

  const input = el('input.input', {
    type,
    id: inputId,
    ...(name ? { name } : {}),
    value,
    ...(placeholder ? { placeholder } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    ...(inputmode ? { inputmode } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(maxlength ? { maxlength } : {}),
    ...(required ? { required: true } : {}),
    ...(disabled ? { disabled: true } : {}),
    ...(readonly ? { readonly: true } : {}),
    // Suppressing the native bubble keeps validation styling consistent with
    // every other field on the page.
    novalidate: noValidate ? true : null,
  });

  const labelNode = label
    ? el('label.field__label', { for: inputId }, [
        label,
        required ? el('span.field__required', { 'aria-hidden': 'true', text: '*' }) : null,
        optional ? el('span.field__optional', { text: '(optional)' }) : null,
      ])
    : null;

  const hintNode = hint ? el('p.field__hint', { id: hintId, text: hint }) : null;

  // Always present in the DOM so aria-describedby never points at nothing.
  const messageNode = el('p.field__message', {
    id: errorId,
    role: 'alert',
    'aria-live': 'polite',
  });

  const element = el('div.field', { ...(inline ? { className: 'field--inline' } : {}) }, [
    labelNode,
    input,
    hintNode,
    messageNode,
  ]);

  // `required` on the input plus aria-required means both the native
  // constraint API and assistive tech agree about what is mandatory.
  if (required) input.setAttribute('aria-required', 'true');

  /** @param {string|null} message */
  function setError(message) {
    if (!message) {
      clearError();
      return;
    }
    element.classList.add('field--invalid');
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', joinIds([hintId, errorId]));
    messageNode.classList.remove('field__message--success');
    messageNode.textContent = message;
  }

  function clearError() {
    element.classList.remove('field--invalid');
    element.classList.remove('field--valid');
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', hintId ?? '');
    messageNode.textContent = '';
  }

  function setValue(next) {
    input.value = next ?? '';
  }

  const cleanups = [
    // Clearing the error as soon as the shopper starts typing stops a stale
    // "required" message sitting under a field they have already filled in.
    onInput ? on(input, 'input', (event) => onInput(event)) : null,
    onChange ? on(input, 'change', (event) => onChange(event)) : null,
  ].filter(Boolean);

  return {
    element,
    input,
    setValue,
    getValue: () => input.value,
    setError,
    clearError,
    focus: () => input.focus(),
    validate() {
      if (input.validity.valid) {
        clearError();
        return true;
      }
      setError(describeValidity(input));
      return false;
    },
    destroy() {
      cleanups.forEach((fn) => fn());
    },
  };
}

/**
 * A native `<select>`. A styled listbox is a large amount of code to reimplement
 * - keyboard handling, typeahead, mobile pickers - and native gets all of it
 * free and correctly.
 * @param {FieldOptions & { options: Array<{value:string,label:string,disabled?:boolean}>, selectSize?: number }} options
 */
export function select(options = {}) {
  const { options: choices = [], label, hint, id, required, disabled, onChange, value } = options;
  const selectId = id ?? nextId('select');
  const hintId = hint ? `${selectId}-hint` : null;

  const control = el('select.select', {
    id: selectId,
    ...(options.name ? { name: options.name } : {}),
    ...(required ? { required: true } : {}),
    ...(disabled ? { disabled: true } : {}),
    ...(hintId ? { 'aria-describedby': hintId } : {}),
  }, choices.map((choice) =>
    el('option', { value: choice.value, ...(choice.disabled ? { disabled: true } : {}) }, [
      choice.label,
    ])
  ));

  if (value !== undefined) control.value = value;

  const element = el('div.field', {}, [
    label
      ? el('label.field__label', { for: selectId }, [
          label,
          required ? el('span.field__required', { 'aria-hidden': 'true', text: '*' }) : null,
        ])
      : null,
    el('div.select-wrapper', {}, [control, el('span.select__chevron', { 'aria-hidden': 'true' })]),
    hint ? el('p.field__hint', { id: hintId, text: hint }) : null,
    el('p.field__message', { role: 'alert', 'aria-live': 'polite' }),
  ]);

  if (onChange) on(control, 'change', onChange);

  return {
    element,
    control,
    getValue: () => control.value,
    setValue: (next) => {
      control.value = next;
    },
  };
}

function joinIds(ids) {
  return ids.filter(Boolean).join(' ');
}

/** Turns native constraint failures into advice rather than browser wording. */
function describeValidity(input) {
  const { valueMissing, typeMismatch, rangeUnderflow, rangeOverflow, patternMismatch, tooShort } =
    input.validity;

  if (valueMissing) return input.required ? 'This field is required.' : 'Please enter a value.';
  if (typeMismatch) {
    return input.type === 'email'
      ? 'Enter an email address in the form name@example.com.'
      : 'That does not look like a valid value.';
  }
  if (rangeUnderflow) return `Enter ${input.min} or more.`;
  if (rangeOverflow) return `Enter ${input.max} or less.`;
  if (patternMismatch) return 'That does not match the expected format.';
  if (tooShort) return `Use at least ${input.minLength} characters.`;
  return 'Check this value.';
}

export default { field, select };