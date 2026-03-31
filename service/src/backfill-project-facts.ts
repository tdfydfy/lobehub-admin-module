import 'dotenv/config';
import { addDays, getLocalDateString } from './daily-report-time.js';
import { db, query } from './db.js';
import { rebuildProjectTopicDailyFacts, resolveProjectFactWindow } from './project-facts.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result: { projectId?: string; days: number } = { days: 30 };

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === '--project-id' && args[index + 1]) {
      result.projectId = args[index + 1];
      index += 1;
      continue;
    }

    if (current === '--days' && args[index + 1]) {
      const days = Number(args[index + 1]);
      if (Number.isFinite(days) && days > 0) {
        result.days = Math.floor(days);
      }
      index += 1;
    }
  }

  return result;
}

async function getProjectIds(projectId?: string) {
  if (projectId) {
    return [projectId];
  }

  const result = await query<{ id: string }>(
    `
    select id
    from lobehub_admin.projects
    order by created_at desc
    `,
  );

  return result.rows.map((row) => row.id);
}

async function main() {
  const options = parseArgs();
  const projectIds = await getProjectIds(options.projectId);
  const today = getLocalDateString(new Date(), 'Asia/Shanghai');
  const businessDates = Array.from({ length: options.days }, (_, offset) => addDays(today, -offset));

  for (const projectId of projectIds) {
    console.log(`==> backfilling project ${projectId}`);

    for (const businessDate of businessDates) {
      const window = await resolveProjectFactWindow(projectId, businessDate);
      const count = await rebuildProjectTopicDailyFacts(projectId, window);
      console.log(`  ${businessDate}: ${count} fact rows`);
    }
  }
}

try {
  await main();
} finally {
  await db.end();
}
