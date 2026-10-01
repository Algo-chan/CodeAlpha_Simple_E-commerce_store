import asyncHandler from '../utils/async-handler.js';
import { sendSuccess } from '../utils/http-response.js';
import { getHealthReport } from '../services/health.service.js';
import env from '../config/env.js';

/**
 * GET /api/v1/health
 * Reports API status, database connectivity and the active environment.
 */
export const getHealth = asyncHandler(async (req, res) => {
  const report = await getHealthReport(env.nodeEnv);

  return sendSuccess(res, {
    statusCode: 200,
    data: {
      status: report.status,
      api: 'healthy',
      database: report.database,
      environment: report.environment,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
  });
});

export default { getHealth };
