import { Router } from 'express';
import v1Routes from './v1.routes.js';

/**
 * Top-level router, mounted by `app.js` under `API_BASE_PATH` (`/api/v1`).
 *
 * Route files only map URLs to controllers — no business logic here.
 * Each API version gets its own router so `/api/v2` can be added later
 * without touching the existing endpoints.
 */
const router = Router();

router.use(v1Routes);

export default router;
