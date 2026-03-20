import type { FastifyBaseLogger } from 'fastify';
import { query } from './db.js';

type ProvisionJobType = 'configure' | 'refresh';

type ProjectTemplateSnapshotRow = {
  template_user_id: string | null;
  template_agent_id: string | null;
  copy_skills: boolean;
};

type ProvisionJobRow = {
  id: string;
  project_id: string;
  job_type: ProvisionJobType;
  status: string;
  template_user_id: string | null;
  template_agent_id: string | null;
  copy_skills: boolean;
  set_default_agent: boolean;
  created_by: string | null;
};

type ProjectMemberRow = {
  user_id: string;
};

type ExistingProvisionJobRow = {
  id: string;
};

type ProvisionMemberResultRow = {
  status: 'success' | 'failed' | 'skipped';
  message: string | null;
  managed_agent_id: string | null;
  managed_session_id: string | null;
  copied_skill_count: number;
};

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function mapJobItemStatus(status: ProvisionMemberResultRow['status']) {
  switch (status) {
    case 'success':
      return 'success';
    case 'skipped':
      return 'skipped';
    case 'failed':
    default:
      return 'failed';
  }
}

function resolveFinalJobStatus(total: number, success: number, failed: number, skipped: number) {
  if (total === 0 || failed === 0) {
    return 'completed';
  }

  if (success > 0 || skipped > 0) {
    return 'partial';
  }

  return 'failed';
}

const scheduledProvisionJobs = new Set<string>();

export async function enqueueProvisionJob(
  projectId: string,
  jobType: ProvisionJobType,
  createdBy: string,
  setDefaultAgent: boolean,
) {
  const activeJobResult = await query<ExistingProvisionJobRow>(
    `
    select id
    from lobehub_admin.provision_jobs
    where project_id = $1
      and status in ('pending', 'running')
    order by created_at desc
    limit 1
    `,
    [projectId],
  );

  const activeJob = activeJobResult.rows[0];

  if (activeJob) {
    throw withStatus(`A provision job is already running for this project: ${activeJob.id}`, 409);
  }

  const templateResult = await query<ProjectTemplateSnapshotRow>(
    `
    select
      template_user_id,
      template_agent_id,
      copy_skills
    from lobehub_admin.project_templates
    where project_id = $1
    limit 1
    `,
    [projectId],
  );

  const template = templateResult.rows[0];

  if (!template?.template_user_id || !template.template_agent_id) {
    throw withStatus('Project template is not configured', 409);
  }

  const membersResult = await query<ProjectMemberRow>(
    `
    select pm.user_id
    from lobehub_admin.project_members pm
    where pm.project_id = $1
      and pm.role = 'member'
    order by pm.joined_at asc
    `,
    [projectId],
  );

  const memberIds = membersResult.rows.map((row) => row.user_id);
  const jobResult = await query<{ id: string }>(
    `
    insert into lobehub_admin.provision_jobs (
      project_id,
      job_type,
      status,
      template_user_id,
      template_agent_id,
      copy_skills,
      set_default_agent,
      total_count,
      created_by
    )
    values ($1, $2, 'pending', $3, $4, $5, $6, $7, $8)
    returning id
    `,
    [
      projectId,
      jobType,
      template.template_user_id,
      template.template_agent_id,
      template.copy_skills,
      setDefaultAgent,
      memberIds.length,
      createdBy,
    ],
  );

  const jobId = jobResult.rows[0]?.id ?? null;

  if (jobId && memberIds.length > 0) {
    await query(
      `
      insert into lobehub_admin.provision_job_items (job_id, user_id, status)
      select $1, snapshot.user_id, 'pending'
      from unnest($2::text[]) with ordinality as snapshot(user_id, ord)
      order by snapshot.ord
      `,
      [jobId, memberIds],
    );
  }

  return jobId;
}

async function markProvisionJobFailed(jobId: string, errorMessage: string) {
  await query(
    `
    update lobehub_admin.provision_jobs
    set status = 'failed',
        error_message = $2,
        finished_at = now(),
        updated_at = now()
    where id = $1
    `,
    [jobId, errorMessage],
  );
}

async function runProvisionJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  try {
    const jobResult = await query<ProvisionJobRow>(
      `
      select
        id,
        project_id,
        job_type,
        status,
        template_user_id,
        template_agent_id,
        copy_skills,
        set_default_agent,
        created_by
      from lobehub_admin.provision_jobs
      where id = $1
      limit 1
      `,
      [jobId],
    );

    const job = jobResult.rows[0];

    if (!job) {
      log.warn({ jobId }, 'Provision job not found');
      return;
    }

    if (job.status === 'completed' || job.status === 'partial' || job.status === 'failed') {
      log.info({ jobId, status: job.status }, 'Skipping terminal provision job');
      return;
    }

    if (!job.template_user_id || !job.template_agent_id) {
      await markProvisionJobFailed(jobId, 'Project template is not configured');
      return;
    }

    await query(
      `
      update lobehub_admin.provision_jobs
      set status = 'running',
          error_message = null,
          started_at = coalesce(started_at, now()),
          finished_at = null,
          total_count = 0,
          success_count = 0,
          failed_count = 0,
          skipped_count = 0,
          updated_at = now()
      where id = $1
      `,
      [jobId],
    );

    let membersResult = await query<ProjectMemberRow>(
      `
      select j.user_id
      from lobehub_admin.provision_job_items j
      where j.job_id = $1
      order by j.created_at asc, j.user_id asc
      `,
      [jobId],
    );

    if (membersResult.rows.length === 0) {
      membersResult = await query<ProjectMemberRow>(
        `
        select pm.user_id
        from lobehub_admin.project_members pm
        where pm.project_id = $1
          and pm.role = 'member'
        order by pm.joined_at asc
        `,
        [job.project_id],
      );

      const fallbackMemberIds = membersResult.rows.map((row) => row.user_id);

      if (fallbackMemberIds.length > 0) {
        await query(
          `
          insert into lobehub_admin.provision_job_items (job_id, user_id, status)
          select $1, snapshot.user_id, 'pending'
          from unnest($2::text[]) with ordinality as snapshot(user_id, ord)
          order by snapshot.ord
          `,
          [jobId, fallbackMemberIds],
        );
      }
    }

    let total = 0;
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const member of membersResult.rows) {
      total += 1;

      await query(
        `
        insert into lobehub_admin.provision_job_items (job_id, user_id, status, started_at)
        values ($1, $2, 'running', now())
        on conflict (job_id, user_id) do update
          set status = 'running',
              started_at = now(),
              finished_at = null,
              message = null,
              managed_agent_id = null,
              managed_session_id = null,
              updated_at = now()
        `,
        [jobId, member.user_id],
      );

      try {
        const memberResult = await query<ProvisionMemberResultRow>(
          `
          select
            status,
            message,
            managed_agent_id,
            managed_session_id,
            copied_skill_count
          from lobehub_admin.provision_project_member($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            job.project_id,
            member.user_id,
            job.template_user_id,
            job.template_agent_id,
            job.copy_skills,
            job.job_type === 'refresh',
            job.set_default_agent,
            jobId,
          ],
        );

        const item = memberResult.rows[0];

        if (!item) {
          throw new Error('Provision job item returned no result');
        }

        await query(
          `
          update lobehub_admin.provision_job_items
          set status = $3,
              message = $4,
              managed_agent_id = $5,
              managed_session_id = $6,
              finished_at = now(),
              updated_at = now()
          where job_id = $1
            and user_id = $2
          `,
          [
            jobId,
            member.user_id,
            mapJobItemStatus(item.status),
            item.message,
            item.managed_agent_id,
            item.managed_session_id,
          ],
        );

        if (item.status === 'success') {
          success += 1;
        } else if (item.status === 'skipped') {
          skipped += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;

        const message = (error as Error).message;

        await query(
          `
          update lobehub_admin.provision_job_items
          set status = 'failed',
              message = $3,
              finished_at = now(),
              updated_at = now()
          where job_id = $1
            and user_id = $2
          `,
          [jobId, member.user_id, message],
        );

        await query(
          `
          insert into lobehub_admin.project_managed_agents (
            project_id,
            user_id,
            template_user_id,
            template_agent_id,
            last_job_id,
            last_status,
            last_message,
            updated_at
          )
          values ($1, $2, $3, $4, $5, 'failed', $6, now())
          on conflict (project_id, user_id) do update
            set last_job_id = excluded.last_job_id,
                last_status = excluded.last_status,
                last_message = excluded.last_message,
                updated_at = now()
          `,
          [
            job.project_id,
            member.user_id,
            job.template_user_id,
            job.template_agent_id,
            jobId,
            message,
          ],
        );
      }
    }

    await query(
      `
      update lobehub_admin.provision_jobs
      set status = $2,
          error_message = null,
          total_count = $3,
          success_count = $4,
          failed_count = $5,
          skipped_count = $6,
          finished_at = now(),
          updated_at = now()
      where id = $1
      `,
      [
        jobId,
        resolveFinalJobStatus(total, success, failed, skipped),
        total,
        success,
        failed,
        skipped,
      ],
    );

    log.info({ jobId, total, success, failed, skipped }, 'Provision job completed');
  } catch (error) {
    const message = (error as Error).message;

    await markProvisionJobFailed(jobId, message).catch((updateError) => {
      log.error({ jobId, error: updateError }, 'Failed to mark provision job as failed');
    });

    log.error({ jobId, error }, 'Provision job execution failed');
  } finally {
    scheduledProvisionJobs.delete(jobId);
  }
}

export function scheduleProvisionJob(jobId: string, log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  if (!jobId || scheduledProvisionJobs.has(jobId)) {
    return false;
  }

  scheduledProvisionJobs.add(jobId);
  setImmediate(() => {
    void runProvisionJob(jobId, log);
  });

  return true;
}

export async function resumePendingProvisionJobs(log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>) {
  const result = await query<{ id: string; status: string }>(
    `
    select id, status
    from lobehub_admin.provision_jobs
    where status in ('pending', 'running')
    order by created_at asc
    `,
  );

  for (const row of result.rows) {
    const scheduled = scheduleProvisionJob(row.id, log);

    if (scheduled) {
      log.info({ jobId: row.id, status: row.status }, 'Scheduled pending provision job');
    }
  }
}
