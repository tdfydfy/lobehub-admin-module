import type { FastifyBaseLogger } from 'fastify';
import { query } from './db.js';
import { createQueuedProjectCustomerAnalysisJob, runProjectCustomerAnalysisJob } from './project-customer-analysis.js';

const scheduledCustomerAnalysisJobs = new Set<string>();

async function executeCustomerAnalysisJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  try {
    const result = await runProjectCustomerAnalysisJob(jobId);
    log.info({ jobId, sessionId: result.job.sessionId, status: result.job.status }, 'Customer analysis job completed');
  } catch (error) {
    log.error({ jobId, error }, 'Customer analysis job execution failed');
  } finally {
    scheduledCustomerAnalysisJobs.delete(jobId);
  }
}

export function scheduleCustomerAnalysisJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  if (!jobId || scheduledCustomerAnalysisJobs.has(jobId)) {
    return false;
  }

  scheduledCustomerAnalysisJobs.add(jobId);
  setImmediate(() => {
    void executeCustomerAnalysisJob(jobId, log);
  });

  return true;
}

export async function enqueueProjectCustomerAnalysisJob(
  projectId: string,
  sessionId: string,
  actorId: string,
  input: {
    prompt: string;
    rangePreset: 'today' | 'last7days' | 'last30days' | 'custom';
    dateFrom?: string | null;
    dateTo?: string | null;
  },
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>,
) {
  const result = await createQueuedProjectCustomerAnalysisJob(projectId, sessionId, actorId, input);
  scheduleCustomerAnalysisJob(result.job.id, log);
  return result;
}

export async function resumePendingCustomerAnalysisJobs(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  const result = await query<{ id: string; project_id: string; session_id: string; status: string }>(
    `
    select
      id,
      project_id,
      session_id,
      status
    from lobehub_admin.project_customer_analysis_jobs
    where status in ('pending', 'running')
    order by created_at asc
    `,
  );

  for (const row of result.rows) {
    const scheduled = scheduleCustomerAnalysisJob(row.id, log);

    if (scheduled) {
      log.info(
        { jobId: row.id, projectId: row.project_id, sessionId: row.session_id, status: row.status },
        'Scheduled pending customer analysis job',
      );
    }
  }
}
