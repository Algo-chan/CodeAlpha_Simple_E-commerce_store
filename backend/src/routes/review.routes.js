/**
 * Review routes — the customer-facing write side.
 *
 * Both endpoints sit behind `authenticate`: reviewing requires an account the
 * purchase can be proved against (a guest order has no `user_id`, so it can
 * never qualify). The submit is a state-changing same-origin call; listing what
 * is reviewable is a read, so it is safe without the origin check.
 */
import { Router } from 'express';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/review.controller.js';
import { createReviewSchema } from '../validators/review.schema.js';
import { writeLimiter } from '../middleware/security.js';
import env from '../config/env.js';

const router = Router();

router.use(authenticate);

router.get('/reviewable', controller.listReviewable);
router.post(
  '/',
  requireSameOrigin,
  // Submitting a review is an authenticated write a script could spam. The
  // limiter is skipped under test so the suite can write freely.
  ...(env.isTest ? [] : [writeLimiter]),
  validateRequest({ body: createReviewSchema }),
  controller.create
);

export default router;
