/**
 * Payment routes.
 *
 * `POST /` is a shopper action: authenticated (the order must be theirs), CSRF
 * protected, and validated. `POST /webhook/:provider` is the provider callback:
 * deliberately NOT authenticated and NOT origin-checked, because the provider
 * has neither — its authenticity IS the signature over the raw body.
 *
 * `app.js` captures the raw body with a `verify` hook on the JSON parser, so by
 * the time this router runs, `req.rawBody` holds the exact bytes the gateway
 * signed, and the adapter verifies against those — never a re-serialised copy.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/payment.controller.js';
import { paymentInitSchema } from '../validators/payment.schema.js';

const router = Router();

// Provider-facing, signature-authenticated.
router.post('/webhook/:provider', controller.webhook);

// Public capability list (no secrets, no session).
router.get('/methods', controller.methods);

// Shopper-facing, session + CSRF + validation.
router.post(
  '/',
  authenticate,
  requireSameOrigin,
  validateRequest({ body: paymentInitSchema }),
  controller.initiate
);

export default router;
