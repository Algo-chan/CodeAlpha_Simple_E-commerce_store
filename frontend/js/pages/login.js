/**
 * Sign in page.
 *
 * A thin scaffold around `authForm`: the breadcrumb, the two-column layout and
 * where to go on success. All form behaviour lives in the component, so the
 * sign-in and registration pages cannot drift apart.
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
export default function loginPage({ host, auth }) {
  document.title = 'Sign in - Aster & Oak';
  const shell = el('div.container');
  host.replaceChildren(shell);

  const redirect = redirectQuery();
  const form = authForm({
    mode: 'login',
    auth,
    redirect,
    onSuccess: () => {
      globalThis.location.assign(redirect || '/account.html');
    },
  });

  shell.append(
    breadcrumb([{ label: 'Sign in' }]),
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
