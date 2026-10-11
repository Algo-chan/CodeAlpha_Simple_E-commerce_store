/**
 * Checkout page.
 *
 * One job: turn the cart into an order. The page collects fulfilment details,
 * previews the delivery fee, and posts to `POST /checkout`. On success it
 * replaces itself with the confirmation — the order it just created — and
 * re-reads the cart, which the server has now emptied.
 *
 * Everything authoritative happens on the server inside one transaction. This
 * page never sends a price, a total or a status; it sends an address and a
 * payment method, and trusts the confirmation it gets back over any number it
 * drew itself. The delivery figure shown here is a preview of the same flat
 * rule, clearly superseded by the server's number on the receipt.
 *
 * GUESTS CAN CHECK OUT. The basket rides on the httpOnly cart cookie and the
 * order is created against it; a signed-in customer's contact details are
 * prefilled from the account and their order is linked to their history.
 */
import { el, clear, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { button } from '../components/ui/button.js';
import { field, select } from '../components/forms/field.js';
import { pageTitle } from '../components/layout/page-header.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { emptyCartState } from '../components/feedback/states.js';
import { skeletonCart } from '../components/feedback/skeleton.js';
import { formAlert, applyApiFieldErrors, phoneIssue } from '../utils/forms.js';
import { formatCount, formatMoney, freeDeliveryNotice } from '../utils/format.js';
import { icon } from '../utils/icons.js';
import {
  buildCheckoutBody,
  checkoutTotal,
  describeCheckoutError,
  previewDeliveryFee,
  PAYMENT_METHOD_COD,
} from '../utils/checkout.js';
import {
  orderItemsList,
  orderTotals,
  orderAddressBlock,
  orderPaymentBlock,
  orderStatusBadge,
} from '../components/order/order-view.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.cart
 * @param {object} options.auth
 * @param {object} [options.client] API client, injectable for tests
 * @param {object} [options.ui]     toast store, for the success toast
 * @returns {{ destroy(): void }}
 */
export default async function checkoutPage({ host, cart, auth, client = api, ui = null }) {
  document.title = 'Checkout - Aster & Oak';
  if (auth.selectStatus() === 'unknown') await auth.refresh();

  const shell = el('div.container.checkout-shell');
  host.replaceChildren(shell);

  let unsubscribe = null;
  function stopWatching() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  render();

  /**
   * Draws the whole page from the current cart. Called once on entry; the form
   * is not redrawn on every cart change (that would discard what the shopper
   * has typed), only the summary column is refreshed in place.
   */
  function render() {
    stopWatching();
    clear(shell);

    const lines = cart.selectLines();

    if (lines.length === 0 && cart.selectSyncStatus() === 'syncing') {
      shell.append(pageTitle('Checkout', { eyebrow: 'Loading…' }), skeletonCart(3));
      return;
    }

    if (lines.length === 0) {
      renderEmpty();
      return;
    }

    shell.append(breadcrumb([{ label: 'Cart', href: '/cart.html' }, { label: 'Checkout' }]));

    const layout = el('div.checkout-page');
    const formColumn = el('div.checkout-page__form');
    const summaryColumn = el('aside.checkout-page__summary', {
      'aria-label': 'Order summary',
      'aria-live': 'polite',
    });
    layout.append(formColumn, summaryColumn);
    shell.append(layout);

    const buyable = lines.filter((line) => !line.unavailableReason);
    const unfulfillable = lines.length - buyable.length;

    formColumn.append(
      pageTitle('Checkout', {
        eyebrow: formatCount(
          buyable.reduce((total, line) => total + line.quantity, 0),
          'item'
        ),
        lede: 'Delivery details, then a confirmation. Nothing is paid online.',
      })
    );

    if (unfulfillable > 0) {
      formColumn.append(
        el('div.form-alert.form-alert--warning', { role: 'status' }, [
          icon('alert-triangle'),
          el('div', {}, [
            el('p', {
              text: `${formatCount(unfulfillable, 'item')} in your cart can no longer be ordered. Remove ${
                unfulfillable === 1 ? 'it' : 'them'
              } from the cart to continue.`,
            }),
            button({
              label: 'Review your cart',
              href: '/cart.html',
              variant: 'secondary',
              size: 'sm',
            }).element,
          ]),
        ])
      );
    }

    const form = buildForm({ disabled: unfulfillable > 0 });
    formColumn.append(form.element);

    drawSummary(summaryColumn, lines);

    // A cart change (another tab, a background hydration) refreshes the totals
    // and the submit state without touching the typed form.
    unsubscribe = cart.subscribe(() => {
      const nextLines = cart.selectLines();
      if (nextLines.length === 0) {
        renderEmpty();
        return;
      }
      drawSummary(summaryColumn, nextLines);
    });
  }

  function renderEmpty() {
    stopWatching();
    clear(shell);
    shell.append(
      breadcrumb([{ label: 'Cart', href: '/cart.html' }, { label: 'Checkout' }]),
      pageTitle('Checkout', { eyebrow: 'Nothing here yet' }),
      emptyCartState()
    );
  }

  /** The order-summary rail: lines, sub-total, delivery preview and total. */
  function drawSummary(container, lines) {
    clear(container);

    const buyable = lines.filter((line) => !line.unavailableReason);
    const subtotal = cart.selectSubtotal();
    const delivery = previewDeliveryFee(subtotal);
    const total = checkoutTotal(subtotal, delivery.feeMinor);

    container.append(
      el('h2.text-lg', { text: 'Order summary' }),
      el(
        'ul.checkout-summary__lines',
        { role: 'list' },
        buyable.map((line) =>
          el('li.checkout-summary__line', {}, [
            el('div', {}, [
              el('p.checkout-summary__name', { text: line.name }),
              line.variantName
                ? el('p.checkout-summary__variant', { text: line.variantName })
                : null,
            ]),
            el('div.checkout-summary__figures', {}, [
              el('p.checkout-summary__qty', { text: `× ${line.quantity}` }),
              el('p.checkout-summary__price', { text: formatMoney(line.lineTotal) }),
            ]),
          ])
        )
      ),
      el('dl', {}, [
        el('div.cart__row', {}, [
          el('dt', { text: 'Subtotal' }),
          el('dd', { text: formatMoney(subtotal) }),
        ]),
        el('div.cart__row', {}, [
          el('dt', { text: 'Delivery' }),
          el('dd', { text: delivery.isFree ? 'Free' : formatMoney(delivery.feeMinor) }),
        ]),
        el('div.cart__row.cart__row--total', {}, [
          el('dt', { text: 'Total' }),
          el('dd', { text: formatMoney(total) }),
        ]),
      ]),
      el('p.cart__note', {
        text: delivery.isFree
          ? 'Delivery is free on this order.'
          : freeDeliveryNotice({ long: true }),
      })
    );
  }

  /**
   * Builds the form and its submit handler. The handler is the only place this
   * page touches the network.
   */
  function buildForm({ disabled }) {
    const user = auth.selectUser();

    const fullName = field({
      label: 'Full name',
      name: 'full_name',
      autocomplete: 'name',
      required: true,
      noValidate: true,
      value: user?.name ?? '',
    });
    const email = field({
      label: 'Email',
      type: 'email',
      name: 'email',
      autocomplete: 'email',
      required: true,
      noValidate: true,
      value: user?.email ?? '',
    });
    const phone = field({
      label: 'Phone',
      type: 'tel',
      name: 'phone',
      autocomplete: 'tel',
      required: true,
      noValidate: true,
      hint: 'Digits only, 9-15. Used to arrange the delivery.',
      value: user?.phone ?? '',
    });

    const label = select({
      label: 'Address label',
      value: 'Home',
      options: [
        { value: 'Home', label: 'Home' },
        { value: 'Work', label: 'Work' },
        { value: 'Other', label: 'Other' },
      ],
    });
    const city = field({
      label: 'City',
      name: 'city',
      required: true,
      noValidate: true,
      value: 'Addis Ababa',
    });
    const area = field({
      label: 'Area / sub-city',
      name: 'area',
      required: true,
      noValidate: true,
    });
    const street = field({
      label: 'Street and building',
      name: 'street',
      required: true,
      noValidate: true,
    });
    const landmark = field({
      label: 'Landmark',
      name: 'landmark',
      optional: true,
      noValidate: true,
    });
    const additionalNotes = field({
      label: 'Delivery notes',
      name: 'additional_notes',
      optional: true,
      noValidate: true,
      maxlength: '1000',
      hint: 'Gate codes, floor, or a time that suits you.',
    });

    const customerNotes = field({
      label: 'Order notes',
      name: 'customer_notes',
      optional: true,
      noValidate: true,
      maxlength: '1000',
    });

    const fields = {
      full_name: fullName,
      email,
      phone,
      label,
      city,
      area,
      street,
      landmark,
      additional_notes: additionalNotes,
      customer_notes: customerNotes,
    };
    const requiredFields = [fullName, email, phone, city, area, street];

    const alertSlot = el('div');
    const save = button({
      label: 'Place order',
      variant: 'primary',
      type: 'submit',
      block: true,
      disabled,
    });

    const form = el('form.checkout-form', { novalidate: true }, [
      section('contact', 'Contact', 'How we reach you about this order.', [
        fullName.element,
        el('div.field-group.field-group--2', {}, [email.element, phone.element]),
      ]),
      section('address', 'Delivery address', 'Where the courier should bring it.', [
        el('div.field-group.field-group--2', {}, [label.element, city.element]),
        el('div.field-group.field-group--2', {}, [area.element, street.element]),
        landmark.element,
        additionalNotes.element,
      ]),
      section('notes', 'Notes', 'Anything else we should know.', [customerNotes.element]),
      paymentSection(),
      alertSlot,
      el('div.checkout-form__actions', {}, [
        save.element,
        button({
          label: 'Back to cart',
          href: '/cart.html',
          variant: 'ghost',
        }).element,
      ]),
    ]);

    on(form, 'submit', (event) => {
      event.preventDefault();
      clear(alertSlot);

      let firstInvalid = null;
      for (const control of requiredFields) {
        if (!control.validate()) firstInvalid ??= control;
      }
      if (firstInvalid) {
        firstInvalid.focus();
        return;
      }

      const phoneProblem = phoneIssue(phone.getValue());
      if (phoneProblem) {
        phone.setError(phoneProblem);
        phone.focus();
        return;
      }

      save.run(async () => {
        const body = buildCheckoutBody({
          fullName: fullName.getValue(),
          email: email.getValue(),
          phone: phone.getValue(),
          label: label.getValue(),
          city: city.getValue(),
          area: area.getValue(),
          street: street.getValue(),
          landmark: landmark.getValue(),
          additionalNotes: additionalNotes.getValue(),
          customerNotes: customerNotes.getValue(),
          paymentMethod: PAYMENT_METHOD_COD,
        });

        try {
          const data = await client.post('/checkout', body);
          const order = data?.order;
          if (!order) throw new Error('The order could not be read from the response.');

          // Stop watching before the cart is emptied, so the refresh does not
          // paint the empty state over the confirmation.
          stopWatching();
          await cart.hydrate();
          renderConfirmation(order);
          ui?.pushToast?.({ title: 'Order placed', tone: 'success' });
        } catch (error) {
          const applied = applyApiFieldErrors(fields, error);
          if (applied && fields[applied]) {
            fields[applied].focus();
          } else {
            alertSlot.append(formAlert(describeCheckoutError(error)));
            if (['CART_EMPTY', 'PRODUCT_UNAVAILABLE', 'INSUFFICIENT_STOCK'].includes(error?.code)) {
              alertSlot.append(
                el('div.form-actions', {}, [
                  button({ label: 'Review your cart', href: '/cart.html', variant: 'secondary' })
                    .element,
                ])
              );
              // The server's cart is the truth again; re-read it so the summary
              // and the next attempt agree with it.
              void cart.hydrate();
            }
          }
        }
      });
    });

    return { element: form };
  }

  /** The confirmation, rendered in place of the form after a successful order. */
  function renderConfirmation(order) {
    clear(shell);

    const title = el('h1.section-head__title', { tabindex: '-1', text: 'Order confirmed' });

    shell.append(
      breadcrumb([{ label: 'Checkout' }]),
      el('div.checkout-confirmation', { role: 'status' }, [
        el('div.checkout-confirmation__badge', { 'aria-hidden': 'true' }, [
          icon('check-circle', { size: 32 }),
        ]),
        title,
        el('p.checkout-confirmation__lede', {
          text: `Thank you. Your order ${order.orderNumber} has been placed.`,
        }),
        el('div.checkout-confirmation__meta', {}, [
          orderStatusBadge(order.status),
          el('p.checkout-confirmation__number', { text: order.orderNumber }),
        ]),

        el('div.checkout-confirmation__grid', {}, [
          el('section.checkout-card', {}, [
            el('h2.checkout-card__title', { text: 'Your items' }),
            orderItemsList(order.items),
            orderTotals(order),
          ]),
          el('div.checkout-confirmation__side', {}, [
            orderAddressBlock(order.shippingAddress),
            orderPaymentBlock(order),
            order.customerNotes
              ? el('div.order-address', {}, [
                  el('p.order-address__title', { text: 'Your note' }),
                  el('p.order-address__line', { text: order.customerNotes }),
                ])
              : null,
          ]),
        ]),

        el('p.cart__note', {
          text: 'We will call the number on your order to confirm delivery. You pay the courier in cash on arrival.',
        }),

        el('div.form-actions', {}, [
          button({ label: 'Continue shopping', href: '/collection.html', variant: 'primary' })
            .element,
          auth.selectIsAuthenticated()
            ? button({ label: 'View your orders', href: '/orders.html', variant: 'secondary' })
                .element
            : null,
        ]),
      ])
    );

    title.focus({ preventScroll: true });
    globalThis.scrollTo?.({ top: 0, behavior: 'auto' });
  }

  return {
    destroy() {
      stopWatching();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

/** A titled block inside the checkout form. */
function section(id, title, lede, children) {
  return el('section.checkout-section', { 'aria-labelledby': `checkout-${id}` }, [
    el('div.checkout-section__head', {}, [
      el('h2.checkout-section__title', { id: `checkout-${id}`, text: title }),
      el('p.checkout-section__lede', { text: lede }),
    ]),
    el('div.field-group', {}, children),
  ]);
}

/** The payment block. COD is the only method this phase supports. */
function paymentSection() {
  return el('section.checkout-section', { 'aria-labelledby': 'checkout-payment' }, [
    el('div.checkout-section__head', {}, [
      el('h2.checkout-section__title', { id: 'checkout-payment', text: 'Payment' }),
      el('p.checkout-section__lede', { text: 'The only method available right now.' }),
    ]),
    el('div.checkout-payment', {}, [
      el('span.checkout-payment__icon', { 'aria-hidden': 'true' }, [icon('banknote')]),
      el('div', {}, [
        el('p.checkout-payment__title', { text: 'Cash on delivery' }),
        el('p.checkout-payment__text', {
          text: 'Pay the courier in cash when your order arrives. No card details are taken online.',
        }),
      ]),
    ]),
  ]);
}
