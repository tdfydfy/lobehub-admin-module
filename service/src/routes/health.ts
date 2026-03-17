import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const result = await query<{ ok: number }>('select 1 as ok');
    return {
      ok: result.rows[0]?.ok === 1,
      service: 'lobehub-admin-service',
    };
  });
}
