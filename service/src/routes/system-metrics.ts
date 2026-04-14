import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireActor } from '../auth.js';
import { getSystemMetrics } from '../system-metrics.js';

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

export async function registerSystemMetricsRoutes(app: FastifyInstance) {
  const handleGetSystemMetrics = async (request: FastifyRequest) => {
    const actor = await requireActor(request);

    if (!actor.isSystemAdmin) {
      throw withStatus('System admin access required', 403);
    }

    const filters = z.object({
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(request.query);

    return getSystemMetrics(filters);
  };

  app.get('/api/system/metrics', handleGetSystemMetrics);
  app.get('/system/metrics', handleGetSystemMetrics);
}
