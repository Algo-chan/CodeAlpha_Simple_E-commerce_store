/**
 * Deferred webfont loading.
 *
 * Every page links the Google Fonts stylesheet with `media="print"` so the
 * browser fetches it without blocking the first paint; the swap to `media="all"`
 * once it has loaded is what actually applies the face. That swap used to be an
 * inline `onload` attribute, which the production Content-Security-Policy
 * forbids (`script-src-attr 'none'`). Moving it into this module keeps the
 * policy strict while preserving exactly the same loading behaviour.
 *
 * `link.sheet` is the synchronous path: if the stylesheet finished loading
 * before this module ran (a warm cache), the media query is flipped immediately
 * rather than waiting for an event that has already fired.
 */
export function loadDeferredFonts() {
  for (const link of document.querySelectorAll('link[data-font-stylesheet]')) {
    if (link.sheet) {
      link.media = 'all';
      continue;
    }

    link.addEventListener(
      'load',
      () => {
        link.media = 'all';
      },
      { once: true }
    );
  }
}

export default loadDeferredFonts;
