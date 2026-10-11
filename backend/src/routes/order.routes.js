/**
 * Order routes — a customer's own order history.
 *
 * Both routes require a session (`authenticate`). Orders are addressed by their
 * human-readable `orderNumber`, never by database id, and the service scopes
 * every lookup by the authenticated user, so one customer can never read
 * another's order.
 *
 * Guest checkout exists, but guest orders are not listed here: a guest has no
 * account to list them against, and their confirmation is the checkout
 * response. Persisting guest history would need a separate, emailed lookup.
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { paginationSchema } from '../validators/common.schema.js';
import { orderNumberParamSchema } from '../validators/checkout.schema.js';
import * as controller from '../controllers/order.controller.js';

const router = Router();

router.use(authenticate);

router.get('/', validateRequest({ query: paginationSchema }), controller.list);
router.get('/:orderNumber', validateRequest({ params: orderNumberParamSchema }), controller.getOne);

export default router;
