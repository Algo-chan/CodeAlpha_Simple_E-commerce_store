/**
 * Skeleton placeholders.
 *
 * Skeletons mirror the shape of the content they replace, so the layout does
 * not jump when real data arrives. That is the entire reason they exist: a
 * spinner says "wait", a skeleton says "this is roughly what you are getting".
 *
 * Two details that are usually wrong:
 *   - `aria-hidden="true"`. A screen reader should not read sixteen grey bars.
 *     The loading state is announced once, by the region's live message.
 *   - The shimmer is disabled under `prefers-reduced-motion`, and the blocks
 *     still show their shape rather than disappearing.
 */
import { el } from '../../core/dom.js';

/**
 * @param {{ variant?: 'text'|'title'|'circle'|'pill', width?: string,
 *           className?: string }} [options]
 */
export function skeleton({ variant = 'text', width, className } = {}) {
  const node = el(`span.skeleton.skeleton--${variant}`, {
    'aria-hidden': 'true',
    ...(width ? { style: `inline-size:${width}` } : {}),
    ...(className ? { className } : {}),
  });
  if (variant === 'text' && !width) node.style.inlineSize = '100%';
  return node;
}

/**
 * A stack of text lines, the last one optionally shorter - the ragged right
 * edge is what makes a skeleton read as text rather than as a loading bar.
 * @param {{ lines?: number, lastLine?: 'full'|'short', size?: 'sm'|'xs' }} [options]
 */
export function skeletonText({ lines = 3, lastLine = 'short', size = 'sm' } = {}) {
  return el(
    `div.skeleton-stack.skeleton-stack--${size}`,
    { 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_value, index) =>
      skeleton({
        width: index === lines - 1 && lastLine === 'short' ? '60%' : undefined,
      })
    )
  );
}

/** A product card shaped like the real one, so the grid does not reflow. */
export function skeletonCard() {
  return el('div.skeleton-card', { 'aria-hidden': 'true' }, [
    el('div.skeleton-card__media.skeleton', {}),
    el('div.skeleton-card__body', {}, [
      skeleton({ variant: 'text', width: '35%' }),
      skeleton({ variant: 'title', width: '85%' }),
      skeleton({ variant: 'text', width: '45%' }),
      el('div.skeleton-row', {}, [skeleton({ variant: 'title', width: '40%' })]),
    ]),
  ]);
}

/**
 * A grid of card skeletons.
 * @param {number} [count]
 */
export function skeletonGrid(count = 8) {
  return el(
    'div.product-grid.product-grid--loading',
    { 'aria-hidden': 'true' },
    Array.from({ length: count }, () => skeletonCard())
  );
}

/** A cart drawer with line-item placeholders. */
export function skeletonCart(count = 2) {
  return el(
    'div.skeleton-stack',
    { 'aria-hidden': 'true' },
    Array.from({ length: count }, () =>
      el('div.skeleton-line-item', {}, [
        el('div.skeleton-line-item__media.skeleton', {}),
        el('div.skeleton-stack.skeleton-stack--sm', {}, [
          skeleton({ width: '70%' }),
          skeleton({ width: '40%' }),
        ]),
      ])
    )
  );
}

/** A gallery with a main image and thumbnails. */
export function skeletonGallery(thumbnails = 4) {
  return el('div.skeleton-gallery', { 'aria-hidden': 'true' }, [
    el('div.skeleton-gallery__main.skeleton', {}),
    el(
      'div.skeleton-gallery__thumbs',
      {},
      Array.from({ length: thumbnails }, () => el('div.skeleton-gallery__thumb.skeleton', {}))
    ),
  ]);
}

/** A full page: title block plus a card grid. */
export function skeletonPage({ heading = true, cards = 8 } = {}) {
  return el('div.skeleton-page', { 'aria-hidden': 'true' }, [
    heading
      ? el('div.skeleton-cluster', {}, [skeleton({ variant: 'title', width: '18rem' })])
      : null,
    skeletonGrid(cards),
  ]);
}

export default {
  skeleton,
  skeletonText,
  skeletonCard,
  skeletonGrid,
  skeletonCart,
  skeletonGallery,
  skeletonPage,
};
