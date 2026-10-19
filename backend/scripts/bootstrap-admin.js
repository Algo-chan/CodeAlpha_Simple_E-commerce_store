/**
 * Bootstrap administrator — creates or refreshes one ADMIN account on boot.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='...' \
 *     node backend/scripts/bootstrap-admin.js
 *
 * Why this exists: a host without a shell (Render's free plan has neither Shell
 * nor one-off jobs) gives no way to promote a registered account with SQL. Set
 * the two variables and the account is created for you. Unset them and this
 * script does nothing and exits 0, so it is safe to run on every boot.
 *
 * The password is re-applied on every boot and is never echoed. Remove the two
 * variables once the account is set up — unless you want it as a recovery path.
 *
 * Run by the container's start command (see the Dockerfile). A failure here
 * aborts the boot on purpose: a deployment whose administrator cannot be created
 * is better stopped than left without one.
 */
import { closePool, query } from '../src/config/db.js';
import env from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';
import { ensureBootstrapAdmin } from '../src/services/admin-bootstrap.service.js';

async function main() {
  const email = env.BOOTSTRAP_ADMIN_EMAIL.trim();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email && !password) {
    logger.info('Bootstrap administrator skipped: BOOTSTRAP_ADMIN_EMAIL is not set.');
    return;
  }

  // Pass the shared-pool helper as the executor, which is what repositories fall
  // back to when a request has no `req.db`. Passing the `pg` Pool itself would
  // not do: the repository calls `db.query(...)` detached from its owner, and
  // `Pool.query` needs the pool as `this`.
  const { created, user } = await ensureBootstrapAdmin(
    { query },
    {
      name: env.BOOTSTRAP_ADMIN_NAME,
      email,
      password,
    }
  );

  logger.info(
    `Bootstrap administrator ${created ? 'created' : 'updated'}: ${user.email} (role=${user.role}, status=${user.status})`
  );
}

main()
  .catch((error) => {
    logger.error('Bootstrap administrator failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
