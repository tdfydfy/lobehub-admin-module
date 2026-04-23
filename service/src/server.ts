import { env } from './config.js';
import { startCrmSummarySyncScheduler, stopCrmSummarySyncScheduler } from './crm-summary-sync.js';
import { resumePendingCustomerAnalysisJobs } from './customer-analysis-jobs.js';
import { db } from './db.js';
import { resumePendingDailyReportJobs, startDailyReportScheduler, stopDailyReportScheduler } from './daily-report-jobs.js';
import { resumePendingProvisionJobs } from './provision-jobs.js';
import { buildApp } from './app.js';
import { getVolcengineRuntimeConfig } from './volcengine-config.js';

const app = await buildApp();
const volcengine = getVolcengineRuntimeConfig();

if (env.DAILY_REPORT_DEFAULT_MODEL_PROVIDER === 'volcengine' && !volcengine.hasUsableApiKey) {
  app.log.warn(
    { issue: volcengine.apiKeyIssue ?? 'VOLCENGINE_API_KEY is missing' },
    'Volcengine model provider is enabled but API key is not usable; daily report and customer analysis will fall back',
  );
}

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
