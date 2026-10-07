/**
 * Cart routes — open to shoppers and guests alike.
 *
 * Reads are open (the cart identity lives in httpOnly cookies, never in the
 * URL or body); writes run behind `requireSameOrigin` like every other
 * mutating endpoint in the API. `authenticateIfPresent` upgrades a valid
 * session cookie to `req.user`, which is what lets the service merge a guest
 * cart into the customer cart on the first authenticated request.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticateIfPresent } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/cart.controller.js';
import {
  addItemSchema,
  updateItemSchema,
  cartItemIdParamSchema,
} from '../validators/cart.schema.js';

const router = Router();

router.use(authenticateIfPresent);

router.get('/', controller.getCart);
router.post(
  '/items',
  requireSameOrigin,
  validateRequest({ body: addItemSchema }),
  controller.addItem
);
router.patch(
  '/items/:id',
  requireSameOrigin,
  validateRequest({ params: cartItemIdParamSchema, body: updateItemSchema }),
  controller.updateItem
);
router.delete(
  '/items/:id',
  requireSameOrigin,
  validateRequest({ params: cartItemIdParamSchema }),
  controller.removeItem
);
router.delete('/', requireSameOrigin, controller.clearCart);

export default router;
