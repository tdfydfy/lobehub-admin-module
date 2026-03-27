import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdminRequest } from '../auth.js';
import { enqueueProjectCustomerAnalysisJob } from '../customer-analysis-jobs.js';
import {
  createProjectCustomerAnalysisSession,
  getProjectCustomerAnalysisJob,
  getProjectCustomerAnalysisSession,
  listProjectCustomerAnalysisJobs,
  listProjectCustomerAnalysisSessions,
} from '../project-customer-analysis.js';

const createSessionSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

const sendMessageSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  rangePreset: z.enum(['today', 'last7days', 'last30days', 'custom']).default('last7days'),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function registerCustomerAnalysisRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/customer-analysis/sessions', async (request) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    return {
      sessions: await listProjectCustomerAnalysisSessions(params.projectId),
    };
  });

  app.post('/api/projects/:projectId/customer-analysis/sessions', async (request, reply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const body = createSessionSchema.parse(request.body ?? {});

    const result = await createProjectCustomerAnalysisSession(params.projectId, actor.id, body.title);
    return reply.code(201).send(result);
  });

  app.get('/api/projects/:projectId/customer-analysis/sessions/:sessionId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      sessionId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    return getProjectCustomerAnalysisSession(params.projectId, params.sessionId);
  });

  app.post('/api/projects/:projectId/customer-analysis/sessions/:sessionId/messages', async (request, reply) => {
    const params = z.object({
      projectId: z.string().min(1),
      sessionId: z.string().min(1),
    }).parse(request.params);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const body = sendMessageSchema.parse(request.body ?? {});

    return reply.code(202).send(
      await enqueueProjectCustomerAnalysisJob(params.projectId, params.sessionId, actor.id, body, app.log),
    );
  });

  app.get('/api/projects/:projectId/customer-analysis/jobs', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    return {
      jobs: await listProjectCustomerAnalysisJobs(params.projectId, 12),
    };
  });

  app.get('/api/projects/:projectId/customer-analysis/jobs/:jobId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      jobId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const job = await getProjectCustomerAnalysisJob(params.projectId, params.jobId);

    if (!job) {
      const error = new Error(`Customer analysis job not found: ${params.jobId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    return { job };
  });
}
