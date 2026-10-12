/**
 * Checkout routes.
 *
 * `POST /api/v1/checkout` places the order; `POST /api/v1/checkout/coupon`
 * prices a discount code against the current cart. Both run behind
 * `requireSameOrigin` and `authenticateIfPresent`, so a signed-in shopper is
 * tied to their account while a guest is recognised only by their cart cookie.
 *
 * There is deliberately no read endpoint here. The checkout response IS the
 * confirmation; order history lives under `/orders`, which requires an account.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticateIfPresent } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/checkout.controller.js';
import { checkoutSchema, couponPreviewSchema } from '../validators/checkout.schema.js';

const router = Router();

router.use(authenticateIfPresent);

router.post('/', requireSameOrigin, validateRequest({ body: checkoutSchema }), controller.create);

router.post(
  '/coupon',
  requireSameOrigin,
  validateRequest({ body: couponPreviewSchema }),
  controller.previewCoupon
);

export default router;
