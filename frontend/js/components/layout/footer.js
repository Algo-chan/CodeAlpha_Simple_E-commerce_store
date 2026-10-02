/**
 * Site footer.
 *
 * Declarative from a link-group table rather than bespoke markup, so adding a
 * page is a one-line change and the groups cannot drift out of alignment.
 *
 * Payment methods and the newsletter are the two parts that need honesty:
 * payment marks are text, not scraped logos, and the newsletter form is
 * explicitly inert with a stated reason - a form that silently does nothing is
 * worse than one that admits it is not wired up yet.
 */
import { el, on } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { config } from '../../config.js';
import { field } from '../forms/field.js';
import { button } from '../ui/button.js';

/** Footer link groups. Pages that do not exist yet are omitted rather than
 *  linked to a 404. */
const LINK_GROUPS = [
  {
    title: 'Shop',
    links: [
      { label: 'All products', href: '/collection.html' },
      { label: 'New arrivals', href: '/collection.html?sort=newest' },
      { label: 'On sale', href: '/collection.html?sale=1' },
      { label: 'Digital downloads', href: '/collection.html?category=digital-downloads' },
      { label: 'Saved items', href: '/wishlist.html' },
    ],
  },
  {
    title: 'Help',
    links: [
      { label: 'Delivery & returns', href: '/#delivery' },
      { label: 'Track an order', href: '/#orders' },
      { label: 'Size guide', href: '/#sizing' },
      { label: 'Contact us', href: '/#contact' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'Our story', href: '/#story' },
      { label: 'Sourcing', href: '/#sourcing' },
      { label: 'Careers', href: '/#careers' },
      { label: 'Privacy', href: '/#privacy' },
    ],
  },
];

const CONTACT = [
  { icon: 'phone', label: '+251 11 000 0000', href: 'tel:+251110000000' },
  { icon: 'mail', label: 'hello@example.com', href: 'mailto:hello@example.com' },
  { icon: 'map-pin', label: 'Bole Road, Addis Ababa', href: '/#contact' },
];

/** Payment methods as text. Named, not drawn - an unbranded card icon beside a
 *  label reads as a placeholder; the label alone is honest. */
const PAYMENT_METHODS = ['Telebirr', 'CBE Birr', 'Visa', 'Mastercard'];

const TRUST_VALUES = [
  { icon: 'truck', title: 'Fast delivery', text: 'Next day inside Addis Ababa.' },
  { icon: 'refresh', title: '30-day returns', text: 'No questions asked.' },
  { icon: 'shield', title: 'Secure payments', text: 'Telebirr, CBE Birr and cards.' },
  { icon: 'headset', title: 'Real support', text: 'Weekdays 09:00–18:00.' },
];

export function createFooter() {
  return el('footer.site-footer', {}, [
    el('div.container', {}, [
      trustValues(),
      el('div.footer__grid', {}, [
        brandColumn(),
        ...LINK_GROUPS.map(linkGroup),
        newsletterColumn(),
      ]),
      el('div.footer__legal', {}, [
        el('div.footer__legal-links', {}, [
          el('a.footer__legal-link', { href: '/#privacy', text: 'Privacy' }),
          el('a.footer__legal-link', { href: '/#terms', text: 'Terms' }),
          el('a.footer__legal-link', { href: '/#cookies', text: 'Cookies' }),
        ]),
        el('p.footer__copyright', {
          text: `© ${new Date().getFullYear()} ${config.store.name}. Prices include VAT.`,
        }),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                     */
/* -------------------------------------------------------------------------- */

function trustValues() {
  return el(
    'div.footer__values',
    {},
    TRUST_VALUES.map((value) =>
      el('div.footer__value', {}, [
        el('span.footer__value-icon', { 'aria-hidden': 'true' }, [icon(value.icon)]),
        el('div', {}, [
          el('p.footer__value-title', { text: value.title }),
          el('p.footer__value-text', { text: value.text }),
        ]),
      ])
    )
  );
}

function brandColumn() {
  return el('div.footer__brand', {}, [
    el('a.brand', { href: '/', 'aria-label': config.store.logoLabel }, [
      el('span.brand__mark', { 'aria-hidden': 'true' }, [icon('layers')]),
      el('span.brand__name', { text: config.store.name }),
    ]),
    el('p.footer__brand-text', { text: config.store.description }),
    el('ul.footer__contact', {},
      CONTACT.map((entry) =>
        el('li', {}, [
          el('a.footer__list-link', { href: entry.href }, [
            icon(entry.icon, { className: 'footer__list-icon' }),
            entry.label,
          ]),
        ])
      )
    ),
    el('div.footer__methods', { 'aria-label': 'Accepted payment methods' }, [
      el('p.footer__method-label', { text: 'We accept' }),
      el('ul.footer__method-list', { role: 'list' },
        PAYMENT_METHODS.map((method) => el('li.footer__method', { text: method }))
      ),
    ]),
  ]);
}

function linkGroup(group) {
  return el('div.footer__column', {}, [
    el('h2.footer__column-title', { text: group.title }),
    el('ul.footer__list', { role: 'list' },
      group.links.map((link) =>
        el('li', {}, [
          el('a.footer__list-link', {
            href: link.href,
            ...(link.external ? { rel: 'noopener noreferrer', target: '_blank' } : {}),
            text: link.label,
          }),
        ])
      )
    ),
  ]);
}

function newsletterColumn() {
  const email = field({
    type: 'email',
    label: 'Email address',
    name: 'email',
    placeholder: 'you@example.com',
    autocomplete: 'email',
    required: true,
  });

  const submit = button({ label: 'Subscribe', variant: 'primary', block: true }).element;

  const status = el('p.field__message', { role: 'status', 'aria-live': 'polite' });

  const cleanups = [on(email.input, 'input', () => email.clearError())];

  const form = el('form.newsletter__form', { novalidate: true }, [email.element, submit, status]);

  const handleSubscribe = () => {
    if (!email.validate()) {
      email.focus();
      return;
    }
    email.clearError();

    // Validated, then told the truth: there is no mailing list behind this in
    // the current build. Silently accepting an address and losing it would be
    // the worst of the three options.
    email.input.disabled = true;
    submit.toggleAttribute('disabled', true);
    status.classList.add('field__message--success');
    status.textContent = 'Thanks — not yet connected, so nothing was stored.';
  };

  on(submit, 'click', handleSubscribe);
  on(form, 'submit', (event) => {
    event.preventDefault();
    handleSubscribe();
  });

  cleanups.push(() => {
    email.destroy();
  });
  form.destroy = () => cleanups.forEach((fn) => fn());

  return el('div.footer__column.footer__column--newsletter', {}, [
    el('h2.footer__column-title', { text: 'Stay in touch' }),
    el('p.footer__brand-text', {
      text: 'Occasional notes on new arrivals and restocks. No more than once a month.',
    }),
    form,
    el('p.footer__note', {
      text: 'Subscriptions are not yet connected to a mailing list in this build.',
    }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                    */
/* -------------------------------------------------------------------------- */

export default { createFooter };