/**
 * Checkout routes.
 *
 * One endpoint: `POST /api/v1/checkout`. It runs behind `requireSameOrigin`
 * like every mutating endpoint, and behind `authenticateIfPresent` so a signed-in
 * shopper's order is tied to their account while a guest's order is tied to
 * their cart cookie.
 *
 * There is deliberately no read endpoint here. The checkout response IS the
 * confirmation; order history lives under `/orders`, which requires an account.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticateIfPresent } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/checkout.controller.js';
import { checkoutSchema } from '../validators/checkout.schema.js';

const router = Router();

router.use(authenticateIfPresent);

router.post('/', requireSameOrigin, validateRequest({ body: checkoutSchema }), controller.create);

export default router;
