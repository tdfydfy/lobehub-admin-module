import type { FastifyBaseLogger } from 'fastify';
import { createDailyReportJob, getCurrentDailyReportForBusinessDate, listDueDailyReportProjects, runDailyReportJob } from './daily-reports.js';
import { query } from './db.js';
import { getLatestClosedBusinessDate } from './daily-report-time.js';

const scheduledDailyReportJobs = new Set<string>();
let schedulerHandle: NodeJS.Timeout | null = null;
let scanInProgress = false;

async function executeDailyReportJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  try {
    const result = await runDailyReportJob(jobId);
    log.info({ jobId, reportId: result.reportId }, 'Daily report job completed');
  } catch (error) {
    log.error({ jobId, error }, 'Daily report job execution failed');
  } finally {
    scheduledDailyReportJobs.delete(jobId);
  }
}

export function scheduleDailyReportJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  if (!jobId || scheduledDailyReportJobs.has(jobId)) {
    return false;
  }

  scheduledDailyReportJobs.add(jobId);
  setImmediate(() => {
    void executeDailyReportJob(jobId, log);
  });

  return true;
}

export async function enqueueManualDailyReportJob(
  projectId: string,
  businessDate: string,
  actorId: string,
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>,
) {
  const jobId = await createDailyReportJob(projectId, businessDate, 'manual', actorId);

  if (jobId) {
    scheduleDailyReportJob(jobId, log);
  }

  return jobId;
}

async function scanDueDailyReports(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  if (scanInProgress) {
    return;
  }

  scanInProgress = true;

  try {
    const now = new Date();
    const dueProjects = await listDueDailyReportProjects(now);

    for (const item of dueProjects) {
      try {
        const businessDate = getLatestClosedBusinessDate(
          now,
          item.setting.timezone,
          item.setting.businessDayCloseTimeLocal,
        );
        const existingReportId = await getCurrentDailyReportForBusinessDate(item.setting.projectId, businessDate);

        if (existingReportId) {
          continue;
        }

        const jobId = await createDailyReportJob(
          item.setting.projectId,
          businessDate,
          'scheduled',
          null,
        );

        if (jobId) {
          const scheduled = scheduleDailyReportJob(jobId, log);

          if (scheduled) {
            log.info({ jobId, projectId: item.setting.projectId, businessDate }, 'Scheduled due daily report job');
          }
        }
      } catch (error) {
        log.error({ projectId: item.setting.projectId, error }, 'Failed to scan due daily report for project');
      }
    }
  } catch (error) {
    log.error({ error }, 'Daily report scheduler scan failed');
  } finally {
    scanInProgress = false;
  }
}

export async function resumePendingDailyReportJobs(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  const result = await query<{ id: string; project_id: string; business_date: string; status: string }>(
    `
    select
      id,
      project_id,
      business_date::text as business_date,
      status
    from lobehub_admin.daily_report_jobs
    where status in ('pending', 'running')
    order by created_at asc
    `,
  );

  for (const row of result.rows) {
    const scheduled = scheduleDailyReportJob(row.id, log);

    if (scheduled) {
      log.info(
        { jobId: row.id, projectId: row.project_id, businessDate: row.business_date, status: row.status },
        'Scheduled pending daily report job',
      );
    }
  }
}

export function startDailyReportScheduler(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  if (schedulerHandle) {
    return schedulerHandle;
  }

  void scanDueDailyReports(log);
  schedulerHandle = setInterval(() => {
    void scanDueDailyReports(log);
  }, 60_000);

  return schedulerHandle;
}

export function stopDailyReportScheduler() {
  if (!schedulerHandle) {
    return;
  }

  clearInterval(schedulerHandle);
  schedulerHandle = null;
}
