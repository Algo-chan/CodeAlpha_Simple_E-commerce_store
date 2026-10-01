/**
 * Health service — business logic for the health endpoint.
 * Decides what "healthy" means; performs no HTTP work.
 */
import { checkDatabase } from '../repositories/health.repository.js';

/**
 * Builds the health payload.
 * A database failure must NOT crash the API, so the error is caught here and
 * reported as `disconnected` instead.
 *
 * @param {string} environment
 * @returns {Promise<{ status: 'healthy'|'degraded', database: 'connected'|'disconnected', latencyMs: number|null }>}
 */
export async function getHealthReport(environment) {
  let database;
  let latencyMs = null;

  try {
    const result = await checkDatabase();
    database = result.ok ? 'connected' : 'disconnected';
    latencyMs = result.latencyMs;
  } catch {
    // Swallow the error: the health endpoint reports the problem, it does not fail.
    database = 'disconnected';
  }

  return {
    status: database === 'connected' ? 'healthy' : 'degraded',
    database,
    latencyMs,
    environment,
  };
}

export default { getHealthReport };
