import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectMemberRequest } from '../auth.js';
import { query } from '../db.js';
import { getProjectOverview } from '../project-facts.js';

type MemberSummaryRow = {
  total_members: number;
  admin_count: number;
  member_count: number;
  pending_member_count: number;
  failed_member_count: number;
};

type AttentionMemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  managed_status: 'provisioned' | 'failed' | 'skipped' | 'unconfigured';
  updated_at: string | null;
};

type TemplateRow = {
  project_id: string;
  template_user_id: string | null;
  template_agent_id: string | null;
  copy_skills: boolean;
  updated_at: string;
  updated_by: string | null;
  template_user_email: string | null;
  template_user_display_name: string | null;
  template_agent_title: string | null;
  template_skill_count: string;
};

type ProvisionJobRow = {
  id: string;
  job_type: 'configure' | 'refresh';
  status: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_by_name: string | null;
};

type TopicSummaryRow = {
  managed_session_count: number;
  active_member_count: number;
  total_topics: number;
  last_topic_at: string | null;
};

type TopicMemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  joined_at: string;
  managed_session_id: string | null;
  managed_session_title: string | null;
  topic_count: number;
  first_topic_at: string | null;
  last_topic_at: string | null;
};

type LatestDailyReportRow = {
  id: string;
  business_date: string;
  revision: number;
  is_current: boolean;
  visited_customer_count: number;
  active_topic_count: number;
  total_message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  model_provider: string;
  model_name: string;
  created_at: string;
};

type RunningDailyJobRow = {
  id: string;
  business_date: string;
  trigger_source: 'scheduled' | 'manual' | 'retry';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  timezone: string;
  close_time_local: string;
  window_start_at: string;
  window_end_at: string;
  model_provider: string;
  model_name: string;
  report_id: string | null;
  created_by: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

function getShanghaiDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('Failed to resolve current Shanghai date');
  }

  return { year, month, day };
}

function getShanghaiTodayDateString(now = new Date()) {
  const { year, month, day } = getShanghaiDateParts(now);
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + days));
  return [
    nextDate.getUTCFullYear(),
    String(nextDate.getUTCMonth() + 1).padStart(2, '0'),
    String(nextDate.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function toShanghaiMidnightTimestamp(dateString: string) {
  return `${dateString}T00:00:00+08:00`;
}

function buildTopicSummaryQueryParts(projectId: string, startAt: string, endAt: string, scopedUserId?: string) {
  const values: unknown[] = [projectId, startAt, endAt];
  const memberConditions = ['pm.project_id = $1'];

  if (scopedUserId) {
    values.push(scopedUserId);
    memberConditions.push(`pm.user_id = $${values.length}`);
  }

  const cteSql = `
    with member_topic_base as (
      select
        pm.user_id,
        pm.role,
        pm.joined_at,
        u.email,
        lobehub_admin.user_display_name(pm.user_id) as display_name,
        pma.managed_session_id,
        managed_session.title as managed_session_title,
        coalesce(topic_stats.topic_count, 0)::int as topic_count,
        topic_stats.first_topic_at,
        topic_stats.last_topic_at
      from lobehub_admin.project_members pm
      join public.users u on u.id = pm.user_id
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pm.project_id
       and pma.user_id = pm.user_id
      left join public.sessions managed_session
        on managed_session.id = pma.managed_session_id
      left join lateral (
        select
          count(*)::int as topic_count,
          min(t.created_at) as first_topic_at,
          max(t.created_at) as last_topic_at
        from public.topics t
        where t.user_id = pm.user_id
          and pma.managed_session_id is not null
          and t.session_id = pma.managed_session_id
          and t.created_at >= $2::timestamptz
          and t.created_at < $3::timestamptz
      ) topic_stats on true
      where ${memberConditions.join(' and ')}
    )
  `;

  return {
    cteSql,
    values,
  };
}

export async function registerMobileRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/mobile-summary', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
    }).parse(request.params);
    const actor = await ensureProjectMemberRequest(request, params.projectId);
    const isManager = actor.projectRole !== 'member';
    const today = getShanghaiTodayDateString();
    const tomorrow = addDays(today, 1);
    const startAt = toShanghaiMidnightTimestamp(today);
    const endAt = toShanghaiMidnightTimestamp(tomorrow);
    const { cteSql, values } = buildTopicSummaryQueryParts(
      params.projectId,
      startAt,
      endAt,
      actor.projectRole === 'member' ? actor.id : undefined,
    );

    const [topicSummaryResult, topicRowsResult] = await Promise.all([
      query<TopicSummaryRow>(
        `
        ${cteSql}
        select
          count(*) filter (where managed_session_id is not null)::int as managed_session_count,
          count(*) filter (where topic_count > 0)::int as active_member_count,
          coalesce(sum(topic_count), 0)::int as total_topics,
          max(last_topic_at) as last_topic_at
        from member_topic_base
        `,
        values,
      ),
      query<TopicMemberRow>(
        `
        ${cteSql}
        select
          user_id,
          display_name,
          email,
          role,
          joined_at,
          managed_session_id,
          managed_session_title,
          topic_count,
          first_topic_at,
          last_topic_at
        from member_topic_base
        order by
          topic_count desc,
          last_topic_at desc nulls last,
          case role when 'member' then 0 else 1 end,
          display_name asc
        limit 3
        `,
        values,
      ),
    ]);

    const topicSummary = topicSummaryResult.rows[0] ?? {
      managed_session_count: 0,
      active_member_count: 0,
      total_topics: 0,
      last_topic_at: null,
    };

    if (!isManager) {
      return {
        members: null,
        provision: null,
        topics: {
          range: {
            rangePreset: 'today' as const,
            dateFrom: today,
            dateTo: today,
          },
          summary: {
            managedSessionCount: topicSummary.managed_session_count,
            activeMemberCount: topicSummary.active_member_count,
            totalTopics: topicSummary.total_topics,
            lastTopicAt: topicSummary.last_topic_at,
          },
          rows: topicRowsResult.rows.map((row) => ({
            userId: row.user_id,
            displayName: row.display_name,
            email: row.email,
            role: row.role,
            joinedAt: row.joined_at,
            managedSessionId: row.managed_session_id,
            managedSessionTitle: row.managed_session_title,
            topicCount: row.topic_count,
            firstTopicAt: row.first_topic_at,
            lastTopicAt: row.last_topic_at,
          })),
        },
        daily: null,
      };
    }

    const [
      memberSummaryResult,
      attentionMembersResult,
      templateResult,
      provisionJobResult,
      latestDailyReportResult,
      runningDailyJobResult,
      overview,
    ] = await Promise.all([
      query<MemberSummaryRow>(
        `
        select
          count(*)::int as total_members,
          count(*) filter (where pm.role = 'admin')::int as admin_count,
          count(*) filter (where pm.role = 'member')::int as member_count,
          count(*) filter (
            where pm.role = 'member'
              and coalesce(pma.last_status, 'unconfigured') <> 'provisioned'
          )::int as pending_member_count,
          count(*) filter (
            where pm.role = 'member'
              and pma.last_status = 'failed'
          )::int as failed_member_count
        from lobehub_admin.project_members pm
        left join lobehub_admin.project_managed_agents pma
          on pma.project_id = pm.project_id
         and pma.user_id = pm.user_id
        where pm.project_id = $1
        `,
        [params.projectId],
      ),
      query<AttentionMemberRow>(
        `
        select
          pm.user_id,
          lobehub_admin.user_display_name(pm.user_id) as display_name,
          u.email,
          pm.role,
          coalesce(pma.last_status, 'unconfigured')::text as managed_status,
          coalesce(pma.provisioned_at, pm.joined_at) as updated_at
        from lobehub_admin.project_members pm
        join public.users u on u.id = pm.user_id
        left join lobehub_admin.project_managed_agents pma
          on pma.project_id = pm.project_id
         and pma.user_id = pm.user_id
        where pm.project_id = $1
          and pm.role = 'member'
          and coalesce(pma.last_status, 'unconfigured') <> 'provisioned'
        order by
          case when coalesce(pma.last_status, 'unconfigured') = 'failed' then 0 else 1 end,
          coalesce(pma.provisioned_at, pm.joined_at) desc nulls last,
          display_name asc
        limit 3
        `,
        [params.projectId],
      ),
      query<TemplateRow>(
        `
        select
          pt.project_id,
          pt.template_user_id,
          pt.template_agent_id,
          pt.copy_skills,
          pt.updated_at,
          pt.updated_by,
          u.email as template_user_email,
          lobehub_admin.user_display_name(pt.template_user_id) as template_user_display_name,
          a.title as template_agent_title,
          coalesce((
            select count(*)::text
            from public.agent_skills s
            where s.user_id = pt.template_user_id
          ), '0') as template_skill_count
        from lobehub_admin.project_templates pt
        left join public.users u on u.id = pt.template_user_id
        left join public.agents a on a.id = pt.template_agent_id
        where pt.project_id = $1
        limit 1
        `,
        [params.projectId],
      ),
      query<ProvisionJobRow>(
        `
        select
          j.id,
          j.job_type,
          j.status,
          j.total_count,
          j.success_count,
          j.failed_count,
          j.skipped_count,
          j.started_at,
          j.finished_at,
          lobehub_admin.user_display_name(j.created_by) as created_by_name
        from lobehub_admin.provision_jobs j
        where j.project_id = $1
        order by coalesce(j.finished_at, j.started_at, j.created_at) desc
        limit 1
        `,
        [params.projectId],
      ),
      query<LatestDailyReportRow>(
        `
        select
          id,
          business_date::text as business_date,
          revision,
          is_current,
          visited_customer_count,
          active_topic_count,
          total_message_count,
          user_message_count,
          assistant_message_count,
          model_provider,
          model_name,
          created_at
        from lobehub_admin.project_daily_reports
        where project_id = $1
          and is_current
        order by business_date desc, created_at desc
        limit 1
        `,
        [params.projectId],
      ),
      query<RunningDailyJobRow>(
        `
        select
          id,
          business_date::text as business_date,
          trigger_source,
          status,
          timezone,
          close_time_local::text as close_time_local,
          window_start_at,
          window_end_at,
          model_provider,
          model_name,
          report_id,
          created_by,
          error_message,
          started_at,
          finished_at,
          created_at,
          updated_at
        from lobehub_admin.daily_report_jobs
        where project_id = $1
          and status in ('pending', 'running')
        order by created_at desc
        limit 1
        `,
        [params.projectId],
      ),
      getProjectOverview(params.projectId),
    ]);

    const memberSummary = memberSummaryResult.rows[0] ?? {
      total_members: 0,
      admin_count: 0,
      member_count: 0,
      pending_member_count: 0,
      failed_member_count: 0,
    };

    const template = templateResult.rows[0] ?? null;
    const latestProvisionJob = provisionJobResult.rows[0] ?? null;
    const latestDailyReport = latestDailyReportResult.rows[0] ?? null;
    const runningDailyJob = runningDailyJobResult.rows[0] ?? null;

    return {
      members: {
        totalMembers: memberSummary.total_members,
        adminCount: memberSummary.admin_count,
        memberCount: memberSummary.member_count,
        pendingMemberCount: memberSummary.pending_member_count,
        failedMemberCount: memberSummary.failed_member_count,
        attentionMembers: attentionMembersResult.rows.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          email: row.email,
          role: row.role,
          managedStatus: row.managed_status,
          updatedAt: row.updated_at,
        })),
      },
      provision: {
        template: template
          ? {
            project_id: template.project_id,
            template_user_id: template.template_user_id,
            template_agent_id: template.template_agent_id,
            copy_skills: template.copy_skills,
            updated_at: template.updated_at,
            updated_by: template.updated_by,
            template_user_email: template.template_user_email,
            template_user_display_name: template.template_user_display_name,
            template_agent_title: template.template_agent_title,
            template_skill_count: template.template_skill_count,
          }
          : null,
        latestJob: latestProvisionJob
          ? {
            id: latestProvisionJob.id,
            jobType: latestProvisionJob.job_type,
            status: latestProvisionJob.status,
            totalCount: latestProvisionJob.total_count,
            successCount: latestProvisionJob.success_count,
            failedCount: latestProvisionJob.failed_count,
            skippedCount: latestProvisionJob.skipped_count,
            startedAt: latestProvisionJob.started_at,
            finishedAt: latestProvisionJob.finished_at,
            createdByName: latestProvisionJob.created_by_name,
          }
          : null,
      },
      topics: {
        range: {
          rangePreset: 'today' as const,
          dateFrom: today,
          dateTo: today,
        },
        summary: {
          managedSessionCount: topicSummary.managed_session_count,
          activeMemberCount: overview?.stats.activeMemberCount ?? topicSummary.active_member_count,
          totalTopics: overview?.stats.activeTopicCount ?? topicSummary.total_topics,
          lastTopicAt: overview?.stats.lastActiveAt ?? topicSummary.last_topic_at,
        },
        rows: topicRowsResult.rows.map((row) => ({
          userId: row.user_id,
          displayName: row.display_name,
          email: row.email,
          role: row.role,
          joinedAt: row.joined_at,
          managedSessionId: row.managed_session_id,
          managedSessionTitle: row.managed_session_title,
          topicCount: row.topic_count,
          firstTopicAt: row.first_topic_at,
          lastTopicAt: row.last_topic_at,
        })),
      },
      daily: {
        latestReport: latestDailyReport
          ? {
            reportId: latestDailyReport.id,
            businessDate: latestDailyReport.business_date,
            revision: latestDailyReport.revision,
            isCurrent: latestDailyReport.is_current,
            visitedCustomerCount: latestDailyReport.visited_customer_count,
            activeTopicCount: latestDailyReport.active_topic_count,
            totalMessageCount: latestDailyReport.total_message_count,
            userMessageCount: latestDailyReport.user_message_count,
            assistantMessageCount: latestDailyReport.assistant_message_count,
            modelProvider: latestDailyReport.model_provider,
            modelName: latestDailyReport.model_name,
            generatedAt: latestDailyReport.created_at,
          }
          : null,
        runningJob: runningDailyJob
          ? {
            id: runningDailyJob.id,
            projectId: params.projectId,
            businessDate: runningDailyJob.business_date,
            triggerSource: runningDailyJob.trigger_source,
            status: runningDailyJob.status,
            timezone: runningDailyJob.timezone,
            closeTimeLocal: runningDailyJob.close_time_local,
            windowStartAt: runningDailyJob.window_start_at,
            windowEndAt: runningDailyJob.window_end_at,
            promptSnapshot: '',
            modelProvider: runningDailyJob.model_provider,
            modelName: runningDailyJob.model_name,
            reportId: runningDailyJob.report_id,
            createdBy: runningDailyJob.created_by,
            errorMessage: runningDailyJob.error_message,
            startedAt: runningDailyJob.started_at,
            finishedAt: runningDailyJob.finished_at,
            createdAt: runningDailyJob.created_at,
            updatedAt: runningDailyJob.updated_at,
          }
          : null,
      },
    };
  });
}
