/**
 * Registration page.
 *
 * The mirror of sign-in: the same scaffold, the same form component in
 * `register` mode. The component adds the name fields and the password rules;
 * this page only decides where registration takes the shopper.
 */
import { el } from '../core/dom.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { authForm, authCopy } from '../components/forms/auth-form.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.auth
 * @returns {{ destroy(): void }}
 */
export default function registerPage({ host, auth }) {
  document.title = 'Create your account - Aster & Oak';
  const shell = el('div.container');
  host.replaceChildren(shell);

  const redirect = redirectQuery();
  const form = authForm({
    mode: 'register',
    auth,
    redirect,
    onSuccess: () => {
      globalThis.location.assign(redirect || '/account.html');
    },
  });

  shell.append(
    breadcrumb([{ label: 'Register' }]),
    el('div.auth-grid', {}, [authCopy(), form.element])
  );

  return {
    destroy() {
      form.destroy();
    },
  };
}

/** The `?redirect=` target, validated to a same-site path so it cannot be a
 *  phishing leave. */
function redirectQuery() {
  const raw = new URLSearchParams(globalThis.location?.search ?? '').get('redirect');
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '';
}
