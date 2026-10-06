import './tests/setup.js';
import { createMigratedDb } from './tests/helpers/database.js';
import { create as createAddress } from './src/repositories/address.repository.js';

const db = await createMigratedDb();
const user = await db.query(
  "INSERT INTO users (name, email, phone, password_hash, role, status) VALUES ('X','y2@example.com','0911111111','$2b$12$0000000000000000000000000000000000000000000000000000000000','CUSTOMER','ACTIVE') RETURNING id"
);
const uid = user.rows[0].id;
try {
  const r = await createAddress({ query: (t, p = []) => db.query(t, p) }, {
    userId: uid,
    fullName: 'DBG User',
    phone: '0911111111',
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road',
    landmark: 'Edna Mall',
    additionalNotes: 'Call',
    label: 'Home',
  });
  console.log('repo create ok', JSON.stringify(r));
} catch (e) {
  console.log('repo error code:', e.code, '| message:', e.message.slice(0, 300));
}
await db.close();