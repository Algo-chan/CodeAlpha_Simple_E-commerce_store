/**
 * Product gallery.
 *
 * One set of markup, two behaviours, chosen in CSS rather than in JS:
 *
 *   MOBILE   `.gallery__track` is a native scroll-snap container. Selecting an
 *            image scrolls it; dots report the scroll position.
 *   DESKTOP  `.gallery__track` becomes a grid showing one slide, and the
 *            thumbnail rail selects it by `data-active`.
 *
 * JavaScript only has to know one thing: which index is current. Everything
 * else - momentum, trackpad support, keyboard scrolling of the track - comes from
 * the platform, which is strictly better than a hand-written swipe handler.
 *
 * The hover zoom is pure CSS (a second copy of the image under a transform), so
 * there is no canvas work and no image re-fetch when the pointer moves. The
 * pointer position is written to `--zoom-x` / `--zoom-y` so the magnified region
 * follows the cursor.
 */
import { el, on, prefersReducedMotion, getFocusable, focus } from '../../core/dom.js';
import { lockScroll } from '../../utils/scroll-lock.js';
import { button } from '../ui/button.js';
import { badgeStack } from '../ui/badge.js';

let sequence = 0;

/**
 * @param {object} options
 * @param {Array<{url:string, thumb_url?:string, alt?:string, angle?:string}>} options.images
 * @param {string[]} [options.badges]
 * @param {boolean} [options.zoomable]
 * @returns {{ element: HTMLElement, getIndex: () => number, goTo: (index:number)=>void,
 *             destroy: () => void }}
 */
export function productGallery({ images = [], badges = [], zoomable = true } = {}) {
  sequence += 1;
  const id = `gallery-${sequence}`;

  // A gallery with no images still needs one frame, or the stage collapses and
  // the page reflows when the real images arrive.
  const frames = images.length > 0 ? images : [{ url: '', alt: '' }];
  const multiple = frames.length > 1;
  const stageId = `${id}-stage`;

  let index = 0;

  /* --- Frames -------------------------------------------------------------- */

  const slides = frames.map((frame, position) =>
    el(
      'div.gallery__slide',
      {
        role: 'group',
        'aria-roledescription': 'slide',
        'aria-label': `${position + 1} of ${frames.length}`,
        dataset: { active: String(position === 0), index: String(position) },
      },
      [
        imageNode(frame, 'gallery__image gallery__image--primary', position === 0),
        // The zoom copy is aria-hidden and only exists for the hover lens; a
        // screen reader reading the same alt twice would say the product name
        // twice for every frame.
        zoomNode(frame),
      ]
    )
  );

  const track = el('div.gallery__track', { id: `${id}-track` }, slides);

  /* --- Stage --------------------------------------------------------------- */

  const zoomToggle = button({
    label: 'View image full screen',
    variant: 'ghost',
    icon: 'zoom',
    iconOnly: true,
    className: 'gallery__zoom-toggle',
    onClick: () => openFullscreen(),
  }).element;

  const stage = el(
    // `is-zoomable` is the CSS hook for the hover lens. It is only present when
    // there is something to zoom into and the pointer is the primary input.
    `div.gallery__stage${zoomable ? '.is-zoomable' : ''}`,
    {
      id: stageId,
      tabindex: zoomable ? '0' : null,
      ...(zoomable ? { role: 'group', 'aria-roledescription': 'image viewer' } : {}),
    },
    [
      track,
      badges.length > 0 ? el('div.gallery__badges', {}, [badgeStack(badges)]) : null,
      zoomable ? zoomToggle : null,
    ]
  );

  /* --- Dots (mobile) and thumbnails (desktop) ------------------------------ */

  const dots = multiple
    ? el(
        'div.gallery__dots',
        { role: 'tablist', 'aria-label': 'Choose image' },
        frames.map((_, position) =>
          el('button.gallery__dot', {
            type: 'button',
            'aria-label': `Image ${position + 1}`,
            'aria-current': String(position === 0),
            onClick: () => goTo(position),
          })
        )
      )
    : null;

  const thumbs = multiple
    ? el(
        'div.gallery__thumbs',
        { role: 'group', 'aria-label': 'Product images' },
        frames.map((frame, position) =>
          el(
            'button.gallery__thumb',
            {
              type: 'button',
              'aria-label': `Show image ${position + 1}`,
              'aria-current': String(position === 0),
              // `prefers-reduced-motion` is checked here rather than at module
              // load: a shopper can change the OS setting while the page is open.
              onClick: () => goTo(position),
            },
            [imageNode(frame, 'gallery__image', position === 0, true)]
          )
        )
      )
    : null;

  const element = el('div.gallery', { dataset: { gallery: id } }, [
    thumbs,
    el('div.gallery__main', {}, [stage, dots]),
  ]);

  /* --- Behaviour ----------------------------------------------------------- */

  const cleanups = [];

  if (multiple) {
    // On mobile the track is the scroller, so the dots have to follow it rather
    // than drive it. On desktop this listener never fires: the track is a grid
    // with one visible slide and no overflow.
    cleanups.push(
      on(
        track,
        'scroll',
        () => {
          // Guarded denominator. `scrollLeft / clientWidth || 1` looks safe but is
          // not: at scrollLeft 0 the division is 0, and `0 || 1` turns the first
          // slide into slide two.
          const width = track.clientWidth || 1;
          const position = Math.round(track.scrollLeft / width);
          sync(Math.min(Math.max(position, 0), images.length - 1), { scroll: false });
        },
        { passive: true }
      )
    );

    // Arrow keys move between images. On desktop the stage is the focusable
    // element (not the track, which is not scrollable there).
    cleanups.push(
      on(stage, 'keydown', (event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          goTo(index + 1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          goTo(index - 1);
        } else if (event.key === 'Enter' && event.target === stage) {
          event.preventDefault();
          openFullscreen();
        }
      })
    );
  }

  if (zoomable) {
    // The magnified region follows the pointer. Written as two custom properties
    // so the transform origin is a pure CSS concern.
    cleanups.push(
      on(stage, 'pointermove', (event) => {
        if (prefersReducedMotion()) return;
        const box = stage.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width) * 100;
        const y = ((event.clientY - box.top) / box.height) * 100;
        stage.style.setProperty('--zoom-x', `${x.toFixed(1)}%`);
        stage.style.setProperty('--zoom-y', `${y.toFixed(1)}%`);
      })
    );

    // Click to pin the zoom, so a shopper inspecting fabric can move the pointer
    // away to read the caption without losing the magnified view.
    cleanups.push(
      on(stage, 'click', (event) => {
        if (event.target === zoomToggle || zoomToggle.contains(event.target)) return;
        stage.classList.toggle('is-zoomed');
      })
    );
  }

  /* --- Fullscreen ---------------------------------------------------------- */

  let lightbox = null;
  let unlockScroll = null;

  /**
   * The lightbox is created on demand and removed on close, rather than being
   * built up front and hidden. A `display: none` fullscreen viewer still costs
   * layout work in some engines, and there is usually one image.
   */
  function openFullscreen() {
    if (lightbox) return;

    const counter = el('div.gallery-fullscreen__counter', {
      text: `${index + 1} / ${frames.length}`,
    });

    const image = el('img.gallery-fullscreen__image', {
      src: frames[index].url,
      alt: frames[index].alt ?? '',
    });

    const closeButton = button({
      label: 'Close full screen view',
      variant: 'ghost',
      icon: 'close',
      iconOnly: true,
      className: 'gallery-fullscreen__close',
      onClick: () => closeFullscreen(),
    }).element;

    const prev = button({
      label: 'Previous image',
      variant: 'ghost',
      icon: 'arrow-left',
      iconOnly: true,
      className: 'gallery-fullscreen__nav gallery-fullscreen__nav--prev',
      onClick: () => step(-1),
    }).element;

    const next = button({
      label: 'Next image',
      variant: 'ghost',
      icon: 'arrow-right',
      iconOnly: true,
      className: 'gallery-fullscreen__nav gallery-fullscreen__nav--next',
      onClick: () => step(1),
    }).element;

    const region = el(
      'div.gallery-fullscreen',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Product image, full screen',
      },
      [image, closeButton, counter, multiple ? prev : null, multiple ? next : null]
    );

    lightbox = {
      element: region,
      image,
      counter,
      cleanups: [
        on(region, 'click', (event) => {
          // Backdrop dismissal. The check matters because the region fills the
          // viewport and the image covers most of it - without it, clicking the
          // photo to close it would be impossible.
          if (event.target === region || event.target === image) closeFullscreen();
        }),
        on(region, 'keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeFullscreen();
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            step(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            step(-1);
          } else if (event.key === 'Tab') {
            // Three controls at most, so a cycle is enough to keep Tab inside.
            const focusable = getFocusable(region);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              focus(last);
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              focus(first);
            }
          }
        }),
      ],
      restoreTo: document.activeElement,
    };

    document.body.append(region);
    // Reference counted, so opening the quick view while a lightbox is open does
    // not unlock the page when only one of the two closes.
    unlockScroll = lockScroll();

    // The `is-open` class drives the fade, so it is added after the node is in
    // the document; adding both in the same frame skips the transition entirely.
    requestAnimationFrame(() => region.classList.add('is-open'));
    focus(closeButton);
  }

  function step(delta) {
    goTo((index + delta + frames.length) % frames.length);
    if (!lightbox) return;
    lightbox.image.src = frames[index].url;
    lightbox.image.alt = frames[index].alt ?? '';
    lightbox.counter.textContent = `${index + 1} / ${frames.length}`;
  }

  function closeFullscreen() {
    if (!lightbox) return;
    const { element: region, cleanups: stop, restoreTo } = lightbox;
    lightbox = null;

    for (const fn of stop) fn();
    unlockScroll?.();
    unlockScroll = null;

    // `is-closing` keeps the element in the tree for the length of the fade.
    // Without a transition listener the node would be pulled mid-animation and
    // the fade would never be seen at all.
    region.classList.remove('is-open');
    region.classList.add('is-closing');

    const remove = () => region.remove();
    if (prefersReducedMotion()) remove();
    else region.addEventListener('transitionend', remove, { once: true });

    // Belt and braces: if the transition never fires (a backgrounded tab, a
    // cancelled animation) the element must still go.
    setTimeout(() => region.isConnected && remove(), 400);

    focus(restoreTo);
  }

  /* --- Selection ----------------------------------------------------------- */

  function goTo(target) {
    const clamped = Math.min(Math.max(target, 0), frames.length - 1);
    sync(clamped, { scroll: true });
  }

  function sync(position, { scroll }) {
    index = position;

    for (const [offset, slide] of slides.entries()) {
      slide.dataset.active = String(offset === position);
    }

    if (scroll && track.scrollWidth > track.clientWidth) {
      track.scrollTo({
        left: position * track.clientWidth,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }

    for (const [offset, dot] of Array.from(dots?.children ?? []).entries()) {
      dot.setAttribute('aria-current', String(offset === position));
    }

    for (const [offset, thumb] of Array.from(thumbs?.children ?? []).entries()) {
      thumb.setAttribute('aria-current', String(offset === position));
    }
  }

  return {
    element,
    getIndex: () => index,
    goTo,
    destroy() {
      for (const fn of cleanups) fn();
      closeFullscreen();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One image, loaded lazily.
 *
 * The first frame is `eager` because it is the Largest Contentful Paint element
 * - deferring it would make the product page look slower than it is. The rest
 * wait until they are near the viewport.
 */
function imageNode(frame, className, isPrimary, isThumb = false) {
  return el('img', {
    className,
    src: frame.url,
    alt: isThumb ? '' : (frame.alt ?? ''),
    // A thumbnail carries no information the stage does not already carry, so
    // it gets an empty alt and the button's own label names it instead.
    loading: isPrimary ? 'eager' : 'lazy',
    decoding: 'async',
    width: isThumb ? null : '1200',
    height: isThumb ? null : '1500',
    fetchpriority: isPrimary ? 'high' : null,
  });
}

/** The second copy that appears under the hover lens. */
function zoomNode(frame) {
  return el('img.gallery__image.gallery__image--zoom', {
    src: frame.url,
    alt: '',
    'aria-hidden': 'true',
    loading: 'lazy',
    decoding: 'async',
  });
}

export default { productGallery };
