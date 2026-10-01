/**
 * Health repository — the only place allowed to talk to PostgreSQL for health
 * reporting. Services depend on repositories, never on `pg` directly.
 */
import { ping } from '../utils/database.js';

/**
 * Checks that the database is reachable.
 * @returns {Promise<{ ok: boolean, latencyMs: number }>}
 */
export async function checkDatabase() {
  return ping();
}

export default { checkDatabase };
