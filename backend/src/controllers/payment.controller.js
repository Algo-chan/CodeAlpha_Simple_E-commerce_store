/**
 * Payment controller — HTTP in, HTTP out for money.
 *
 * Two distinct callers live behind one router:
 *
 *   - the SHOPPER initiates a payment. This is a state-changing action with an
 *     `Origin` header, guarded by auth (the order must be theirs) and CSRF;
 *   - the PROVIDER posts a signed notification. There is no user or Origin
 *     header — authenticity is the signature over the raw body, which this
 *     file hands straight to the adapter for verification before anything is
 *     read as trustworthy.
 *
 * The webhook always answers 200 for a well-formed-but-duplicate notification:
 * the provider should not retry something already handled, and repeating it is
 * not an error.
 */
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendSuccess } from '../utils/http-response.js';
import { listProviders } from '../payments/index.js';
import * as service from '../services/payment.service.js';

/** `POST /api/v1/payments` — create an intent for a shopper's own order. */
export const initiate = asyncHandler(async (req, res) => {
  const result = await service.initiatePayment(req.db, { userId: req.user.id }, req.body);

  return sendCreated(res, result, 'Payment initialized.');
});

/** `POST /api/v1/payments/webhook/:provider` — signed gateway notification. */
export const webhook = asyncHandler(async (req, res) => {
  const result = await service.handleWebhook(req.db, {
    providerName: req.params.provider,
    rawBody: req.rawBody ?? Buffer.from(''),
    headers: req.headers,
    payload: req.body ?? {},
  });

  return sendSuccess(res, { data: result });
});

/** `GET /api/v1/payments/methods` — which providers are available (no secrets). */
export const methods = asyncHandler(async (_req, res) => {
  return sendSuccess(res, {
    data: {
      currency: 'ETB',
      providers: listProviders(),
    },
  });
});

export default { initiate, webhook, methods };
