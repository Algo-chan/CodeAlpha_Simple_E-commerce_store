/**
 * Buttons.
 *
 * A single factory rather than six components, because the difference between
 * a primary button and an icon button is two class names, not two components.
 *
 * @example
 *   button({ label: 'Add to cart', variant: 'primary', onClick: add })
 *   button({ label: 'Wishlist', variant: 'ghost', icon: 'heart', iconOnly: true })
 *   link({ label: 'View all', href: '/collection.html' })
 *
 * LOADING IS PART OF THE BUTTON, NOT THE CALLER. An async action that does not
 * disable its own button can be clicked twice, which double-adds to the cart
 * and double-charges once checkout exists. `run()` handles that:
 *
 * @example
 *   const addButton = button({ label: 'Add to cart', variant: 'primary' });
 *   addButton.element.addEventListener('click', () =>
 *     addButton.run(() => cart.add(variant))
 *   );
 */
import { el } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';

/** Visual weight. Only `primary` should appear once per view region. */
export const VARIANTS = Object.freeze([
  'primary',
  'secondary',
  'outline',
  'ghost',
  'link',
  'danger',
  'danger-ghost',
  'quiet-danger',
]);

export const SIZES = Object.freeze(['sm', 'md', 'lg']);

/**
 * @typedef {object} ButtonOptions
 * @property {string} [label]
 * @property {string} [href]          renders an <a>
 * @property {string} [variant]       see VARIANTS
 * @property {'sm'|'md'|'lg'} [size]
 * @property {string} [icon]          icon name, placed before the label
 * @property {string} [iconEnd]       icon name, placed after the label
 * @property {boolean} [iconOnly]     square button, label becomes the aria-label
 * @property {boolean} [block]        full width
 * @property {boolean} [auto]         width fits content inside a flex row
 * @property {boolean} [disabled]
 * @property {boolean} [pressed]      aria-pressed
 * @property {boolean} [expanded]     aria-expanded
 * @property {string} [controls]      aria-controls
 * @property {string} [type]
 * @property {object} [dataset]
 * @property {string} [id]
 * @property {string} [className]
 * @property {(event: MouseEvent) => void} [onClick]
 * @property {Node|string} [children]  replaces the label entirely
 */

/**
 * @param {ButtonOptions} options
 * @returns {{ element: HTMLElement, run: (task: () => any) => Promise<any>,
 *             setLoading: (loading: boolean) => void,
 *             setLabel: (label: string) => void,
 *             setPressed: (pressed: boolean) => void }}
 */
export function button(options = {}) {
  const {
    label = '',
    href,
    variant = 'secondary',
    size = 'md',
    icon: iconName,
    iconEnd,
    iconOnly = false,
    block = false,
    auto = false,
    disabled = false,
    pressed,
    expanded,
    controls,
    type = 'button',
    dataset,
    id,
    className,
    onClick,
    children,
  } = options;

  if (!VARIANTS.includes(variant)) {
    throw new Error(`Unknown button variant "${variant}". Expected one of: ${VARIANTS.join(', ')}`);
  }

  const element = href
    ? el('a.btn', {
        href,
        role: 'button',
        className: buildClassName({ variant, size, iconOnly, block, auto }),
        ...accessibility({ label, iconOnly, pressed, expanded, controls }),
        ...(id ? { id } : {}),
        ...(dataset ? { dataset } : {}),
      })
    : el('button.btn', {
        type,
        className: buildClassName({ variant, size, iconOnly, block, auto }),
        ...accessibility({ label, iconOnly, pressed, expanded, controls }),
        ...(disabled ? { disabled: true } : {}),
        ...(id ? { id } : {}),
        ...(dataset ? { dataset } : {}),
        ...(onClick ? { onClick } : {}),
      });

  if (className) element.className = [element.className, className].join(' ');

  // Content is replaced on every render of the label, so the accessible name
  // and the visible text can never drift apart.
  const labelNode = el('span.btn__label');
  const content = children ?? buildContent({ label, iconName, iconEnd });
  labelNode.append(content);

  element.append(labelNode);

  let loading = false;

  function setLoading(next) {
    if (loading === next) return;
    loading = next;

    element.classList.toggle('btn--loading', next);
    element.toggleAttribute('aria-busy', next);
    if (element.tagName === 'BUTTON') element.disabled = next || disabled;

    if (next) {
      // The spinner replaces the icon rather than being appended, so the button
      // does not change width mid-click and appear to jump under the cursor.
      element.querySelector('.btn__icon-slot')?.replaceWith(
        el('span.btn__spinner', { 'aria-hidden': 'true' })
      );
    } else {
      element.querySelector('.btn__spinner')?.replaceWith(
        iconName ? iconSlot(iconName) : document.createComment('icon-slot')
      );
    }
  }

  function setLabel(next) {
    const span = element.querySelector('.btn__label');
    if (!span) return;
    span.textContent = next;
    if (!iconOnly) element.setAttribute('aria-label', next);
  }

  function setPressed(next) {
    element.setAttribute('aria-pressed', String(Boolean(next)));
  }

  /**
   * Runs an async action with the button locked. The finally block is what
   * guarantees the button unlocks even when the task throws.
   */
  async function run(task) {
    if (loading) return undefined;
    setLoading(true);
    try {
      return await task();
    } finally {
      setLoading(false);
    }
  }

  return { element, run, setLoading, setLabel, setPressed };
}

/** A link styled as a button, for navigation rather than actions. */
export function link(options = {}) {
  return button({ ...options, variant: options.variant ?? 'link' });
}

/**
 * A row of buttons that behave as a single control group - used for the
 * grid/list switch and for pagination-adjacent clusters.
 * @param {object[]} buttonOptions
 * @returns {HTMLElement}
 */
export function buttonGroup(buttonOptions = [], { label } = {}) {
  return el('div.btn-group', {
    ...(label ? { role: 'group', 'aria-label': label } : {}),
  }, buttonOptions.map((options) => button(options).element));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

function buildClassName({ variant, size, iconOnly, block, auto }) {
  return [
    'btn',
    `btn--${variant}`,
    size === 'md' ? null : `btn--${size}`,
    iconOnly ? 'btn--icon' : null,
    block ? 'btn--block' : null,
    auto ? 'btn--auto' : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * An icon-only button has no visible text, so the label must become the
 * accessible name or the control is announced as "button".
 */
function accessibility({ label, iconOnly, pressed, expanded, controls }) {
  const attributes = {};
  if (label) {
    if (iconOnly) {
      attributes['aria-label'] = label;
      attributes.title = label;
    } else {
      attributes['aria-label'] = label;
    }
  }
  if (pressed !== undefined) attributes['aria-pressed'] = String(Boolean(pressed));
  if (expanded !== undefined) attributes['aria-expanded'] = String(Boolean(expanded));
  if (controls) attributes['aria-controls'] = controls;
  return attributes;
}

function iconSlot(name) {
  return el('span.btn__icon-slot', { 'aria-hidden': 'true' }, [icon(name, { className: 'btn__icon' })]);
}

function buildContent({ label, iconName, iconEnd }) {
  const fragment = document.createDocumentFragment();

  if (iconName) fragment.append(iconSlot(iconName));
  if (label) fragment.append(document.createTextNode(label));
  if (iconEnd) {
    fragment.append(
      el('span.btn__icon-slot', { 'aria-hidden': 'true' }, [icon(iconEnd, { className: 'btn__icon' })])
    );
  }
  return fragment;
}

export default { button, link, buttonGroup, VARIANTS, SIZES };