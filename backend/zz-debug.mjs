import { PGlite } from '@electric-sql/pglite';

const db = await PGlite.create();
await db.query('CREATE TABLE t (id text primary key, cart_id text)');
await db.query("INSERT INTO t VALUES ('a', 'c1')");
await db.query('BEGIN');
const r = await db.query('DELETE FROM t WHERE id = $1 AND cart_id = $2', ['a', 'c1']);
console.log('delete rowCount', r.rowCount, 'affectedRows', r.affectedRows, 'rows', r.rows);
await db.query('ROLLBACK');
const f = await db.query('SELECT * FROM t');
console.log('after rollback', f.rows);
await db.close();