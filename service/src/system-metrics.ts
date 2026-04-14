import { addDays, getLocalDateString } from './daily-report-time.js';
import { query } from './db.js';
import { ensureCurrentProjectTopicDailyFacts } from './project-facts.js';

const PLATFORM_TIMEZONE = 'Asia/Shanghai';
const MAX_RANGE_DAYS = 366;

export type SystemMetricsFilters = {
  asOfDate?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type SystemMetrics = {
  filters: {
    asOfDate: string;
    dateFrom: string;
    dateTo: string;
    timezone: string;
  };
  snapshot: {
    projectCount: number;
    adminBindingCount: number;
    memberBindingCount: number;
    totalMemberBindingCount: number;
    managedMemberCount: number;
    managedAssistantCount: number;
    managedSessionCount: number;
    cumulativeTopicCount: number;
    cumulativeVisibleMessageCount: number;
    cumulativeUserMessageCount: number;
    cumulativeAssistantMessageCount: number;
    dailyReportCount: number;
    dailyReportRevisionCount: number;
    customerAnalysisSessionCount: number;
    customerAnalysisJobCount: number;
    customerAnalysisCompletedJobCount: number;
    customerAnalysisFailedJobCount: number;
  };
  range: {
    newProjectCount: number;
    newMemberBindingCount: number;
    newAdminBindingCount: number;
    newManagedMemberCount: number;
    newTopicCount: number;
    activeTopicCount: number;
    activeTopicDayCount: number;
    visitCustomerCount: number;
    visitCustomerDayCount: number;
    firstVisitCount: number;
    revisitCount: number;
    activeMemberCount: number;
    visibleMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    aIntentCount: number;
    bIntentCount: number;
    cIntentCount: number;
    dIntentCount: number;
    highIntentCount: number;
    missingIntentCount: number;
    dailyReportCount: number;
    dailyReportCompletedJobCount: number;
    dailyReportFailedJobCount: number;
    customerAnalysisSessionCount: number;
    customerAnalysisJobCount: number;
    customerAnalysisCompletedJobCount: number;
    customerAnalysisFailedJobCount: number;
  };
  trend: Array<{
    businessDate: string;
    newProjectCount: number;
    newMemberBindingCount: number;
    newTopicCount: number;
    activeTopicCount: number;
    visitCustomerCount: number;
    firstVisitCount: number;
    revisitCount: number;
    activeMemberCount: number;
    visibleMessageCount: number;
    dailyReportCount: number;
    customerAnalysisJobCount: number;
  }>;
  projects: Array<{
    projectId: string;
    projectName: string;
    description: string | null;
    createdAt: string;
    adminCount: number;
    memberCount: number;
    managedMemberCount: number;
    newTopicCount: number;
    activeTopicCount: number;
    visitCustomerCount: number;
    firstVisitCount: number;
    revisitCount: number;
    activeMemberCount: number;
    visibleMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    dailyReportCount: number;
    dailyReportCompletedJobCount: number;
    dailyReportFailedJobCount: number;
    customerAnalysisSessionCount: number;
    customerAnalysisJobCount: number;
    customerAnalysisCompletedJobCount: number;
    customerAnalysisFailedJobCount: number;
    runningTaskCount: number;
    failedTaskCount: number;
  }>;
};

type SnapshotRow = {
  project_count: number;
  admin_binding_count: number;
  member_binding_count: number;
  total_member_binding_count: number;
  managed_member_count: number;
  managed_assistant_count: number;
  managed_session_count: number;
  cumulative_topic_count: number;
  cumulative_visible_message_count: number;
  cumulative_user_message_count: number;
  cumulative_assistant_message_count: number;
  daily_report_count: number;
  daily_report_revision_count: number;
  customer_analysis_session_count: number;
  customer_analysis_job_count: number;
  customer_analysis_completed_job_count: number;
  customer_analysis_failed_job_count: number;
};

type RangeRow = {
  new_project_count: number;
  new_member_binding_count: number;
  new_admin_binding_count: number;
  new_managed_member_count: number;
  new_topic_count: number;
  active_topic_count: number;
  active_topic_day_count: number;
  visit_customer_count: number;
  visit_customer_day_count: number;
  first_visit_count: number;
  revisit_count: number;
  active_member_count: number;
  visible_message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  a_intent_count: number;
  b_intent_count: number;
  c_intent_count: number;
  d_intent_count: number;
  missing_intent_count: number;
  daily_report_count: number;
  daily_report_completed_job_count: number;
  daily_report_failed_job_count: number;
  customer_analysis_session_count: number;
  customer_analysis_job_count: number;
  customer_analysis_completed_job_count: number;
  customer_analysis_failed_job_count: number;
};

type TrendRow = {
  business_date: string;
  new_project_count: number;
  new_member_binding_count: number;
  new_topic_count: number;
  active_topic_count: number;
  visit_customer_count: number;
  first_visit_count: number;
  revisit_count: number;
  active_member_count: number;
  visible_message_count: number;
  daily_report_count: number;
  customer_analysis_job_count: number;
};

type ProjectMetricRow = {
  project_id: string;
  project_name: string;
  description: string | null;
  created_at: string;
  admin_count: number;
  member_count: number;
  managed_member_count: number;
  new_topic_count: number;
  active_topic_count: number;
  visit_customer_count: number;
  first_visit_count: number;
  revisit_count: number;
  active_member_count: number;
  visible_message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  daily_report_count: number;
  daily_report_completed_job_count: number;
  daily_report_failed_job_count: number;
  customer_analysis_session_count: number;
  customer_analysis_job_count: number;
  customer_analysis_completed_job_count: number;
  customer_analysis_failed_job_count: number;
  running_task_count: number;
  failed_task_count: number;
};

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function getDefaultFilters(now = new Date()) {
  const asOfDate = getLocalDateString(now, PLATFORM_TIMEZONE);

  return {
    asOfDate,
    dateFrom: addDays(asOfDate, -6),
    dateTo: asOfDate,
  };
}

function getDateDiffDays(dateFrom: string, dateTo: string) {
  const [fromYear, fromMonth, fromDay] = dateFrom.split('-').map(Number);
  const [toYear, toMonth, toDay] = dateTo.split('-').map(Number);
  const fromTime = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toTime = Date.UTC(toYear, toMonth - 1, toDay);

  return Math.floor((toTime - fromTime) / 86_400_000);
}

function resolveFilters(filters: SystemMetricsFilters, now = new Date()) {
  const defaults = getDefaultFilters(now);
  const asOfDate = filters.asOfDate ?? defaults.asOfDate;
  const dateTo = filters.dateTo ?? asOfDate;
  const dateFrom = filters.dateFrom ?? addDays(dateTo, -6);
  const diffDays = getDateDiffDays(dateFrom, dateTo);

  if (diffDays < 0) {
    throw withStatus('dateFrom must be earlier than or equal to dateTo', 400);
  }

  if (diffDays > MAX_RANGE_DAYS) {
    throw withStatus(`Date range cannot exceed ${MAX_RANGE_DAYS} days`, 400);
  }

  return {
    asOfDate,
    dateFrom,
    dateTo,
    timezone: PLATFORM_TIMEZONE,
  };
}

async function refreshCurrentFactsForAllProjects() {
  const projects = await query<{ id: string }>(
    `
    select id
    from lobehub_admin.projects
    order by created_at desc
    `,
  );

  await Promise.all(projects.rows.map((project) => ensureCurrentProjectTopicDailyFacts(project.id)));
}

async function fetchSnapshot(asOfDate: string) {
  const result = await query<SnapshotRow>(
    `
    with bounds as (
      select (($1::date + time '00:00' + interval '1 day') at time zone 'Asia/Shanghai') as as_of_end
    )
    select
      (
        select count(*)::int
        from lobehub_admin.projects p, bounds b
        where p.created_at < b.as_of_end
      ) as project_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm, bounds b
        where pm.joined_at < b.as_of_end
          and pm.role = 'admin'
      ) as admin_binding_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm, bounds b
        where pm.joined_at < b.as_of_end
          and pm.role = 'member'
      ) as member_binding_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm, bounds b
        where pm.joined_at < b.as_of_end
      ) as total_member_binding_count,
      (
        select count(*)::int
        from lobehub_admin.project_managed_agents pma, bounds b
        where coalesce(pma.provisioned_at, pma.created_at) < b.as_of_end
          and pma.last_status = 'provisioned'
      ) as managed_member_count,
      (
        select count(*)::int
        from lobehub_admin.project_managed_agents pma, bounds b
        where coalesce(pma.provisioned_at, pma.created_at) < b.as_of_end
          and pma.managed_agent_id is not null
          and pma.last_status = 'provisioned'
      ) as managed_assistant_count,
      (
        select count(*)::int
        from lobehub_admin.project_managed_agents pma, bounds b
        where coalesce(pma.provisioned_at, pma.created_at) < b.as_of_end
          and pma.managed_session_id is not null
          and pma.last_status = 'provisioned'
      ) as managed_session_count,
      (
        select count(distinct t.id)::int
        from lobehub_admin.project_managed_agents pma
        join public.topics t
          on t.user_id = pma.user_id
         and t.session_id = pma.managed_session_id
        cross join bounds b
        where pma.managed_session_id is not null
          and t.created_at < b.as_of_end
      ) as cumulative_topic_count,
      (
        select coalesce(sum(f.visible_message_count), 0)::int
        from lobehub_admin.project_topic_daily_facts f
        where f.business_date <= $1::date
      ) as cumulative_visible_message_count,
      (
        select coalesce(sum(f.user_message_count), 0)::int
        from lobehub_admin.project_topic_daily_facts f
        where f.business_date <= $1::date
      ) as cumulative_user_message_count,
      (
        select coalesce(sum(f.assistant_message_count), 0)::int
        from lobehub_admin.project_topic_daily_facts f
        where f.business_date <= $1::date
      ) as cumulative_assistant_message_count,
      (
        select count(*)::int
        from lobehub_admin.project_daily_reports r
        where r.business_date <= $1::date
          and r.is_current = true
      ) as daily_report_count,
      (
        select count(*)::int
        from lobehub_admin.project_daily_reports r
        where r.business_date <= $1::date
      ) as daily_report_revision_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_sessions s, bounds b
        where s.created_at < b.as_of_end
      ) as customer_analysis_session_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at < b.as_of_end
      ) as customer_analysis_job_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at < b.as_of_end
          and j.status = 'completed'
      ) as customer_analysis_completed_job_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at < b.as_of_end
          and j.status = 'failed'
      ) as customer_analysis_failed_job_count
    `,
    [asOfDate],
  );

  return result.rows[0]!;
}

async function fetchRangeTotals(dateFrom: string, dateTo: string) {
  const result = await query<RangeRow>(
    `
    with bounds as (
      select
        (($1::date + time '00:00') at time zone 'Asia/Shanghai') as range_start,
        (($2::date + time '00:00' + interval '1 day') at time zone 'Asia/Shanghai') as range_end
    ),
    fact_stats as (
      select
        count(*) filter (where f.is_new_topic)::int as new_topic_count,
        count(distinct f.topic_id) filter (where f.is_active_topic)::int as active_topic_count,
        count(*) filter (where f.is_active_topic)::int as active_topic_day_count,
        count(distinct f.topic_id) filter (where f.has_visit)::int as visit_customer_count,
        count(*) filter (where f.has_visit)::int as visit_customer_day_count,
        count(*) filter (where f.is_first_visit)::int as first_visit_count,
        count(*) filter (where f.is_revisit)::int as revisit_count,
        count(distinct f.owner_user_id) filter (where f.is_active_topic)::int as active_member_count,
        coalesce(sum(f.visible_message_count), 0)::int as visible_message_count,
        coalesce(sum(f.user_message_count), 0)::int as user_message_count,
        coalesce(sum(f.assistant_message_count), 0)::int as assistant_message_count,
        count(*) filter (where f.latest_intent_band = 'A')::int as a_intent_count,
        count(*) filter (where f.latest_intent_band = 'B')::int as b_intent_count,
        count(*) filter (where f.latest_intent_band = 'C')::int as c_intent_count,
        count(*) filter (where f.latest_intent_band = 'D')::int as d_intent_count,
        count(*) filter (where f.has_visit and f.latest_intent_band is null)::int as missing_intent_count
      from lobehub_admin.project_topic_daily_facts f
      where f.business_date >= $1::date
        and f.business_date <= $2::date
    )
    select
      (
        select count(*)::int
        from lobehub_admin.projects p, bounds b
        where p.created_at >= b.range_start
          and p.created_at < b.range_end
      ) as new_project_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm, bounds b
        where pm.joined_at >= b.range_start
          and pm.joined_at < b.range_end
          and pm.role = 'member'
      ) as new_member_binding_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm, bounds b
        where pm.joined_at >= b.range_start
          and pm.joined_at < b.range_end
          and pm.role = 'admin'
      ) as new_admin_binding_count,
      (
        select count(*)::int
        from lobehub_admin.project_managed_agents pma, bounds b
        where coalesce(pma.provisioned_at, pma.created_at) >= b.range_start
          and coalesce(pma.provisioned_at, pma.created_at) < b.range_end
          and pma.last_status = 'provisioned'
      ) as new_managed_member_count,
      fs.new_topic_count,
      fs.active_topic_count,
      fs.active_topic_day_count,
      fs.visit_customer_count,
      fs.visit_customer_day_count,
      fs.first_visit_count,
      fs.revisit_count,
      fs.active_member_count,
      fs.visible_message_count,
      fs.user_message_count,
      fs.assistant_message_count,
      fs.a_intent_count,
      fs.b_intent_count,
      fs.c_intent_count,
      fs.d_intent_count,
      fs.missing_intent_count,
      (
        select count(*)::int
        from lobehub_admin.project_daily_reports r
        where r.business_date >= $1::date
          and r.business_date <= $2::date
          and r.is_current = true
      ) as daily_report_count,
      (
        select count(*)::int
        from lobehub_admin.daily_report_jobs j
        where j.business_date >= $1::date
          and j.business_date <= $2::date
          and j.status = 'completed'
      ) as daily_report_completed_job_count,
      (
        select count(*)::int
        from lobehub_admin.daily_report_jobs j
        where j.business_date >= $1::date
          and j.business_date <= $2::date
          and j.status = 'failed'
      ) as daily_report_failed_job_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_sessions s, bounds b
        where s.created_at >= b.range_start
          and s.created_at < b.range_end
      ) as customer_analysis_session_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at >= b.range_start
          and j.created_at < b.range_end
      ) as customer_analysis_job_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at >= b.range_start
          and j.created_at < b.range_end
          and j.status = 'completed'
      ) as customer_analysis_completed_job_count,
      (
        select count(*)::int
        from lobehub_admin.project_customer_analysis_jobs j, bounds b
        where j.created_at >= b.range_start
          and j.created_at < b.range_end
          and j.status = 'failed'
      ) as customer_analysis_failed_job_count
    from fact_stats fs
    `,
    [dateFrom, dateTo],
  );

  return result.rows[0]!;
}

async function fetchTrend(dateFrom: string, dateTo: string) {
  const result = await query<TrendRow>(
    `
    with bounds as (
      select
        (($1::date + time '00:00') at time zone 'Asia/Shanghai') as range_start,
        (($2::date + time '00:00' + interval '1 day') at time zone 'Asia/Shanghai') as range_end
    ),
    days as (
      select generate_series($1::date, $2::date, interval '1 day')::date as business_date
    ),
    project_created as (
      select (p.created_at at time zone 'Asia/Shanghai')::date as business_date, count(*)::int as count
      from lobehub_admin.projects p, bounds b
      where p.created_at >= b.range_start
        and p.created_at < b.range_end
      group by (p.created_at at time zone 'Asia/Shanghai')::date
    ),
    member_joined as (
      select (pm.joined_at at time zone 'Asia/Shanghai')::date as business_date, count(*)::int as count
      from lobehub_admin.project_members pm, bounds b
      where pm.joined_at >= b.range_start
        and pm.joined_at < b.range_end
      group by (pm.joined_at at time zone 'Asia/Shanghai')::date
    ),
    fact_stats as (
      select
        f.business_date,
        count(*) filter (where f.is_new_topic)::int as new_topic_count,
        count(*) filter (where f.is_active_topic)::int as active_topic_count,
        count(*) filter (where f.has_visit)::int as visit_customer_count,
        count(*) filter (where f.is_first_visit)::int as first_visit_count,
        count(*) filter (where f.is_revisit)::int as revisit_count,
        count(distinct f.owner_user_id) filter (where f.is_active_topic)::int as active_member_count,
        coalesce(sum(f.visible_message_count), 0)::int as visible_message_count
      from lobehub_admin.project_topic_daily_facts f
      where f.business_date >= $1::date
        and f.business_date <= $2::date
      group by f.business_date
    ),
    daily_reports as (
      select r.business_date, count(*)::int as count
      from lobehub_admin.project_daily_reports r
      where r.business_date >= $1::date
        and r.business_date <= $2::date
        and r.is_current = true
      group by r.business_date
    ),
    customer_analysis_jobs as (
      select (j.created_at at time zone 'Asia/Shanghai')::date as business_date, count(*)::int as count
      from lobehub_admin.project_customer_analysis_jobs j, bounds b
      where j.created_at >= b.range_start
        and j.created_at < b.range_end
      group by (j.created_at at time zone 'Asia/Shanghai')::date
    )
    select
      d.business_date::text as business_date,
      coalesce(pc.count, 0)::int as new_project_count,
      coalesce(mj.count, 0)::int as new_member_binding_count,
      coalesce(fs.new_topic_count, 0)::int as new_topic_count,
      coalesce(fs.active_topic_count, 0)::int as active_topic_count,
      coalesce(fs.visit_customer_count, 0)::int as visit_customer_count,
      coalesce(fs.first_visit_count, 0)::int as first_visit_count,
      coalesce(fs.revisit_count, 0)::int as revisit_count,
      coalesce(fs.active_member_count, 0)::int as active_member_count,
      coalesce(fs.visible_message_count, 0)::int as visible_message_count,
      coalesce(dr.count, 0)::int as daily_report_count,
      coalesce(caj.count, 0)::int as customer_analysis_job_count
    from days d
    left join project_created pc on pc.business_date = d.business_date
    left join member_joined mj on mj.business_date = d.business_date
    left join fact_stats fs on fs.business_date = d.business_date
    left join daily_reports dr on dr.business_date = d.business_date
    left join customer_analysis_jobs caj on caj.business_date = d.business_date
    order by d.business_date asc
    `,
    [dateFrom, dateTo],
  );

  return result.rows;
}

async function fetchProjectRows(dateFrom: string, dateTo: string) {
  const result = await query<ProjectMetricRow>(
    `
    with bounds as (
      select
        (($1::date + time '00:00') at time zone 'Asia/Shanghai') as range_start,
        (($2::date + time '00:00' + interval '1 day') at time zone 'Asia/Shanghai') as range_end
    ),
    member_stats as (
      select
        pm.project_id,
        count(*) filter (where pm.role = 'admin')::int as admin_count,
        count(*) filter (where pm.role = 'member')::int as member_count
      from lobehub_admin.project_members pm
      group by pm.project_id
    ),
    managed_stats as (
      select
        pma.project_id,
        count(*) filter (where pma.last_status = 'provisioned')::int as managed_member_count
      from lobehub_admin.project_managed_agents pma
      group by pma.project_id
    ),
    fact_stats as (
      select
        f.project_id,
        count(*) filter (where f.is_new_topic)::int as new_topic_count,
        count(distinct f.topic_id) filter (where f.is_active_topic)::int as active_topic_count,
        count(distinct f.topic_id) filter (where f.has_visit)::int as visit_customer_count,
        count(*) filter (where f.is_first_visit)::int as first_visit_count,
        count(*) filter (where f.is_revisit)::int as revisit_count,
        count(distinct f.owner_user_id) filter (where f.is_active_topic)::int as active_member_count,
        coalesce(sum(f.visible_message_count), 0)::int as visible_message_count,
        coalesce(sum(f.user_message_count), 0)::int as user_message_count,
        coalesce(sum(f.assistant_message_count), 0)::int as assistant_message_count
      from lobehub_admin.project_topic_daily_facts f
      where f.business_date >= $1::date
        and f.business_date <= $2::date
      group by f.project_id
    ),
    daily_report_stats as (
      select
        r.project_id,
        count(*)::int as daily_report_count
      from lobehub_admin.project_daily_reports r
      where r.business_date >= $1::date
        and r.business_date <= $2::date
        and r.is_current = true
      group by r.project_id
    ),
    daily_job_stats as (
      select
        j.project_id,
        count(*) filter (where j.status = 'completed')::int as daily_report_completed_job_count,
        count(*) filter (where j.status = 'failed')::int as daily_report_failed_job_count,
        count(*) filter (where j.status in ('pending', 'running'))::int as running_daily_job_count
      from lobehub_admin.daily_report_jobs j
      where j.business_date >= $1::date
        and j.business_date <= $2::date
      group by j.project_id
    ),
    analysis_session_stats as (
      select
        s.project_id,
        count(*)::int as customer_analysis_session_count
      from lobehub_admin.project_customer_analysis_sessions s, bounds b
      where s.created_at >= b.range_start
        and s.created_at < b.range_end
      group by s.project_id
    ),
    analysis_job_stats as (
      select
        j.project_id,
        count(*)::int as customer_analysis_job_count,
        count(*) filter (where j.status = 'completed')::int as customer_analysis_completed_job_count,
        count(*) filter (where j.status = 'failed')::int as customer_analysis_failed_job_count,
        count(*) filter (where j.status in ('pending', 'running'))::int as running_analysis_job_count
      from lobehub_admin.project_customer_analysis_jobs j, bounds b
      where j.created_at >= b.range_start
        and j.created_at < b.range_end
      group by j.project_id
    ),
    provision_job_stats as (
      select
        pj.project_id,
        count(*) filter (where pj.status in ('pending', 'running'))::int as running_provision_job_count,
        count(*) filter (where pj.status = 'failed')::int as failed_provision_job_count
      from lobehub_admin.provision_jobs pj, bounds b
      where pj.created_at >= b.range_start
        and pj.created_at < b.range_end
      group by pj.project_id
    )
    select
      p.id as project_id,
      p.name as project_name,
      p.description,
      p.created_at,
      coalesce(ms.admin_count, 0)::int as admin_count,
      coalesce(ms.member_count, 0)::int as member_count,
      coalesce(mgs.managed_member_count, 0)::int as managed_member_count,
      coalesce(fs.new_topic_count, 0)::int as new_topic_count,
      coalesce(fs.active_topic_count, 0)::int as active_topic_count,
      coalesce(fs.visit_customer_count, 0)::int as visit_customer_count,
      coalesce(fs.first_visit_count, 0)::int as first_visit_count,
      coalesce(fs.revisit_count, 0)::int as revisit_count,
      coalesce(fs.active_member_count, 0)::int as active_member_count,
      coalesce(fs.visible_message_count, 0)::int as visible_message_count,
      coalesce(fs.user_message_count, 0)::int as user_message_count,
      coalesce(fs.assistant_message_count, 0)::int as assistant_message_count,
      coalesce(drs.daily_report_count, 0)::int as daily_report_count,
      coalesce(djs.daily_report_completed_job_count, 0)::int as daily_report_completed_job_count,
      coalesce(djs.daily_report_failed_job_count, 0)::int as daily_report_failed_job_count,
      coalesce(ass.customer_analysis_session_count, 0)::int as customer_analysis_session_count,
      coalesce(ajs.customer_analysis_job_count, 0)::int as customer_analysis_job_count,
      coalesce(ajs.customer_analysis_completed_job_count, 0)::int as customer_analysis_completed_job_count,
      coalesce(ajs.customer_analysis_failed_job_count, 0)::int as customer_analysis_failed_job_count,
      (
        coalesce(djs.running_daily_job_count, 0)
        + coalesce(ajs.running_analysis_job_count, 0)
        + coalesce(pjs.running_provision_job_count, 0)
      )::int as running_task_count,
      (
        coalesce(djs.daily_report_failed_job_count, 0)
        + coalesce(ajs.customer_analysis_failed_job_count, 0)
        + coalesce(pjs.failed_provision_job_count, 0)
      )::int as failed_task_count
    from lobehub_admin.projects p
    left join member_stats ms on ms.project_id = p.id
    left join managed_stats mgs on mgs.project_id = p.id
    left join fact_stats fs on fs.project_id = p.id
    left join daily_report_stats drs on drs.project_id = p.id
    left join daily_job_stats djs on djs.project_id = p.id
    left join analysis_session_stats ass on ass.project_id = p.id
    left join analysis_job_stats ajs on ajs.project_id = p.id
    left join provision_job_stats pjs on pjs.project_id = p.id
    order by
      coalesce(fs.revisit_count, 0) desc,
      coalesce(fs.visit_customer_count, 0) desc,
      coalesce(fs.new_topic_count, 0) desc,
      (
        coalesce(djs.daily_report_failed_job_count, 0)
        + coalesce(ajs.customer_analysis_failed_job_count, 0)
        + coalesce(pjs.failed_provision_job_count, 0)
      ) desc,
      p.created_at desc
    `,
    [dateFrom, dateTo],
  );

  return result.rows;
}

export async function getSystemMetrics(filters: SystemMetricsFilters = {}) {
  const resolved = resolveFilters(filters);

  await refreshCurrentFactsForAllProjects();

  const [snapshot, range, trend, projects] = await Promise.all([
    fetchSnapshot(resolved.asOfDate),
    fetchRangeTotals(resolved.dateFrom, resolved.dateTo),
    fetchTrend(resolved.dateFrom, resolved.dateTo),
    fetchProjectRows(resolved.dateFrom, resolved.dateTo),
  ]);

  return {
    filters: resolved,
    snapshot: {
      projectCount: snapshot.project_count,
      adminBindingCount: snapshot.admin_binding_count,
      memberBindingCount: snapshot.member_binding_count,
      totalMemberBindingCount: snapshot.total_member_binding_count,
      managedMemberCount: snapshot.managed_member_count,
      managedAssistantCount: snapshot.managed_assistant_count,
      managedSessionCount: snapshot.managed_session_count,
      cumulativeTopicCount: snapshot.cumulative_topic_count,
      cumulativeVisibleMessageCount: snapshot.cumulative_visible_message_count,
      cumulativeUserMessageCount: snapshot.cumulative_user_message_count,
      cumulativeAssistantMessageCount: snapshot.cumulative_assistant_message_count,
      dailyReportCount: snapshot.daily_report_count,
      dailyReportRevisionCount: snapshot.daily_report_revision_count,
      customerAnalysisSessionCount: snapshot.customer_analysis_session_count,
      customerAnalysisJobCount: snapshot.customer_analysis_job_count,
      customerAnalysisCompletedJobCount: snapshot.customer_analysis_completed_job_count,
      customerAnalysisFailedJobCount: snapshot.customer_analysis_failed_job_count,
    },
    range: {
      newProjectCount: range.new_project_count,
      newMemberBindingCount: range.new_member_binding_count,
      newAdminBindingCount: range.new_admin_binding_count,
      newManagedMemberCount: range.new_managed_member_count,
      newTopicCount: range.new_topic_count,
      activeTopicCount: range.active_topic_count,
      activeTopicDayCount: range.active_topic_day_count,
      visitCustomerCount: range.visit_customer_count,
      visitCustomerDayCount: range.visit_customer_day_count,
      firstVisitCount: range.first_visit_count,
      revisitCount: range.revisit_count,
      activeMemberCount: range.active_member_count,
      visibleMessageCount: range.visible_message_count,
      userMessageCount: range.user_message_count,
      assistantMessageCount: range.assistant_message_count,
      aIntentCount: range.a_intent_count,
      bIntentCount: range.b_intent_count,
      cIntentCount: range.c_intent_count,
      dIntentCount: range.d_intent_count,
      highIntentCount: range.a_intent_count + range.b_intent_count,
      missingIntentCount: range.missing_intent_count,
      dailyReportCount: range.daily_report_count,
      dailyReportCompletedJobCount: range.daily_report_completed_job_count,
      dailyReportFailedJobCount: range.daily_report_failed_job_count,
      customerAnalysisSessionCount: range.customer_analysis_session_count,
      customerAnalysisJobCount: range.customer_analysis_job_count,
      customerAnalysisCompletedJobCount: range.customer_analysis_completed_job_count,
      customerAnalysisFailedJobCount: range.customer_analysis_failed_job_count,
    },
    trend: trend.map((row) => ({
      businessDate: row.business_date,
      newProjectCount: row.new_project_count,
      newMemberBindingCount: row.new_member_binding_count,
      newTopicCount: row.new_topic_count,
      activeTopicCount: row.active_topic_count,
      visitCustomerCount: row.visit_customer_count,
      firstVisitCount: row.first_visit_count,
      revisitCount: row.revisit_count,
      activeMemberCount: row.active_member_count,
      visibleMessageCount: row.visible_message_count,
      dailyReportCount: row.daily_report_count,
      customerAnalysisJobCount: row.customer_analysis_job_count,
    })),
    projects: projects.map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      description: row.description,
      createdAt: row.created_at,
      adminCount: row.admin_count,
      memberCount: row.member_count,
      managedMemberCount: row.managed_member_count,
      newTopicCount: row.new_topic_count,
      activeTopicCount: row.active_topic_count,
      visitCustomerCount: row.visit_customer_count,
      firstVisitCount: row.first_visit_count,
      revisitCount: row.revisit_count,
      activeMemberCount: row.active_member_count,
      visibleMessageCount: row.visible_message_count,
      userMessageCount: row.user_message_count,
      assistantMessageCount: row.assistant_message_count,
      dailyReportCount: row.daily_report_count,
      dailyReportCompletedJobCount: row.daily_report_completed_job_count,
      dailyReportFailedJobCount: row.daily_report_failed_job_count,
      customerAnalysisSessionCount: row.customer_analysis_session_count,
      customerAnalysisJobCount: row.customer_analysis_job_count,
      customerAnalysisCompletedJobCount: row.customer_analysis_completed_job_count,
      customerAnalysisFailedJobCount: row.customer_analysis_failed_job_count,
      runningTaskCount: row.running_task_count,
      failedTaskCount: row.failed_task_count,
    })),
  } satisfies SystemMetrics;
}
