import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdminRequest } from '../auth.js';
import { query } from '../db.js';

const EXCLUDED_AGENT_SLUGS = ['inbox', 'page-agent', 'agent-builder', 'group-agent-builder'];

const optionalText = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().min(1).optional());

const optionalDate = z.preprocess((value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

const reportFiltersSchema = z.object({
  keyword: optionalText,
  userId: optionalText,
  role: z.enum(['all', 'admin', 'member']).default('all'),
  managedStatus: z.enum(['all', 'provisioned', 'failed', 'skipped', 'unconfigured']).default('all'),
  dateField: z.enum(['joinedAt', 'provisionedAt', 'managedSessionUpdatedAt']).default('joinedAt'),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}).superRefine((value, context) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dateFrom must be less than or equal to dateTo',
      path: ['dateFrom'],
    });
  }
});

const topicStatsFiltersSchema = z.object({
  rangePreset: z.enum(['today', 'last3days', 'last7days', 'last30days', 'custom']).default('today'),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine((value, context) => {
  if (value.rangePreset === 'custom') {
    if (!value.dateFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dateFrom is required when rangePreset is custom',
        path: ['dateFrom'],
      });
    }

    if (!value.dateTo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dateTo is required when rangePreset is custom',
        path: ['dateTo'],
      });
    }
  }

  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'dateFrom must be less than or equal to dateTo',
      path: ['dateFrom'],
    });
  }
});

type ReportFilters = z.infer<typeof reportFiltersSchema>;
type TopicStatsFilters = z.infer<typeof topicStatsFiltersSchema>;

type TopicStatsRange = {
  rangePreset: TopicStatsFilters['rangePreset'];
  dateFrom: string;
  dateTo: string;
  startAt: string;
  endAt: string;
};

type ProjectReportSummaryRow = {
  total_members: number;
  admin_count: number;
  member_count: number;
  managed_member_count: number;
  failed_managed_count: number;
  skipped_managed_count: number;
  unconfigured_count: number;
  assistant_count: number;
  managed_session_count: number;
  default_agent_count: number;
};

type ProjectReportMemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  joined_at: string;
  assistant_count: number;
  session_count: number;
  latest_assistant_updated_at: string | null;
  latest_session_updated_at: string | null;
  managed_agent_id: string | null;
  managed_assistant_title: string | null;
  managed_session_id: string | null;
  managed_session_title: string | null;
  managed_status: 'provisioned' | 'failed' | 'skipped' | 'unconfigured';
  managed_message: string | null;
  provisioned_at: string | null;
  managed_session_updated_at: string | null;
  last_job_id: string | null;
  last_job_status: string | null;
  last_job_finished_at: string | null;
  is_default_agent: boolean;
};

type ProjectReportJobRow = {
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

type ProjectTopicStatsSummaryRow = {
  total_members: number;
  admin_count: number;
  member_count: number;
  managed_session_count: number;
  active_member_count: number;
  inactive_member_count: number;
  total_topics: number;
  first_topic_at: string | null;
  last_topic_at: string | null;
};

type ProjectTopicStatsMemberRow = {
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

type ProjectTopicListMemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  joined_at: string;
  managed_session_id: string | null;
  managed_session_title: string | null;
};

type ProjectTopicListItemRow = {
  topic_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
  preview: string | null;
};

type ProjectTopicDetailRow = {
  topic_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  display_name: string;
  email: string | null;
  managed_session_id: string | null;
  managed_session_title: string | null;
};

type ProjectTopicMessageRow = {
  id: string;
  role: string;
  content: string | null;
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
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(nextDate.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function toShanghaiMidnightTimestamp(dateString: string) {
  return `${dateString}T00:00:00+08:00`;
}

function resolveTopicStatsRange(filters: TopicStatsFilters): TopicStatsRange {
  if (filters.rangePreset === 'custom') {
    const dateFrom = filters.dateFrom as string;
    const dateTo = filters.dateTo as string;

    return {
      rangePreset: filters.rangePreset,
      dateFrom,
      dateTo,
      startAt: toShanghaiMidnightTimestamp(dateFrom),
      endAt: toShanghaiMidnightTimestamp(addDays(dateTo, 1)),
    };
  }

  const today = getShanghaiTodayDateString();
  let dateFrom = today;

  switch (filters.rangePreset) {
    case 'last3days':
      dateFrom = addDays(today, -2);
      break;
    case 'last7days':
      dateFrom = addDays(today, -6);
      break;
    case 'last30days':
      dateFrom = addDays(today, -29);
      break;
    case 'today':
    default:
      dateFrom = today;
      break;
  }

  return {
    rangePreset: filters.rangePreset,
    dateFrom,
    dateTo: today,
    startAt: toShanghaiMidnightTimestamp(dateFrom),
    endAt: toShanghaiMidnightTimestamp(addDays(today, 1)),
  };
}

function getDateFieldSql(dateField: ReportFilters['dateField']) {
  switch (dateField) {
    case 'provisionedAt':
      return 'provisioned_at';
    case 'managedSessionUpdatedAt':
      return 'managed_session_updated_at';
    case 'joinedAt':
    default:
      return 'joined_at';
  }
}

function buildReportQueryParts(projectId: string, filters: ReportFilters) {
  const values: unknown[] = [projectId, EXCLUDED_AGENT_SLUGS];
  const conditions = ['1 = 1'];

  if (filters.keyword) {
    values.push(filters.keyword);
    const index = values.length;
    conditions.push(`
      (
        lower(coalesce(display_name, '')) like '%' || lower($${index}) || '%'
        or lower(coalesce(email, '')) like '%' || lower($${index}) || '%'
        or lower(user_id) like '%' || lower($${index}) || '%'
      )
    `);
  }

  if (filters.userId) {
    values.push(filters.userId);
    conditions.push(`user_id = $${values.length}`);
  }

  if (filters.role !== 'all') {
    values.push(filters.role);
    conditions.push(`role = $${values.length}`);
  }

  if (filters.managedStatus !== 'all') {
    if (filters.managedStatus === 'unconfigured') {
      conditions.push(`role = 'member' and managed_status is null`);
    } else {
      values.push(filters.managedStatus);
      conditions.push(`role = 'member' and managed_status = $${values.length}`);
    }
  }

  const dateFieldSql = getDateFieldSql(filters.dateField);

  if (filters.dateFrom) {
    values.push(filters.dateFrom);
    conditions.push(`${dateFieldSql} >= $${values.length}::date`);
  }

  if (filters.dateTo) {
    values.push(filters.dateTo);
    conditions.push(`${dateFieldSql} < ($${values.length}::date + interval '1 day')`);
  }

  const cteSql = `
    with member_base as (
      select
        pm.project_id,
        pm.user_id,
        pm.role,
        pm.joined_at,
        u.email,
        lobehub_admin.user_display_name(pm.user_id) as display_name,
        coalesce(assistant_stats.assistant_count, 0)::int as assistant_count,
        coalesce(session_stats.session_count, 0)::int as session_count,
        assistant_stats.latest_assistant_updated_at,
        session_stats.latest_session_updated_at,
        pma.managed_agent_id,
        managed_agent.title as managed_assistant_title,
        pma.managed_session_id,
        managed_session.title as managed_session_title,
        pma.last_status as managed_status,
        pma.last_message as managed_message,
        pma.last_job_id,
        pma.provisioned_at,
        managed_session.updated_at as managed_session_updated_at,
        last_job.status as last_job_status,
        last_job.finished_at as last_job_finished_at,
        coalesce((user_settings.default_agent ->> 'id') = pma.managed_agent_id, false) as is_default_agent
      from lobehub_admin.project_members pm
      join public.users u on u.id = pm.user_id
      left join lateral (
        select
          count(*)::int as assistant_count,
          max(a.updated_at) as latest_assistant_updated_at
        from public.agents a
        where a.user_id = pm.user_id
          and coalesce(a.slug, '') <> all($2::text[])
      ) assistant_stats on true
      left join lateral (
        select
          count(*)::int as session_count,
          max(s.updated_at) as latest_session_updated_at
        from public.sessions s
        where s.user_id = pm.user_id
          and s.type = 'agent'
      ) session_stats on true
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pm.project_id
       and pma.user_id = pm.user_id
      left join public.agents managed_agent
        on managed_agent.id = pma.managed_agent_id
      left join public.sessions managed_session
        on managed_session.id = pma.managed_session_id
      left join lobehub_admin.provision_jobs last_job
        on last_job.id = pma.last_job_id
      left join public.user_settings user_settings
        on user_settings.id = pm.user_id
      where pm.project_id = $1
    ),
    filtered_members as (
      select *
      from member_base
      where ${conditions.join(' and ')}
    )
  `;

  return {
    cteSql,
    values,
  };
}

function buildTopicStatsQueryParts(projectId: string, range: TopicStatsRange) {
  const values: unknown[] = [projectId, range.startAt, range.endAt];
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
      where pm.project_id = $1
    )
  `;

  return {
    cteSql,
    values,
  };
}

function toCsvValue(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function registerReportRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/reports/member-activity', async (request) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const filters = reportFiltersSchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const { cteSql, values } = buildReportQueryParts(params.projectId, filters);
    const offset = (filters.page - 1) * filters.pageSize;

    const [summaryResult, rowsResult, recentJobsResult] = await Promise.all([
      query<ProjectReportSummaryRow>(
        `
        ${cteSql}
        select
          count(*)::int as total_members,
          count(*) filter (where role = 'admin')::int as admin_count,
          count(*) filter (where role = 'member')::int as member_count,
          count(*) filter (where role = 'member' and managed_status = 'provisioned')::int as managed_member_count,
          count(*) filter (where role = 'member' and managed_status = 'failed')::int as failed_managed_count,
          count(*) filter (where role = 'member' and managed_status = 'skipped')::int as skipped_managed_count,
          count(*) filter (where role = 'member' and managed_status is null)::int as unconfigured_count,
          coalesce(sum(assistant_count), 0)::int as assistant_count,
          count(*) filter (where role = 'member' and managed_session_id is not null)::int as managed_session_count,
          count(*) filter (where role = 'member' and is_default_agent)::int as default_agent_count
        from filtered_members
        `,
        values,
      ),
      query<ProjectReportMemberRow>(
        `
        ${cteSql}
        select
          user_id,
          display_name,
          email,
          role,
          joined_at,
          assistant_count,
          session_count,
          latest_assistant_updated_at,
          latest_session_updated_at,
          managed_agent_id,
          managed_assistant_title,
          managed_session_id,
          managed_session_title,
          coalesce(managed_status, 'unconfigured') as managed_status,
          managed_message,
          provisioned_at,
          managed_session_updated_at,
          last_job_id,
          last_job_status,
          last_job_finished_at,
          is_default_agent
        from filtered_members
        order by
          case role when 'member' then 0 else 1 end,
          coalesce(managed_session_updated_at, provisioned_at, latest_session_updated_at, joined_at) desc nulls last,
          display_name asc
        limit $${values.length + 1}
        offset $${values.length + 2}
        `,
        [...values, filters.pageSize, offset],
      ),
      query<ProjectReportJobRow>(
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
        limit 6
        `,
        [params.projectId],
      ),
    ]);

    const summary = summaryResult.rows[0] ?? {
      total_members: 0,
      admin_count: 0,
      member_count: 0,
      managed_member_count: 0,
      failed_managed_count: 0,
      skipped_managed_count: 0,
      unconfigured_count: 0,
      assistant_count: 0,
      managed_session_count: 0,
      default_agent_count: 0,
    };

    const total = summary.total_members;

    return {
      summary: {
        totalMembers: summary.total_members,
        adminCount: summary.admin_count,
        memberCount: summary.member_count,
        managedMemberCount: summary.managed_member_count,
        failedManagedCount: summary.failed_managed_count,
        skippedManagedCount: summary.skipped_managed_count,
        unconfiguredCount: summary.unconfigured_count,
        assistantCount: summary.assistant_count,
        managedSessionCount: summary.managed_session_count,
        defaultAgentCount: summary.default_agent_count,
      },
      rows: rowsResult.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        joinedAt: row.joined_at,
        assistantCount: row.assistant_count,
        sessionCount: row.session_count,
        latestAssistantUpdatedAt: row.latest_assistant_updated_at,
        latestSessionUpdatedAt: row.latest_session_updated_at,
        managedAssistantId: row.managed_agent_id,
        managedAssistantTitle: row.managed_assistant_title,
        managedSessionId: row.managed_session_id,
        managedSessionTitle: row.managed_session_title,
        managedStatus: row.managed_status,
        managedMessage: row.managed_message,
        provisionedAt: row.provisioned_at,
        managedSessionUpdatedAt: row.managed_session_updated_at,
        lastJobId: row.last_job_id,
        lastJobStatus: row.last_job_status,
        lastJobFinishedAt: row.last_job_finished_at,
        isDefaultAgent: row.is_default_agent,
      })),
      recentJobs: recentJobsResult.rows.map((row) => ({
        id: row.id,
        jobType: row.job_type,
        status: row.status,
        totalCount: row.total_count,
        successCount: row.success_count,
        failedCount: row.failed_count,
        skippedCount: row.skipped_count,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        createdByName: row.created_by_name,
      })),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
      },
    };
  });

  app.get('/api/projects/:projectId/reports/topic-stats', async (request) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const filters = topicStatsFiltersSchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const range = resolveTopicStatsRange(filters);
    const { cteSql, values } = buildTopicStatsQueryParts(params.projectId, range);
    const offset = (filters.page - 1) * filters.pageSize;

    const [summaryResult, rowsResult] = await Promise.all([
      query<ProjectTopicStatsSummaryRow>(
        `
        ${cteSql}
        select
          count(*)::int as total_members,
          count(*) filter (where role = 'admin')::int as admin_count,
          count(*) filter (where role = 'member')::int as member_count,
          count(*) filter (where managed_session_id is not null)::int as managed_session_count,
          count(*) filter (where topic_count > 0)::int as active_member_count,
          count(*) filter (where topic_count = 0)::int as inactive_member_count,
          coalesce(sum(topic_count), 0)::int as total_topics,
          min(first_topic_at) as first_topic_at,
          max(last_topic_at) as last_topic_at
        from member_topic_base
        `,
        values,
      ),
      query<ProjectTopicStatsMemberRow>(
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
        limit $${values.length + 1}
        offset $${values.length + 2}
        `,
        [...values, filters.pageSize, offset],
      ),
    ]);

    const summary = summaryResult.rows[0] ?? {
      total_members: 0,
      admin_count: 0,
      member_count: 0,
      managed_session_count: 0,
      active_member_count: 0,
      inactive_member_count: 0,
      total_topics: 0,
      first_topic_at: null,
      last_topic_at: null,
    };

    return {
      range: {
        rangePreset: range.rangePreset,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      },
      summary: {
        totalMembers: summary.total_members,
        adminCount: summary.admin_count,
        memberCount: summary.member_count,
        managedSessionCount: summary.managed_session_count,
        activeMemberCount: summary.active_member_count,
        inactiveMemberCount: summary.inactive_member_count,
        totalTopics: summary.total_topics,
        firstTopicAt: summary.first_topic_at,
        lastTopicAt: summary.last_topic_at,
      },
      rows: rowsResult.rows.map((row) => ({
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
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        total: summary.total_members,
        totalPages: Math.max(1, Math.ceil(summary.total_members / filters.pageSize)),
      },
    };
  });

  app.get('/api/projects/:projectId/reports/topic-stats/users/:userId/topics', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      userId: z.string().min(1),
    }).parse(request.params);
    const filters = topicStatsFiltersSchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const range = resolveTopicStatsRange(filters);
    const memberResult = await query<ProjectTopicListMemberRow>(
      `
      select
        pm.user_id,
        lobehub_admin.user_display_name(pm.user_id) as display_name,
        u.email,
        pm.role,
        pm.joined_at,
        pma.managed_session_id,
        managed_session.title as managed_session_title
      from lobehub_admin.project_members pm
      join public.users u on u.id = pm.user_id
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pm.project_id
       and pma.user_id = pm.user_id
      left join public.sessions managed_session
        on managed_session.id = pma.managed_session_id
      where pm.project_id = $1
        and pm.user_id = $2
      limit 1
      `,
      [params.projectId, params.userId],
    );

    const member = memberResult.rows[0];

    if (!member) {
      const error = new Error(`Member not found in project: ${params.userId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    const topicsResult = member.managed_session_id
      ? await query<ProjectTopicListItemRow>(
        `
        select
          t.id as topic_id,
          coalesce(nullif(btrim(t.title), ''), 'Untitled topic') as title,
          t.created_at,
          t.updated_at,
          coalesce(message_stats.message_count, 0)::int as message_count,
          message_stats.last_message_at,
          nullif(
            left(
              coalesce(
                nullif(btrim(last_message.content), ''),
                nullif(btrim(t.content), ''),
                nullif(btrim(t.history_summary), '')
              ),
              200
            ),
            ''
          ) as preview
        from public.topics t
        left join lateral (
          select
            count(*)::int as message_count,
            max(m.created_at) as last_message_at
          from public.messages m
          where m.topic_id = t.id
        ) message_stats on true
        left join lateral (
          select m.content
          from public.messages m
          where m.topic_id = t.id
          order by m.created_at desc nulls last, m.id desc
          limit 1
        ) last_message on true
        where t.user_id = $1
          and t.session_id = $2
          and t.created_at >= $3::timestamptz
          and t.created_at < $4::timestamptz
        order by t.created_at desc, t.id desc
        `,
        [member.user_id, member.managed_session_id, range.startAt, range.endAt],
      )
      : { rows: [] as ProjectTopicListItemRow[] };

    return {
      range: {
        rangePreset: range.rangePreset,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      },
      member: {
        userId: member.user_id,
        displayName: member.display_name,
        email: member.email,
        role: member.role,
        joinedAt: member.joined_at,
        managedSessionId: member.managed_session_id,
        managedSessionTitle: member.managed_session_title,
      },
      topics: topicsResult.rows.map((row) => ({
        topicId: row.topic_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count,
        lastMessageAt: row.last_message_at,
        preview: row.preview,
      })),
    };
  });

  app.get('/api/projects/:projectId/reports/topic-stats/topics/:topicId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      topicId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const topicResult = await query<ProjectTopicDetailRow>(
      `
      select
        t.id as topic_id,
        coalesce(nullif(btrim(t.title), ''), 'Untitled topic') as title,
        t.created_at,
        t.updated_at,
        t.user_id,
        lobehub_admin.user_display_name(t.user_id) as display_name,
        u.email,
        pma.managed_session_id,
        managed_session.title as managed_session_title
      from public.topics t
      join public.users u on u.id = t.user_id
      join lobehub_admin.project_members pm
        on pm.project_id = $1
       and pm.user_id = t.user_id
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pm.project_id
       and pma.user_id = pm.user_id
      left join public.sessions managed_session
        on managed_session.id = pma.managed_session_id
      where t.id = $2
        and t.session_id = pma.managed_session_id
      limit 1
      `,
      [params.projectId, params.topicId],
    );

    const topic = topicResult.rows[0];

    if (!topic) {
      const error = new Error(`Topic not found in project: ${params.topicId}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    const messagesResult = await query<ProjectTopicMessageRow>(
      `
      select
        m.id,
        m.role,
        coalesce(
          nullif(m.content, ''),
          nullif(m.summary, ''),
          case when m.editor_data is not null then m.editor_data::text else null end,
          '[empty]'
        ) as content,
        m.created_at,
        m.updated_at
      from public.messages m
      where m.topic_id = $1
        and m.user_id = $2
        and m.session_id = $3
      order by m.created_at asc, m.id asc
      `,
      [topic.topic_id, topic.user_id, topic.managed_session_id],
    );

    return {
      topic: {
        topicId: topic.topic_id,
        title: topic.title,
        createdAt: topic.created_at,
        updatedAt: topic.updated_at,
        userId: topic.user_id,
        displayName: topic.display_name,
        email: topic.email,
        managedSessionId: topic.managed_session_id,
        managedSessionTitle: topic.managed_session_title,
      },
      messages: messagesResult.rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  });

  app.get('/api/projects/:projectId/reports/member-activity/export', async (request, reply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const filters = reportFiltersSchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const { cteSql, values } = buildReportQueryParts(params.projectId, filters);
    const rowsResult = await query<ProjectReportMemberRow>(
      `
      ${cteSql}
      select
        user_id,
        display_name,
        email,
        role,
        joined_at,
        assistant_count,
        session_count,
        latest_assistant_updated_at,
        latest_session_updated_at,
        managed_agent_id,
        managed_assistant_title,
        managed_session_id,
        managed_session_title,
        coalesce(managed_status, 'unconfigured') as managed_status,
        managed_message,
        provisioned_at,
        managed_session_updated_at,
        last_job_id,
        last_job_status,
        last_job_finished_at,
        is_default_agent
      from filtered_members
      order by
        case role when 'member' then 0 else 1 end,
        coalesce(managed_session_updated_at, provisioned_at, latest_session_updated_at, joined_at) desc nulls last,
        display_name asc
      `,
      values,
    );

    const lines = [
      [
        '用户ID',
        '用户名称',
        '邮箱',
        '角色',
        '加入时间',
        '项目助手状态',
        '托管助手',
        '托管会话',
        '是否默认助手',
        '用户助手数',
        '用户会话数',
        '托管配置时间',
        '托管会话更新时间',
        '最近用户助手更新时间',
        '最近用户会话更新时间',
        '最近任务状态',
        '最近任务完成时间',
        '最近任务消息',
      ].join(','),
    ];

    for (const row of rowsResult.rows) {
      lines.push([
        row.user_id,
        row.display_name,
        row.email,
        row.role,
        row.joined_at,
        row.managed_status,
        row.managed_assistant_title,
        row.managed_session_title,
        row.is_default_agent ? 'yes' : 'no',
        row.assistant_count,
        row.session_count,
        row.provisioned_at,
        row.managed_session_updated_at,
        row.latest_assistant_updated_at,
        row.latest_session_updated_at,
        row.last_job_status,
        row.last_job_finished_at,
        row.managed_message,
      ].map(toCsvValue).join(','));
    }

    const filename = `project-${params.projectId}-member-activity.csv`;

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(`\uFEFF${lines.join('\r\n')}`);
  });
}
