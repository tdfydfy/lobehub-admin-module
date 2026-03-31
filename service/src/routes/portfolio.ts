import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getProjectOverview } from '../project-facts.js';
import { requireActor } from '../auth.js';
import { query } from '../db.js';

type PortfolioProjectRow = {
  id: string;
  name: string;
  description: string | null;
  actor_role: 'system_admin' | 'admin';
  admin_count: number;
  member_count: number;
};

async function fetchPortfolioProjects(actorId: string, isSystemAdmin: boolean) {
  if (isSystemAdmin) {
    return query<PortfolioProjectRow>(
      `
      select
        p.id,
        p.name,
        p.description,
        'system_admin'::text as actor_role,
        count(*) filter (where pm.role = 'admin')::int as admin_count,
        count(*) filter (where pm.role = 'member')::int as member_count
      from lobehub_admin.projects p
      left join lobehub_admin.project_members pm
        on pm.project_id = p.id
      group by p.id
      order by p.created_at desc
      `,
    );
  }

  return query<PortfolioProjectRow>(
    `
    select
      p.id,
      p.name,
      p.description,
      'admin'::text as actor_role,
      count(*) filter (where pm.role = 'admin')::int as admin_count,
      count(*) filter (where pm.role = 'member')::int as member_count
    from lobehub_admin.projects p
    join lobehub_admin.project_members pm_actor
      on pm_actor.project_id = p.id
     and pm_actor.user_id = $1
     and pm_actor.role = 'admin'
    left join lobehub_admin.project_members pm
      on pm.project_id = p.id
    group by p.id
    order by p.created_at desc
    `,
    [actorId],
  );
}

async function fetchProjectJobCounts(projectId: string) {
  const result = await query<{ running_job_count: number; failed_job_count: number }>(
    `
    select
      (
        select count(*)::int
        from lobehub_admin.provision_jobs pj
        where pj.project_id = $1
          and pj.status in ('pending', 'running')
      ) +
      (
        select count(*)::int
        from lobehub_admin.daily_report_jobs dj
        where dj.project_id = $1
          and dj.status in ('pending', 'running')
      ) as running_job_count,
      (
        select count(*)::int
        from lobehub_admin.provision_jobs pj
        where pj.project_id = $1
          and pj.status = 'failed'
      ) +
      (
        select count(*)::int
        from lobehub_admin.daily_report_jobs dj
        where dj.project_id = $1
          and dj.status = 'failed'
      ) as failed_job_count
    `,
    [projectId],
  );

  return result.rows[0] ?? { running_job_count: 0, failed_job_count: 0 };
}

export async function registerPortfolioRoutes(app: FastifyInstance) {
  app.get('/api/portfolio/projects', async (request) => {
    const actor = await requireActor(request);
    const filters = z.object({
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(request.query);
    const projectsResult = await fetchPortfolioProjects(actor.id, actor.isSystemAdmin);

    if (!actor.isSystemAdmin && projectsResult.rows.length === 0) {
      const error = new Error('Project admin access required');
      (error as Error & { statusCode?: number }).statusCode = 403;
      throw error;
    }

    const rows = await Promise.all(projectsResult.rows.map(async (project) => {
      const [overview, jobCounts] = await Promise.all([
        getProjectOverview(project.id, filters.businessDate),
        fetchProjectJobCounts(project.id),
      ]);

      return {
        projectId: project.id,
        projectName: project.name,
        description: project.description,
        actorRole: project.actor_role,
        adminCount: project.admin_count,
        memberCount: project.member_count,
        managedMemberCount: overview?.members.managedMemberCount ?? 0,
        businessDate: overview?.project.businessDate ?? null,
        newTopicCount: overview?.stats.newTopicCount ?? 0,
        activeTopicCount: overview?.stats.activeTopicCount ?? 0,
        visitCustomerCount: overview?.stats.visitCustomerCount ?? 0,
        firstVisitCount: overview?.stats.firstVisitCount ?? 0,
        revisitCount: overview?.stats.revisitCount ?? 0,
        activeMemberCount: overview?.stats.activeMemberCount ?? 0,
        aIntentCount: overview?.stats.aIntentCount ?? 0,
        bIntentCount: overview?.stats.bIntentCount ?? 0,
        cIntentCount: overview?.stats.cIntentCount ?? 0,
        dIntentCount: overview?.stats.dIntentCount ?? 0,
        lowMediumIntentCount: (overview?.stats.cIntentCount ?? 0) + (overview?.stats.dIntentCount ?? 0),
        highIntentCount: overview?.stats.highIntentCount ?? 0,
        missingIntentCount: overview?.stats.missingIntentCount ?? 0,
        latestReportBusinessDate: overview?.latestReport?.businessDate ?? null,
        latestReportGeneratedAt: overview?.latestReport?.generatedAt ?? null,
        runningJobCount: jobCounts.running_job_count,
        failedJobCount: jobCounts.failed_job_count,
      };
    }));

    rows.sort((left, right) =>
      right.revisitCount - left.revisitCount
      || right.highIntentCount - left.highIntentCount
      || right.failedJobCount - left.failedJobCount
      || right.runningJobCount - left.runningJobCount
      || left.projectName.localeCompare(right.projectName, 'zh-CN'));

    return { rows };
  });

  app.get('/api/portfolio/summary', async (request) => {
    const actor = await requireActor(request);
    const filters = z.object({
      businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(request.query);
    const projectsResult = await fetchPortfolioProjects(actor.id, actor.isSystemAdmin);

    if (!actor.isSystemAdmin && projectsResult.rows.length === 0) {
      const error = new Error('Project admin access required');
      (error as Error & { statusCode?: number }).statusCode = 403;
      throw error;
    }

    const overviews = (await Promise.all(projectsResult.rows.map((project) => getProjectOverview(project.id, filters.businessDate))))
      .filter((overview): overview is NonNullable<Awaited<ReturnType<typeof getProjectOverview>>> => Boolean(overview));

    const summary = overviews.reduce((accumulator, overview) => {
      accumulator.projectCount += 1;
      accumulator.visitCustomerCount += overview.stats.visitCustomerCount;
      accumulator.firstVisitCount += overview.stats.firstVisitCount;
      accumulator.revisitCount += overview.stats.revisitCount;
      accumulator.newTopicCount += overview.stats.newTopicCount;
      accumulator.activeTopicCount += overview.stats.activeTopicCount;
      accumulator.activeMemberCount += overview.stats.activeMemberCount;
      accumulator.cIntentCount += overview.stats.cIntentCount;
      accumulator.dIntentCount += overview.stats.dIntentCount;
      accumulator.lowMediumIntentCount += overview.stats.cIntentCount + overview.stats.dIntentCount;
      accumulator.highIntentCount += overview.stats.highIntentCount;
      accumulator.missingIntentCount += overview.stats.missingIntentCount;
      return accumulator;
    }, {
      projectCount: 0,
      visitCustomerCount: 0,
      firstVisitCount: 0,
      revisitCount: 0,
      newTopicCount: 0,
      activeTopicCount: 0,
      activeMemberCount: 0,
      cIntentCount: 0,
      dIntentCount: 0,
      lowMediumIntentCount: 0,
      highIntentCount: 0,
      missingIntentCount: 0,
    });

    const jobCounts = await Promise.all(projectsResult.rows.map((project) => fetchProjectJobCounts(project.id)));

    return {
      summary: {
        ...summary,
        runningJobCount: jobCounts.reduce((total, item) => total + item.running_job_count, 0),
        failedJobCount: jobCounts.reduce((total, item) => total + item.failed_job_count, 0),
      },
    };
  });
}
