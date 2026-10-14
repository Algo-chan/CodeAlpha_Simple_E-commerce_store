/**
 * Admin console — entry point and access gate.
 *
 * A dedicated entry, deliberately separate from the storefront's `app.js`. The
 * shopper shell (header, footer, cart drawer, search) is wrong for an operator
 * tool and none of it is built here; `/admin.html` loads only this module.
 *
 * THE GUARD HERE IS NOT A SECURITY BOUNDARY. It asks the server who the visitor
 * is and, if the answer is not an administrator, declines to build the console.
 * That is a courtesy, not a control: every `/api/v1/admin/*` endpoint re-checks
 * the session and role server-side, so a visitor who edits the DOM or calls the
 * API by hand still gets a 401/403. The gate exists so an ordinary customer is
 * not shown an empty console and a network of failing requests.
 */
import { el, qs, clear } from '../core/dom.js';
import { loadDeferredFonts } from '../core/fonts.js';
import { icon } from '../utils/icons.js';
import { button } from '../components/ui/button.js';
import { createAuthStore, AUTH_STATUS } from '../state/auth.js';
import { createAdminShell } from './shell.js';

const root = qs('#admin-root');

/** A centered card used for every "not the console" state: loading, denied, down. */
function gate({ iconName, title, body, actions = [] }) {
  return el('div.admin-gate', {}, [
    el('div.admin-gate__card', {}, [
      iconName ? el('span.admin-gate__icon', { 'aria-hidden': 'true' }, [icon(iconName)]) : null,
      el('h1.admin-gate__title', { text: title }),
      el('p.admin-gate__body', { text: body }),
      actions.length > 0 ? el('div.admin-gate__actions', {}, actions) : null,
    ]),
  ]);
}

function render(node) {
  if (root) root.replaceChildren(node);
}

function showLoading() {
  render(
    gate({
      title: 'Checking your access',
      body: 'Confirming this session before opening the console…',
    })
  );
}

function showDenied(user) {
  render(
    gate({
      iconName: 'lock',
      title: 'Administrator access required',
      body: user
        ? 'This account does not have access to the admin console.'
        : 'Sign in with an administrator account to manage the store.',
      actions: [
        button({
          label: 'Sign in',
          href: '/login.html?redirect=/admin.html',
          variant: 'primary',
        }).element,
        button({ label: 'Back to store', href: '/index.html', variant: 'ghost' }).element,
      ],
    })
  );
}

function showUnavailable() {
  render(
    gate({
      iconName: 'alert-triangle',
      title: 'The console could not start',
      body: 'We could not reach the store to verify your session. Check the connection and try again.',
      actions: [
        button({
          label: 'Try again',
          variant: 'primary',
          onClick: () => globalThis.location.reload(),
        }).element,
      ],
    })
  );
}

async function start() {
  if (!root) return;

  showLoading();

  const auth = createAuthStore();
  const user = await auth.refresh();

  if (auth.selectStatus() === AUTH_STATUS.FAILURE) {
    showUnavailable();
    return;
  }

  if (!user || user.role !== 'ADMIN') {
    showDenied(user);
    return;
  }

  const shell = createAdminShell({ auth });
  clear(root);
  root.append(shell.element);
  shell.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  void start();
}

// The font stylesheets load with `media="print"`; applying them here keeps the
// load non-blocking under a Content-Security-Policy that forbids inline handlers.
loadDeferredFonts();
