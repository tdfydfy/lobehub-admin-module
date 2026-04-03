import { Pool, type QueryResultRow } from 'pg';
import { env } from './config.js';

export const db = new Pool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: env.DB_CONNECTION_TIMEOUT_MS,
  query_timeout: env.DB_QUERY_TIMEOUT_MS,
  keepAlive: true,
});

db.on('error', (error) => {
  // pg pool can emit idle-client errors asynchronously; keep the service alive and surface the root cause.
  console.error('PostgreSQL pool error', error);
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return db.query<T>(text, values);
}
