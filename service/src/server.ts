import { env } from './config.js';
import { startCrmSummarySyncScheduler, stopCrmSummarySyncScheduler } from './crm-summary-sync.js';
import { resumePendingCustomerAnalysisJobs } from './customer-analysis-jobs.js';
import { db } from './db.js';
import { resumePendingDailyReportJobs, startDailyReportScheduler, stopDailyReportScheduler } from './daily-report-jobs.js';
import { resumePendingProvisionJobs } from './provision-jobs.js';
import { buildApp } from './app.js';

const app = await buildApp();
await resumePendingProvisionJobs(app.log);
await resumePendingDailyReportJobs(app.log);
await resumePendingCustomerAnalysisJobs(app.log);
startDailyReportScheduler(app.log);
startCrmSummarySyncScheduler(app.log);

const shutdown = async () => {
  stopDailyReportScheduler();
  stopCrmSummarySyncScheduler();
  await app.close();
  await db.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({
  port: env.PORT,
  host: env.HOST,
});
