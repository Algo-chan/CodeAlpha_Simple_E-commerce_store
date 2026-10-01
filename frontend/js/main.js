/**
 * Frontend entry point.
 *
 * Responsibilities:
 *  1. Load shared partials (Navbar, Footer) into their mount points
 *  2. Boot the current page module
 *
 * Convention: every HTML page ends with
 *   <script type="module" src="/js/main.js" data-page="home"></script>
 * and the `data-page` value selects which module in `js/pages/` runs.
 */
import { loadPartial, qs } from './core/dom.js';

/** Modules in `js/pages/` keyed by the `data-page` attribute. */
const pages = {
  home: () => import('./pages/home.js'),
};

async function loadPartials() {
  const partials = [
    { url: '/partials/navbar.html', selector: '[data-partial="navbar"]' },
    { url: '/partials/footer.html', selector: '[data-partial="footer"]' },
  ];

  await Promise.all(
    partials.map(async ({ url, selector }) => {
      const target = qs(selector);
      if (!target) return;
      try {
        await loadPartial(url, target);
      } catch (error) {
        console.warn(`[partials] ${error.message}`);
      }
    })
  );
}

async function boot() {
  const script = document.querySelector('script[data-page]');
  const pageName = script?.dataset.page ?? 'home';

  await loadPartials();

  const loadPage = pages[pageName];
  if (!loadPage) {
    console.warn(`[boot] No page module named "${pageName}".`);
    return;
  }

  try {
    const module = await loadPage();
    await module.default?.();
  } catch (error) {
    console.error(`[boot] Failed to start page "${pageName}":`, error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
