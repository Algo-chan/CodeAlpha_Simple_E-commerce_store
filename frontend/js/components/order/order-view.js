/**
 * Order view pieces.
 *
 * The order confirmation at checkout, the order history list and the order
 * detail all show the same document (`order.view.js`) and must not drift. The
 * pieces that render it live here so there is one definition of "an order's
 * line", "an order's totals" and "an address block".
 *
 * Everything is driven by the SERVER's snapshot: prices and names come from the
 * order, never the live catalogue. An order placed last month must still read
 * the way it was placed even after the product is renamed or repriced.
 */
import { el } from '../../core/dom.js';
import { icon } from '../../utils/icons.js';
import { formatCount, formatMoney, formatMoneyPrecise } from '../../utils/format.js';
import { orderStatusLabel, orderStatusTone, paymentStatusLabel } from '../../utils/checkout.js';

/** A status pill whose tone is carried by a data attribute, not a class name. */
export function orderStatusBadge(status) {
  return el('span.order-status', {
    dataset: { tone: orderStatusTone(status) },
    text: orderStatusLabel(status),
  });
}

/** "Black / Large" or the SKU, whichever the snapshot carries. */
function variantSummary(item) {
  if (item.variantLabel) return item.variantLabel;
  if (item.sku) return item.sku;
  return null;
}

/**
 * The line list. Media is intentionally absent: an order snapshot stores names
 * and prices, not images, and inventing a thumbnail would mean reaching into
 * live data this view is built to avoid.
 */
export function orderItemsList(items = []) {
  return el(
    'ul.order-items',
    { role: 'list' },
    items.map((item) =>
      el('li.order-item', {}, [
        el('div.order-item__body', {}, [
          el('p.order-item__name', { text: item.productName }),
          variantSummary(item) ? el('p.order-item__variant', { text: variantSummary(item) }) : null,
        ]),
        el('div.order-item__figures', {}, [
          el('p.order-item__qty', { text: `${formatCount(item.quantity, 'item')}` }),
          el('p.order-item__price', { text: formatMoney(item.subtotal) }),
        ]),
      ])
    )
  );
}

/** Subtotal / delivery / discount / total, from the order snapshot. */
export function orderTotals(order) {
  const rows = [
    totalRow('Subtotal', formatMoney(order.subtotal)),
    totalRow('Delivery', order.deliveryFee === 0 ? 'Free' : formatMoney(order.deliveryFee)),
  ];

  if (order.discountTotal > 0) {
    rows.push(totalRow('Discount', `−${formatMoney(order.discountTotal)}`));
  }

  rows.push(
    el('div.cart__row.cart__row--total', {}, [
      el('dt', { text: 'Total' }),
      el('dd', { text: formatMoney(order.total) }),
    ])
  );

  return el('dl.order-totals', {}, rows);
}

function totalRow(term, value) {
  return el('div.cart__row', {}, [el('dt', { text: term }), el('dd', { text: value })]);
}

/** The delivery address as read-back lines. `address` is the camelCase view. */
export function orderAddressBlock(address) {
  if (!address) return null;

  const lines = [
    address.fullName,
    address.street,
    [address.area, address.city].filter(Boolean).join(', '),
    address.phone,
    ...(address.landmark ? [`Landmark: ${address.landmark}`] : []),
    ...(address.additionalNotes ? [address.additionalNotes] : []),
  ].filter((line) => line && String(line).trim());

  return el('div.order-address', {}, [
    el('p.order-address__title', { text: 'Delivery address' }),
    ...lines.map((line) => el('p.order-address__line', { text: line })),
  ]);
}

/** How this order is being paid for, and where that payment stands. */
export function orderPaymentBlock(order) {
  const method = order.paymentMethod === 'COD' ? 'Cash on delivery' : order.paymentMethod;
  const status = order.payment?.status ?? order.paymentStatus;

  return el('div.order-payment', {}, [
    el('p.order-payment__title', { text: 'Payment' }),
    el('p.order-payment__row', {}, [
      icon('banknote'),
      el('span', { text: `${method} · ${paymentStatusLabel(status)}` }),
    ]),
  ]);
}

/** The unit price line under an item, including decimals only when it has them. */
export function orderUnitPrice(item) {
  return formatMoneyPrecise(item.unitPrice);
}

export default {
  orderStatusBadge,
  orderItemsList,
  orderTotals,
  orderAddressBlock,
  orderPaymentBlock,
  orderUnitPrice,
};
