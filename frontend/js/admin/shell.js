/**
 * Admin console — shell and routing.
 *
 * The console is a small hash-routed single-page app: a persistent sidebar and
 * top bar, and one section rendered into the main region at a time. Hash routing
 * rather than the storefront's page-per-HTML model because the console is a tool
 * — an operator moves between lists and detail views constantly, and reloading
 * the whole shell for each move would throw away their place.
 *
 * The shell owns exactly two things: the chrome, and deciding which section
 * module renders. Each section module owns its own data, filters and dialogs.
 */
import { el, clear } from '../core/dom.js';
import { icon } from '../utils/icons.js';
import { button } from '../components/ui/button.js';
import { ADMIN_SECTIONS, parseRoute, buildRoute, sectionTitle } from './helpers.js';
import { createAdminApi } from './api.js';
import { renderSection } from './sections.js';

/**
 * @param {object} options
 * @param {object} options.auth the auth store (for the operator's identity)
 * @param {object} [options.client] transport, injectable for tests
 * @returns {{ element: HTMLElement, start(): void, destroy(): void }}
 */
export function createAdminShell({ auth, client }) {
  const api = createAdminApi(client);
  const user = auth.selectUser() ?? {};

  const navLinks = new Map();
  const nav = el(
    'nav.admin-nav',
    { 'aria-label': 'Admin sections' },
    ADMIN_SECTIONS.map((section) => {
      const link = el(
        'a.admin-nav__link',
        {
          href: buildRoute(section.id),
          dataset: { section: section.id },
        },
        [
          el('span.admin-nav__icon', { 'aria-hidden': 'true' }, [icon(section.icon)]),
          el('span.admin-nav__label', { text: section.label }),
        ]
      );
      navLinks.set(section.id, link);
      return link;
    })
  );

  const scrim = el('div.admin-scrim', { hidden: true });
  const sidebar = el('aside.admin-sidebar', { id: 'admin-sidebar' }, [
    el('div.admin-sidebar__brand', {}, [
      el('span.admin-sidebar__mark', { 'aria-hidden': 'true' }, [icon('shield')]),
      el('span.admin-sidebar__name', {}, [
        el('span.admin-sidebar__store', { text: 'Aster & Oak' }),
        el('span.admin-sidebar__role', { text: 'Store admin' }),
      ]),
    ]),
    nav,
    el('div.admin-sidebar__foot', {}, [
      el('p.admin-sidebar__signed-in', {
        text: `Signed in as ${user.name ?? user.email ?? 'admin'}`,
      }),
      button({
        label: 'Sign out',
        variant: 'ghost',
        size: 'sm',
        icon: 'log-out',
        onClick: () => {
          void auth.signOut().then(() => {
            globalThis.location.assign('/login.html?redirect=/admin.html');
          });
        },
      }).element,
    ]),
  ]);

  const toggle = button({
    label: 'Toggle navigation',
    icon: 'menu',
    iconOnly: true,
    variant: 'ghost',
    onClick: () => {
      sidebar.classList.toggle('is-open');
      scrim.hidden = !sidebar.classList.contains('is-open');
    },
  }).element;
  toggle.classList.add('admin-sidebar-toggle');

  const titleNode = el('span.admin-topbar__title', { text: 'Dashboard' });

  const topbar = el('header.admin-topbar', {}, [
    toggle,
    titleNode,
    el('div.admin-topbar__actions', {}, [
      el('a.admin-topbar__link', { href: '/index.html' }, [
        el('span', { 'aria-hidden': 'true' }, [icon('arrow-up-right')]),
        el('span', { text: 'View store' }),
      ]),
      el('div.admin-topbar__user', {}, [
        el('span.admin-topbar__avatar', { 'aria-hidden': 'true', text: initials(user.name) }),
        el('span.admin-topbar__identity', {}, [
          el('span.admin-topbar__name', { text: user.name ?? 'Administrator' }),
          el('span.admin-topbar__email', { text: user.email ?? '' }),
        ]),
      ]),
    ]),
  ]);

  const content = el('main.admin-main__content', { id: 'admin-content', tabindex: '-1' });

  const element = el('div.admin', {}, [
    sidebar,
    scrim,
    el('div.admin-main', {}, [topbar, content]),
  ]);

  scrim.addEventListener('click', () => {
    sidebar.classList.remove('is-open');
    scrim.hidden = true;
  });

  let destroying = false;

  function setActive(section) {
    for (const [id, link] of navLinks) {
      const active = id === section;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  async function render(route) {
    setActive(route.section);
    titleNode.textContent = sectionTitle(route.section);
    document.title = `${sectionTitle(route.section)} · Admin · Aster & Oak`;
    sidebar.classList.remove('is-open');
    scrim.hidden = true;
    clear(content);
    content.setAttribute('aria-busy', 'true');

    const controller = await renderSection(route, {
      api,
      auth,
      host: content,
      navigate: (section, id = null) => {
        const next = buildRoute(section, id);
        if (globalThis.location.hash === next) void render(parseRoute(next));
        else globalThis.location.hash = next;
      },
      reload: () => render(parseRoute(globalThis.location.hash)),
    });

    content.removeAttribute('aria-busy');
    return controller;
  }

  async function onHashChange() {
    if (destroying) return;
    await render(parseRoute(globalThis.location.hash));
  }

  function start() {
    if (!globalThis.location.hash) globalThis.location.hash = buildRoute('dashboard');
    globalThis.addEventListener('hashchange', onHashChange);
    void render(parseRoute(globalThis.location.hash));
  }

  function destroy() {
    destroying = true;
    globalThis.removeEventListener('hashchange', onHashChange);
  }

  return { element, start, destroy };
}

function initials(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'A';
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export default { createAdminShell };
