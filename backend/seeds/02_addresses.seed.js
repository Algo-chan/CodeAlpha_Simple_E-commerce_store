/**
 * 02_addresses.seed.js — one delivery address per customer.
 *
 * Deliberately one address each: v1 has a single address per customer, and
 * is_default + the partial unique index already allow more later.
 *
 * The SUSPENDED account has no address: the auth service can reject an account
 * before any address is ever needed.
 */
const ADDRESSES = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000002',
    label: 'Home',
    fullName: 'Abebe Bekele',
    phone: '0911223344',
    city: 'Addis Ababa',
    area: 'Bole',
    street: 'Bole Road, House 24',
    landmark: 'Near Bole Medhanialem',
    additionalNotes: 'Call before arriving; I work until 6pm.',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    userId: '10000000-0000-4000-8000-000000000003',
    label: 'Home',
    fullName: 'Sara Mohammed',
    phone: '0922334455',
    city: 'Addis Ababa',
    area: 'Kirkos',
    street: 'Bole Bulbula, Apartment 3B',
    landmark: 'Opposite Millennium Hall',
    additionalNotes: null,
  },
];

export default async function up({ query }) {
  for (const address of ADDRESSES) {
    await query(
      `INSERT INTO addresses
         (id, user_id, label, full_name, phone, city, area, street, landmark,
          additional_notes, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
       ON CONFLICT (id) DO UPDATE SET
         label            = EXCLUDED.label,
         full_name        = EXCLUDED.full_name,
         phone            = EXCLUDED.phone,
         city             = EXCLUDED.city,
         area             = EXCLUDED.area,
         street           = EXCLUDED.street,
         landmark         = EXCLUDED.landmark,
         additional_notes = EXCLUDED.additional_notes,
         is_default       = TRUE`,
      [
        address.id,
        address.userId,
        address.label,
        address.fullName,
        address.phone,
        address.city,
        address.area,
        address.street,
        address.landmark,
        address.additionalNotes,
      ]
    );
  }
}
