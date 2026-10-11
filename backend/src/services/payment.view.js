/**
 * Payment view — the client-facing shape of a payment row.
 *
 * The read model (`order.view.js`) shows an order's latest payment as a small
 * summary; the payment endpoints show the full row, plus the order number it
 * belongs to so a shopper can reconcile the two. Provider-level transaction
 * references are safe to show to the owner of the order — they are how a shopper
 * and support both name the payment — but are never put in logs that other
 * modules write.
 */
export function toPaymentView(payment, order = null) {
  return {
    orderNumber: order?.order_number ?? null,
    provider: payment.provider,
    method: payment.method,
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency,
    reference: payment.transaction_reference ?? null,
    paidAt: payment.paid_at ?? null,
    failureReason: payment.failure_reason ?? null,
    createdAt: payment.created_at ?? null,
  };
}

export default { toPaymentView };
