/**
 * Auth routes — public registration/login/logout plus the protected account
 * surface (profile, password, addresses). Everything mutating runs behind
 * `requireSameOrigin`, and `/me` plus the account surface run behind
 * `authenticate`, which resolves the identity from the session cookie.
 */
import { Router } from 'express';
import env from '../config/env.js';
import { createAuthLimiter } from '../middleware/security.js';
import { requireSameOrigin } from '../middleware/csrf.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import * as controller from '../controllers/auth.controller.js';
import {
  registerSchema,
  loginSchema,
  profileUpdateSchema,
  passwordChangeSchema,
  createAddressSchema,
  updateAddressSchema,
  addressIdParamSchema,
} from '../validators/auth.schema.js';

const router = Router();

// Credential endpoints are behind the stricter per-IP limiter. Skipped in test
// like the API-wide limiter, so the suite never trips it by exercising logins.
const credentialLimits = env.isTest ? [] : [createAuthLimiter()];

router.post('/register', requireSameOrigin, ...credentialLimits, validateRequest({ body: registerSchema }), controller.register);
router.post('/login', requireSameOrigin, ...credentialLimits, validateRequest({ body: loginSchema }), controller.login);
router.post('/logout', requireSameOrigin, controller.logout);

router.get('/me', authenticate, controller.me);
router.patch('/profile', requireSameOrigin, authenticate, validateRequest({ body: profileUpdateSchema }), controller.updateProfile);
router.post('/password', requireSameOrigin, authenticate, validateRequest({ body: passwordChangeSchema }), controller.changePassword);

router.get('/addresses', authenticate, controller.listAddresses);
router.post('/addresses', requireSameOrigin, authenticate, validateRequest({ body: createAddressSchema }), controller.createAddress);
router.patch(
  '/addresses/:id',
  requireSameOrigin,
  authenticate,
  validateRequest({ params: addressIdParamSchema, body: updateAddressSchema }),
  controller.updateAddress
);
router.delete(
  '/addresses/:id',
  requireSameOrigin,
  authenticate,
  validateRequest({ params: addressIdParamSchema }),
  controller.deleteAddress
);
router.post(
  '/addresses/:id/default',
  requireSameOrigin,
  authenticate,
  validateRequest({ params: addressIdParamSchema }),
  controller.setDefaultAddress
);

export default router;