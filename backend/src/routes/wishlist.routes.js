/**
 * Wishlist routes — authenticated shoppers only.
 *
 * There is no guest wishlist on the server: guests keep their saved items in
 * the browser until sign-in, then `POST /merge` folds them in. Every route
 * runs behind `authenticate`, so `req.user.id` is always a real session.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/wishlist.controller.js';
import {
  addWishlistItemSchema,
  wishlistItemParamSchema,
  mergeWishlistSchema,
} from '../validators/wishlist.schema.js';

const router = Router();

router.use(authenticate);

router.get('/', controller.getWishlist);
router.post(
  '/items',
  requireSameOrigin,
  validateRequest({ body: addWishlistItemSchema }),
  controller.addItem
);
router.delete(
  '/items/:productId',
  requireSameOrigin,
  validateRequest({ params: wishlistItemParamSchema }),
  controller.removeItem
);
router.post(
  '/merge',
  requireSameOrigin,
  validateRequest({ body: mergeWishlistSchema }),
  controller.merge
);

export default router;
