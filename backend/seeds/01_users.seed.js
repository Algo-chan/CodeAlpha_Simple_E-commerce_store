/**
 * 01_users.seed.js — demo accounts.
 *
 * DEMO CREDENTIALS
 *   Every account uses the same deliberately unusable password hash: a
 *   well-formed bcrypt string made only of zeros. It passes the database's
 *   "must be a hash, never plain text" CHECK, but it can never be produced by
 *   hashing a real password, so no seed account can be logged into.
 *   Password hashing is built in the auth phase, which will generate real
 *   hashes for a local `.env`-driven demo user instead.
 *
 * Re-runnable: fixed ids, upserted on every run.
 */
import { daysBeforeNow } from './_reference_time.js';

const DEMO_PASSWORD_HASH = '$2b$12$0000000000000000000000000000000000000000000000000000';

const USERS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Store Administrator',
    email: 'admin@example.com',
    phone: '0911000000',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Abebe Bekele',
    email: 'abebe@example.com',
    phone: '0911223344',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Sara Mohammed',
    email: 'sara@example.com',
    phone: '0922334455',
    role: 'CUSTOMER',
    status: 'ACTIVE',
  },
  {
    // Exercises the non-ACTIVE branch: an admin can see and act on it, and
    // the auth service must refuse to issue tokens for it.
    id: '10000000-0000-4000-8000-000000000004',
    name: 'Dawit Tesfaye',
    email: 'dawit@example.com',
    phone: '0933445566',
    role: 'CUSTOMER',
    status: 'SUSPENDED',
  },
];

export default async function up({ query }) {
  for (const user of USERS) {
    await query(
      `INSERT INTO users
         (id, name, email, phone, password_hash, role, status, password_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name                = EXCLUDED.name,
         email               = EXCLUDED.email,
         phone               = EXCLUDED.phone,
         password_hash       = EXCLUDED.password_hash,
         role                = EXCLUDED.role,
         status              = EXCLUDED.status,
         password_changed_at = EXCLUDED.password_changed_at`,
      [
        user.id,
        user.name,
        user.email,
        user.phone,
        DEMO_PASSWORD_HASH,
        user.role,
        user.status,
        daysBeforeNow(90),
      ]
    );
  }
}
