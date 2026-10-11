/**
 * Admin console — DOM toolkit.
 *
 * The console is dense and repetitive: a dozen list screens, half a dozen
 * dialogs, forms everywhere. This file holds the handful of primitives those
 * screens share — a card, a data table, a form, a dialog, a toast — so a section
 * module describes *what* it shows, not *how* a table row is a `<tr>`.
 *
 * It builds on `core/dom.js` (`el`) and reuses the storefront's `button`
 * component, so the console looks like the same product as the shop without a
 * second copy of every control.
 */
import { el, clear, getFocusable, focusFirst } from '../core/dom.js';
import { icon } from '../utils/icons.js';
import { button } from '../components/ui/button.js';

let fieldSequence = 0;

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A titled panel.
 * @param {{ title?: string, description?: string, actions?: HTMLElement[],
 *           body?: Node|Node[], className?: string }} options
 */
export function card({ title, description, actions = [], body = null, className = '' } = {}) {
  const heading = title || description;
  return el(`section.admin-card${className ? `.${className}` : ''}`, {}, [
    heading || actions.length > 0
      ? el('header.admin-card__head', {}, [
          el('div.admin-card__heading', {}, [
            title ? el('h2.admin-card__title', { text: title }) : null,
            description ? el('p.admin-card__description', { text: description }) : null,
          ]),
          actions.length > 0 ? el('div.admin-card__actions', {}, actions) : null,
        ])
      : null,
    el('div.admin-card__body', {}, Array.isArray(body) ? body : [body]),
  ]);
}

/**
 * A metric tile for the dashboard.
 * @param {{ label:string, value:string, hint?:string, tone?:string, icon?:string }} options
 */
export function statCard({ label, value, hint = null, tone = 'neutral', icon: iconName = null }) {
  return el('article.stat-card', { dataset: { tone } }, [
    iconName ? el('span.stat-card__icon', { 'aria-hidden': 'true' }, [icon(iconName)]) : null,
    el('p.stat-card__label', { text: label }),
    el('p.stat-card__value', { text: value }),
    hint ? el('p.stat-card__hint', { text: hint }) : null,
  ]);
}

/** A small coloured status marker. Never colour alone — it always has a label. */
export function toneBadge(text, tone = 'neutral') {
  return el(`span.admin-badge.admin-badge--${tone}`, { text });
}

/** A section (not page) heading with an optional action cluster. */
export function sectionHeading({ title, description = null, actions = [], eyebrow = null }) {
  return el('header.admin-section-head', {}, [
    el('div.admin-section-head__body', {}, [
      eyebrow ? el('p.admin-eyebrow', { text: eyebrow }) : null,
      el('h1.admin-section-title', { text: title }),
      description ? el('p.admin-section-description', { text: description }) : null,
    ]),
    actions.length > 0 ? el('div.admin-section-head__actions', {}, actions) : null,
  ]);
}

/** A horizontally-scrollable table built from a column spec. */
export function dataTable({ columns, rows, rowKey = (row) => row?.id, caption = null }) {
  if (!rows || rows.length === 0) return null;

  const head = el('thead', {}, [
    el(
      'tr',
      {},
      columns.map((column) =>
        el('th', { scope: 'col', className: column.align ? `is-${column.align}` : null }, [
          column.label,
        ])
      )
    ),
  ]);

  const body = el(
    'tbody',
    {},
    rows.map((row) =>
      el('tr', { dataset: { key: String(rowKey(row) ?? '') } }, [
        ...columns.map((column) => {
          const cell = el('td', { className: column.align ? `is-${column.align}` : null });
          const content = column.render ? column.render(row) : row?.[column.key];
          if (content instanceof Node) cell.append(content);
          else cell.textContent = content === null || content === undefined ? '—' : String(content);
          return cell;
        }),
      ])
    )
  );

  return el('div.admin-table-wrap', {}, [
    el('table.admin-table', {}, [caption ? el('caption', { text: caption }) : null, head, body]),
  ]);
}

/** The "nothing here" block. Distinct from an error, which offers a retry. */
export function emptyBlock(title, description = null) {
  return el('div.admin-empty', {}, [
    el('p.admin-empty__title', { text: title }),
    description ? el('p.admin-empty__description', { text: description }) : null,
  ]);
}

/** The "something failed" block, with a retry. */
export function errorBlock(error, onRetry) {
  return el('div.admin-error', { role: 'alert' }, [
    el('p.admin-error__title', { text: 'Could not load this view' }),
    el('p.admin-error__message', {
      text: error?.message ?? 'An unexpected problem stopped this from loading.',
    }),
    onRetry ? button({ label: 'Try again', variant: 'secondary', onClick: onRetry }).element : null,
  ]);
}

/** A loading line. */
export function loadingBlock(message = 'Loading…') {
  return el('p.admin-loading', { role: 'status', text: message });
}

/** A row of inline filter controls. */
export function filterBar(controls) {
  const list = controls.filter(Boolean);
  if (list.length === 0) return null;
  return el('div.admin-filter-bar', {}, list);
}

/** A labelled inline control for a filter bar. */
export function filterField(label, control) {
  return el('label.admin-filter', {}, [el('span.admin-filter__label', { text: label }), control]);
}

/** A `<select>` filter. Options are `{ value, label }`. */
export function filterSelect({ label, value = '', options, onChange, name }) {
  const select = el(
    'select.admin-select',
    { name },
    (options ?? []).map((option) =>
      el('option', {
        value: option.value,
        text: option.label,
        ...(String(option.value) === String(value) ? { selected: true } : {}),
      })
    )
  );
  select.value = value ?? '';
  select.addEventListener('change', () => onChange(select.value));
  return filterField(label, select);
}

/** A text search input. */
export function filterSearch({ label = 'Search', value = '', placeholder = 'Search…', onSubmit }) {
  const input = el('input.admin-input', { type: 'search', placeholder, value });
  input.value = value ?? '';
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit(input.value.trim());
    }
  });
  return filterField(label, input);
}

/** Pagination controls driven by the API's `meta.pagination`. */
export function paginationBar(pagination, onPage) {
  if (!pagination) return null;
  const { page, totalPages, total } = pagination;
  return el('nav.admin-pagination', { 'aria-label': 'Pagination' }, [
    button({
      label: 'Previous',
      variant: 'secondary',
      size: 'sm',
      icon: 'chevron-left',
      disabled: !pagination.hasPreviousPage,
      onClick: () => onPage(page - 1),
    }).element,
    el('p.admin-pagination__status', { text: `Page ${page} of ${totalPages} · ${total} items` }),
    button({
      label: 'Next',
      variant: 'secondary',
      size: 'sm',
      iconEnd: 'chevron-right',
      disabled: !pagination.hasNextPage,
      onClick: () => onPage(page + 1),
    }).element,
  ]);
}

/* -------------------------------------------------------------------------- */
/* Forms                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A single labelled control.
 *
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.label
 * @param {'text'|'email'|'url'|'number'|'textarea'|'select'|'checkbox'|'password'} [options.type]
 * @param {*} [options.value]
 * @param {string} [options.placeholder]
 * @param {boolean} [options.required]
 * @param {string} [options.hint]
 * @param {Array<{value:string,label:string}>} [options.options] for select
 * @param {boolean} [options.optional] when empty, contributes `undefined` rather than ''
 * @returns {{ element: HTMLElement, name: string, control: HTMLElement,
 *             get(): *, set(value:*): void, setError(message:string): void }}
 */
export function formField(options) {
  const {
    name,
    label,
    type = 'text',
    value = '',
    placeholder = '',
    required = false,
    hint = null,
    options: selectOptions = [],
    optional = false,
    attrs = {},
  } = options;

  const id = `admin-field-${(fieldSequence += 1)}`;
  const errorSlot = el('p.admin-field__error', { role: 'alert', hidden: true });
  let control;

  if (type === 'select') {
    control = el(
      'select.admin-input',
      { id, name, required },
      selectOptions.map((option) => el('option', { value: option.value, text: option.label }))
    );
    control.value = value ?? '';
  } else if (type === 'textarea') {
    control = el('textarea.admin-input', {
      id,
      name,
      rows: options.rows ?? 4,
      placeholder,
      required,
    });
    control.value = value ?? '';
  } else if (type === 'checkbox') {
    control = el('input.admin-checkbox', { id, name, type: 'checkbox' });
    control.checked = Boolean(value);
  } else {
    control = el('input.admin-input', { id, name, type, placeholder, required, ...attrs });
    control.value = value ?? '';
  }

  function get() {
    if (type === 'checkbox') return control.checked;
    const raw = control.value;
    if (type === 'number') {
      if (raw === '') return optional ? undefined : null;
      return Number(raw);
    }
    const text = raw.trim();
    if (text === '' && optional) return undefined;
    return text;
  }

  function set(next) {
    if (type === 'checkbox') control.checked = Boolean(next);
    else control.value = next ?? '';
  }

  function setError(message) {
    if (!message) {
      errorSlot.hidden = true;
      errorSlot.textContent = '';
      control.removeAttribute('aria-invalid');
      return;
    }
    errorSlot.hidden = false;
    errorSlot.textContent = message;
    control.setAttribute('aria-invalid', 'true');
  }

  const element = el('div.admin-field', {}, [
    el('label.admin-field__label', { for: id, text: label }),
    control,
    hint ? el('p.admin-field__hint', { text: hint }) : null,
    errorSlot,
  ]);

  return { element, name, control, get, set, setError };
}

/**
 * A form built from field specs, with a submit/cancel footer.
 *
 * `onSubmit(values, form)` may be async; the buttons lock while it runs and the
 * promise it returns decides whether the dialog closes (resolves) or stays open
 * (rejects, with the error shown).
 *
 * @param {object[]} fieldSpecs arguments to `formField`
 * @param {{ onSubmit: Function, submitLabel?: string, onCancel?: Function,
 *           cancelLabel?: string, columns?: 1|2 }} options
 */
export function buildForm(
  fieldSpecs,
  { onSubmit, submitLabel = 'Save', onCancel = null, cancelLabel = 'Cancel', columns = 1 } = {}
) {
  const fields = fieldSpecs.map(formField);
  const byName = new Map(fields.map((field) => [field.name, field]));
  const alertSlot = el('p.admin-form__alert', { role: 'alert', hidden: true });

  const submit = button({ label: submitLabel, variant: 'primary', type: 'submit' });
  const cancel = onCancel
    ? button({ label: cancelLabel, variant: 'ghost', onClick: () => onCancel() })
    : null;

  const formEl = el('form.admin-form', { novalidate: true }, [
    alertSlot,
    el(
      `div.admin-form__grid${columns === 2 ? '.admin-form__grid--two' : ''}`,
      {},
      fields.map((field) => field.element)
    ),
    el('div.admin-form__actions', {}, [cancel?.element, submit.element]),
  ]);

  function clearErrors() {
    alertSlot.hidden = true;
    alertSlot.textContent = '';
    for (const field of fields) field.setError('');
  }

  /** Maps a server 422 `details` array onto the fields it names. */
  function applyServerErrors(error) {
    clearErrors();
    const details = Array.isArray(error?.details) ? error.details : [];
    let matched = false;
    for (const detail of details) {
      const key = Array.isArray(detail?.path) ? detail.path[0] : detail?.field;
      const field = byName.get(key);
      if (field) {
        field.setError(detail.message ?? 'Invalid value');
        matched = true;
      }
    }
    if (!matched) {
      alertSlot.hidden = false;
      alertSlot.textContent = error?.message ?? 'The form could not be saved.';
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearErrors();
    const values = {};
    for (const field of fields) values[field.name] = field.get();

    try {
      await submit.run(async () => {
        await onSubmit(values);
      });
    } catch (error) {
      applyServerErrors(error);
    }
  }

  formEl.addEventListener('submit', handleSubmit);

  return {
    element: formEl,
    fields: byName,
    clearErrors,
    applyServerErrors,
    setAlert(message) {
      alertSlot.hidden = false;
      alertSlot.textContent = message;
    },
    submit: () => handleSubmit(new Event('submit')),
  };
}

/* -------------------------------------------------------------------------- */
/* Dialogs                                                                     */
/* -------------------------------------------------------------------------- */

let dialogOpenCount = 0;

/**
 * Opens a modal dialog.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {Node|Node[]} [options.content]
 * @param {HTMLElement[]} [options.actions]
 * @param {'sm'|'md'|'lg'} [options.size]
 * @param {Function} [options.onClose]
 * @returns {{ element: HTMLElement, close: Function }}
 */
export function openDialog({
  title,
  description = null,
  content = null,
  actions = [],
  size = 'md',
  onClose = null,
}) {
  const titleId = `admin-dialog-title-${(fieldSequence += 1)}`;
  const overlay = el('div.admin-dialog-overlay', { dataset: { size } });
  const dialog = el('div.admin-dialog', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    dialogOpenCount = Math.max(0, dialogOpenCount - 1);
    if (dialogOpenCount === 0) document.body.classList.remove('has-admin-dialog');
    document.removeEventListener('keydown', onKeydown, true);
    onClose?.();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  dialog.append(
    el('header.admin-dialog__head', {}, [
      el('div', {}, [
        el('h2.admin-dialog__title', { id: titleId, text: title }),
        description ? el('p.admin-dialog__description', { text: description }) : null,
      ]),
      button({
        label: 'Close',
        icon: 'close',
        iconOnly: true,
        variant: 'ghost',
        size: 'sm',
        onClick: () => close(),
      }).element,
    ]),
    el('div.admin-dialog__body', {}, Array.isArray(content) ? content : [content]),
    actions.length > 0 ? el('footer.admin-dialog__foot', {}, actions) : null
  );

  overlay.append(dialog);
  document.body.append(overlay);
  dialogOpenCount += 1;
  document.body.classList.add('has-admin-dialog');

  document.addEventListener('keydown', onKeydown, true);
  focusFirst(dialog);

  return {
    element: dialog,
    close,
    setContent(node) {
      clear(dialog.querySelector('.admin-dialog__body'));
      dialog.querySelector('.admin-dialog__body').append(node);
    },
  };
}

/** A yes/no confirmation. Resolves `true` only when the primary action is taken. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'danger' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const controller = openDialog({
      title,
      content: el('p.admin-dialog__message', { text: message }),
      size: 'sm',
      onClose: () => finish(false),
      actions: [
        button({
          label: 'Cancel',
          variant: 'ghost',
          onClick: () => {
            finish(false);
            controller.close();
          },
        }).element,
        button({
          label: confirmLabel,
          variant: tone === 'danger' ? 'danger' : 'primary',
          onClick: () => {
            finish(true);
            controller.close();
          },
        }).element,
      ],
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

let toastRegion = null;

/** Raises a transient notification. `tone` is `success` / `error` / `info`. */
export function notify(message, tone = 'info') {
  if (!toastRegion) {
    toastRegion = el('div.admin-toasts', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRegion);
  }
  const node = el('div.admin-toast', { className: `admin-toast--${tone}`, text: message });
  toastRegion.append(node);
  setTimeout(() => node.remove(), 4000);
}

export default {
  card,
  statCard,
  toneBadge,
  sectionHeading,
  dataTable,
  emptyBlock,
  errorBlock,
  loadingBlock,
  filterBar,
  filterField,
  filterSelect,
  filterSearch,
  paginationBar,
  formField,
  buildForm,
  openDialog,
  confirmDialog,
  notify,
};
