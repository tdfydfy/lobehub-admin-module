import { Pool, type QueryResultRow } from 'pg';
import { env } from './config.js';

export const db = new Pool({
  connectionString: env.DATABASE_URL,
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return db.query<T>(text, values);
}
