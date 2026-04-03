import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdminRequest } from '../auth.js';
import { enqueueManualDailyReportJob } from '../daily-report-jobs.js';
import {
  getLatestDailyReportJobs,
  getProjectDailyReportDetail,
  getProjectDailyReportJob,
  getProjectDailyReportSetting,
  listProjectDailyReports,
  upsertProjectDailyReportSetting,
} from '../daily-reports.js';
import { getLatestClosedBusinessDate, isValidTimeZone, normalizeTimeString } from '../daily-report-time.js';

const paramsSchema = z.object({
  projectId: z.string().min(1),
});

const reportListQuerySchema = z.object({
  businessDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  businessDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine((value, context) => {
  if (value.businessDateFrom && value.businessDateTo && value.businessDateFrom > value.businessDateTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'businessDateFrom must be less than or equal to businessDateTo',
      path: ['businessDateFrom'],
    });
  }
});

const settingBodySchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).default('Asia/Shanghai'),
  businessDayCloseTimeLocal: z.string().trim().min(1),
  promptTemplate: z.string().default(''),
  generateWhenNoVisit: z.boolean().default(true),
});

const runBodySchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function registerDailyReportRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/reports/daily-settings', async (request) => {
    const params = paramsSchema.parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    return {
      settings: await getProjectDailyReportSetting(params.projectId),
    };
  });

  app.put('/api/projects/:projectId/reports/daily-settings', async (request) => {
    const params = paramsSchema.parse(request.params);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const payload = settingBodySchema.parse(request.body);

    if (!isValidTimeZone(payload.timezone)) {
      const error = new Error(`Invalid timezone: ${payload.timezone}`);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    const businessDayCloseTimeLocal = normalizeTimeString(payload.businessDayCloseTimeLocal);
    const settings = await upsertProjectDailyReportSetting(params.projectId, actor.id, {
      enabled: payload.enabled,
      timezone: payload.timezone,
      businessDayCloseTimeLocal,
      promptTemplate: payload.promptTemplate,
      generateWhenNoVisit: payload.generateWhenNoVisit,
    });

    return { settings };
  });

  app.get('/api/projects/:projectId/reports/daily-reports', async (request) => {
    const params = paramsSchema.parse(request.params);
    const filters = reportListQuerySchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    return listProjectDailyReports(params.projectId, filters);
  });

  app.get('/api/projects/:projectId/reports/daily-reports/:reportId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      reportId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const report = await getProjectDailyReportDetail(params.projectId, params.reportId);

    if (!report) {
      const error = new Error(`Daily report not found: ${params.reportId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    return {
      report: {
        id: report.id,
        projectId: report.project_id,
        businessDate: report.business_date,
        revision: report.revision,
        isCurrent: report.is_current,
        jobId: report.job_id,
        timezone: report.timezone,
        windowStartAt: report.window_start_at,
        windowEndAt: report.window_end_at,
        visitedCustomerCount: report.visited_customer_count,
        activeTopicCount: report.active_topic_count,
        totalMessageCount: report.total_message_count,
        userMessageCount: report.user_message_count,
        assistantMessageCount: report.assistant_message_count,
        summaryJson: report.summary_json,
        summaryMarkdown: report.summary_markdown,
        promptSnapshot: report.prompt_snapshot,
        systemPromptVersion: report.system_prompt_version,
        modelProvider: report.model_provider,
        modelName: report.model_name,
        generationMeta: report.generation_meta,
        createdBy: report.created_by,
        createdAt: report.created_at,
        updatedAt: report.updated_at,
      },
    };
  });

  app.post('/api/projects/:projectId/reports/daily-reports/run', async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const body = runBodySchema.parse(request.body);
    const settings = await getProjectDailyReportSetting(params.projectId);
    const businessDate = body.businessDate
      ?? getLatestClosedBusinessDate(new Date(), settings.timezone, settings.businessDayCloseTimeLocal);
    const jobId = await enqueueManualDailyReportJob(params.projectId, businessDate, actor.id, app.log);

    reply.status(202);
    return {
      jobId,
      businessDate,
    };
  });

  app.get('/api/projects/:projectId/reports/daily-jobs', async (request) => {
    const params = paramsSchema.parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const jobs = await getLatestDailyReportJobs(params.projectId, 8);

    return {
      jobs: jobs.map((job) => ({
        id: job.id,
        businessDate: job.business_date,
        triggerSource: job.trigger_source,
        status: job.status,
        timezone: job.timezone,
        closeTimeLocal: job.close_time_local,
        windowStartAt: job.window_start_at,
        windowEndAt: job.window_end_at,
        modelProvider: job.model_provider,
        modelName: job.model_name,
        reportId: job.report_id,
        createdBy: job.created_by,
        errorMessage: job.error_message,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      })),
    };
  });

  app.get('/api/projects/:projectId/reports/daily-jobs/:jobId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      jobId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const job = await getProjectDailyReportJob(params.projectId, params.jobId);

    if (!job) {
      const error = new Error(`Daily report job not found: ${params.jobId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    return {
      job: {
        id: job.id,
        projectId: job.project_id,
        businessDate: job.business_date,
        triggerSource: job.trigger_source,
        status: job.status,
        timezone: job.timezone,
        closeTimeLocal: job.close_time_local,
        windowStartAt: job.window_start_at,
        windowEndAt: job.window_end_at,
        promptSnapshot: job.prompt_snapshot,
        modelProvider: job.model_provider,
        modelName: job.model_name,
        reportId: job.report_id,
        createdBy: job.created_by,
        errorMessage: job.error_message,
        startedAt: job.started_at,
        finishedAt: job.finished_at,
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
    };
  });
}
