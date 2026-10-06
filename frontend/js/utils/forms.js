/**
 * Form helpers shared by the auth and account flows.
 *
 * Both surfaces do the same two things the rest of the storefront does not:
 * submit a field set to the API and turn a schema error into per-field errors.
 * `field()` already handles the painting; these two helpers handle the mapping
 * and the banner, so login, registration and the account forms cannot drift
 * into different ways of showing the same error.
 */
import { el } from '../core/dom.js';
import { icon } from './icons.js';

/**
 * A form-level alert banner, focusable so it can be moved to when a generic
 * server error (not a field error) stops the submit.
 *
 * @param {string} message
 * @param {{ variant?: 'error'|'success'|'info'|'warning' }} [options]
 * @returns {HTMLElement}
 */
export function formAlert(message, { variant = 'error' } = {}) {
  return el(
    'p.form-alert',
    {
      className: `form-alert--${variant}`,
      role: variant === 'error' ? 'alert' : 'status',
      tabindex: '-1',
    },
    [icon(variant === 'error' ? 'alert-circle' : 'check-circle'), message]
  );
}

/**
 * Applies an API validation error onto matching fields.
 *
 * The backend reports 422 errors as `details.errors` where each item has a
 * `path` (e.g. `["email"]`) and a `message`. Match is by the first path
 * segment, so the login form's `email` field catches the schema's `email`
 * error even though the page never validates like the server does.
 *
 * @param {Record<string, { setError: (msg: string) => void }>} fields
 * @param {{ details?: { errors?: Array<{ path?: (string|number)[], message: string }> } }|null} error
 * @returns {string|null} the first field name an error was applied to, or null
 */
export function applyApiFieldErrors(fields, error) {
  const errors = error?.details?.errors;
  if (!Array.isArray(errors)) return null;

  let firstApplied = null;
  for (const item of errors) {
    const key = item?.path?.[0];
    if (typeof key !== 'string') continue;
    const target = fields[key];
    if (target && typeof target.setError === 'function') {
      target.setError(item.message);
      firstApplied ??= key;
    }
  }

  return firstApplied;
}

/**
 * The first rule a password breaks, or null when it satisfies the backend's
 * requirements. Checked client-side so a shopper hears about it before a
 * round-trip, but the server is still the authority.
 *
 * @param {string} password
 * @returns {string|null}
 */
export function passwordIssue(password) {
  if (!password) return 'Enter a password.';
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(password)) return 'Add a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Add an uppercase letter.';
  if (!/\d/.test(password)) return 'Add a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add a symbol, like ! or #.';
  return null;
}

/**
 * Validates a phone number against the backend rule (digits only, an optional
 * leading +, 9-15 total). Returns a message, or null when the number is fine.
 *
 * @param {string} phone
 * @returns {string|null}
 */
export function phoneIssue(phone) {
  const value = phone.trim();
  if (!value) return 'Enter a phone number.';
  if (!/^\+?[0-9]{9,15}$/.test(value)) {
    return 'Use 9-15 digits, e.g. 0911000000 or +251911000000.';
  }
  return null;
}

export default { formAlert, applyApiFieldErrors, passwordIssue, phoneIssue };
