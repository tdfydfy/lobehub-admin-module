import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdminRequest } from '../auth.js';
import { getProjectOverview } from '../project-facts.js';

export async function registerOverviewRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/overview', async (request) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const filters = z.object({
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const overview = await getProjectOverview(params.projectId, filters.businessDate);

    if (!overview) {
      const error = new Error(`Project not found: ${params.projectId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    return { overview };
  });
}
