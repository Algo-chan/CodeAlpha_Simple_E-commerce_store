/**
 * Bootstrap administrator service.
 *
 * A store deployed to a host without a shell has no way to promote an account by
 * hand, so the first administrator is created from configuration instead:
 * `backend/scripts/bootstrap-admin.js` reads `BOOTSTRAP_ADMIN_*` and calls
 * `ensureBootstrapAdmin` on every boot.
 *
 * It converges: an existing account with the configured email is promoted to
 * ADMIN and given the configured password, so the same variables both create the
 * account and recover it. That is why the update is unconditional — a
 * deployment can always be entered, even if the password was lost.
 */
import * as users from '../repositories/user.repository.js';
import { hashPassword } from './password.js';
import { bootstrapAdminSchema } from '../validators/auth.schema.js';

/**
 * Creates or refreshes the configured administrator.
 *
 * Validation happens here rather than in `config/env.js` so a bad value is
 * reported with the same wording the registration form uses, and so the service
 * stays callable from a test with plain arguments.
 *
 * @param {object} [db] Executor override for tests; production passes the pool.
 * @param {{ name: string, email: string, password: string }} input
 * @returns {Promise<{ created: boolean, user: object }>}
 * @throws {Error} when the configured values do not satisfy the password policy.
 */
export async function ensureBootstrapAdmin(db, { name, email, password }) {
  const parsed = bootstrapAdminSchema.safeParse({ name, email, password });

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new Error(
      `Invalid bootstrap administrator configuration (BOOTSTRAP_ADMIN_NAME/EMAIL/PASSWORD) — ${details}`
    );
  }

  const existing = await users.findByEmail(db, parsed.data.email);
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await users.upsertAdmin(db, {
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
  });

  return { created: existing === null, user };
}

export default { ensureBootstrapAdmin };
