/**
 * Announcement bar.
 *
 * Rotates through a small set of messages. Rotating content in a strip that is
 * always on screen is a real accessibility hazard, so:
 *   - the rotation pauses on hover and on focus, and when the tab is hidden;
 *   - the whole strip is `aria-live="off"`, because a message that changes
 *     itself every six seconds would otherwise interrupt a screen reader
 *     mid-sentence;
 *   - dots are real buttons, so the rotation is controllable rather than
 *     something that just happens to the shopper.
 *
 * It also stops entirely under `prefers-reduced-motion`, showing the first
 * message only. Motion in a peripheral strip is not information.
 */
import { el, on, prefersReducedMotion } from '../../core/dom.js';

const DEFAULT_MESSAGES = [
  { text: 'Free delivery on orders over ETB 5,000', href: '/collection.html' },
  { text: '30-day returns on everything', href: '/collection.html' },
  { text: 'Digital downloads delivered instantly', href: '/collection.html?category=digital-downloads' },
];

const ROTATION_MS = 6000;

export function createAnnouncement(messages = DEFAULT_MESSAGES) {
  const items = messages.length > 0 ? messages : DEFAULT_MESSAGES;

  const messageNode = el('div.announcement__message', { 'aria-live': 'off' });
  const dots = el('div.announcement__dots', { role: 'tablist', 'aria-label': 'Announcements' });

  const dotButtons = items.map((_message, index) =>
    el('button.announcement__dot', {
      type: 'button',
      role: 'tab',
      'aria-current': index === 0 ? 'true' : 'false',
      'aria-label': `Message ${index + 1} of ${items.length}`,
      onclick: () => {
        show(index);
        restart();
      },
    })
  );
  dots.append(...dotButtons);

  const element = el('div.announcement', {}, [
    el('div.announcement__inner', {}, [messageNode, items.length > 1 ? dots : null]),
  ]);

  let index = 0;
  let timer = null;

  function show(next) {
    index = (next + items.length) % items.length;
    const message = items[index];

    messageNode.replaceChildren();
    if (message.href) {
      messageNode.append(
        el('a', {
          href: message.href,
          text: message.text,
          onClick: () => pause(),
        })
      );
    } else {
      messageNode.textContent = message.text;
    }

    dotButtons.forEach((dot, dotIndex) => {
      dot.setAttribute('aria-current', dotIndex === index ? 'true' : 'false');
    });
  }

  function play() {
    if (items.length < 2 || prefersReducedMotion()) return;
    timer = setInterval(() => show(index + 1), ROTATION_MS);
  }

  function pause() {
    clearInterval(timer);
    timer = null;
  }

  function restart() {
    pause();
    play();
  }

  const cleanups = [
    on(element, 'mouseenter', pause),
    on(element, 'mouseleave', play),
    // Focus can land inside without hover, on a keyboard.
    on(element, 'focusin', pause),
    on(element, 'focusout', play),
    // Rotating while the tab is in the background is wasted work, and on return
    // the shopper is met mid-transition.
    on(document, 'visibilitychange', () => (document.hidden ? pause() : play())),
  ];

  show(0);
  play();

  element.destroy = () => {
    pause();
    cleanups.forEach((fn) => fn());
  };

  return element;
}

export default { createAnnouncement };