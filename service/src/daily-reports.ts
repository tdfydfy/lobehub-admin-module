import type { QueryResultRow } from 'pg';
import { env } from './config.js';
import { db, query } from './db.js';
import { generateDailyReportSummary } from './daily-report-model.js';
import { resolveBusinessWindow } from './daily-report-time.js';
import type {
  DailyReportExecutionSnapshot,
  DailyReportGenerationResult,
  DailyReportSettingRecord,
  DailyReportSourceCustomer,
  DailyReportSourcePayload,
  DailyReportSourceTopic,
  DailyReportWindow,
} from './daily-report-types.js';

type DailyReportSettingRow = {
  project_id: string;
  enabled: boolean;
  timezone: string;
  business_day_close_time_local: string;
  prompt_template: string | null;
  generate_when_no_visit: boolean;
  model_provider_override: 'volcengine' | 'fallback' | null;
  model_name_override: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type DailyReportSourceMessageRow = {
  project_id: string;
  project_name: string;
  project_description: string | null;
  user_id: string;
  display_name: string;
  email: string | null;
  managed_session_id: string;
  managed_session_title: string | null;
  topic_id: string;
  topic_title: string;
  topic_created_at: string;
  topic_updated_at: string;
  message_id: string;
  message_role: string;
  message_content: string;
  message_created_at: string;
};

type DailyReportListRow = {
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

type DailyReportDetailRow = {
  id: string;
  project_id: string;
  business_date: string;
  revision: number;
  is_current: boolean;
  job_id: string | null;
  timezone: string;
  window_start_at: string;
  window_end_at: string;
  visited_customer_count: number;
  active_topic_count: number;
  total_message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  summary_json: unknown;
  summary_markdown: string;
  prompt_snapshot: string;
  system_prompt_version: string;
  model_provider: string;
  model_name: string;
  generation_meta: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type DailyReportJobRow = {
  id: string;
  project_id: string;
  business_date: string;
  trigger_source: 'scheduled' | 'manual' | 'retry';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  timezone: string;
  close_time_local: string;
  generate_when_no_visit: boolean;
  window_start_at: string;
  window_end_at: string;
  prompt_snapshot: string;
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

type DailyReportListFilters = {
  businessDateFrom?: string;
  businessDateTo?: string;
  page: number;
  pageSize: number;
};

type ProjectInfoRow = {
  id: string;
  name: string;
  description: string | null;
};

function toIsoTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  return String(value);
}

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function mapSettingRow(row: DailyReportSettingRow | undefined, projectId: string): DailyReportSettingRecord {
  return {
    projectId,
    enabled: row?.enabled ?? false,
    timezone: row?.timezone ?? 'Asia/Shanghai',
    businessDayCloseTimeLocal: row?.business_day_close_time_local ?? '22:00:00',
    systemPrompt: getDailyReportSystemPrompt(''),
    promptTemplate: row?.prompt_template ?? '',
    generateWhenNoVisit: row?.generate_when_no_visit ?? true,
    modelProviderOverride: row?.model_provider_override ?? null,
    modelNameOverride: row?.model_name_override ?? null,
    updatedBy: row?.updated_by ?? null,
    createdAt: row?.created_at ? toIsoTimestamp(row.created_at) : null,
    updatedAt: row?.updated_at ? toIsoTimestamp(row.updated_at) : null,
  };
}

function getSystemPromptTemplate(customPrompt: string) {
  const extra = customPrompt.trim() ? `\n项目补充要求：\n${customPrompt.trim()}` : '';
  return [
    '基于项目官方助手会话的营业日消息，生成结构化客户日报。',
    '要求覆盖所有来访客户，识别重点客户、风险和下一步动作。',
    '不得编造事实，只能依据当日消息归纳。',
    extra,
  ].join('\n');
}

function getDailyReportSystemPrompt(customPrompt: string) {
  const extra = customPrompt.trim() ? `\n项目补充要求：\n${customPrompt.trim()}` : '';
  return [
    '基于项目官方助手会话的营业日消息，生成项目经营日报。',
    '必须站在项目经营管理视角输出，不要评价单个销售表现。',
    '正文要紧凑、连贯、使用中文撰写，不要分成很多模块，不要输出 JSON、表格或代码块。',
    '正文至少回答这些问题：今天来访了几组、高意向几组、客户整体最关心什么、管理上需要关注什么、建议提供什么动作或道具。',
    '不要只罗列抽象名词，例如“价格预算”“房源楼层”“管理层需要统一解决”等，这种表述如果没有具体原因、对象和动作，视为无效。',
    '每个管理判断都要尽量写具体：是哪些客户组、卡在哪个点、为什么会卡、项目端具体要给什么支持。',
    '每条管理动作建议都要尽量落到具体动作或道具，例如：释放哪类房源口径、准备什么对比资料、是否需要调整价格策略、是否要扩大中介覆盖、是否要提高激励、是否要集中复访。',
    '如果信息不足以支撑某个管理动作，就明确写“暂不建议动作”，不要为了完整而强行编造建议。',
    '优先写对项目经营真正有用的话，不要写空泛套话，不要重复同义句。',
    '只能依据当日消息归纳，不得编造未出现的事实。',
    extra,
  ].join('\n');
}

function resolveExecutionSnapshot(setting: DailyReportSettingRecord): DailyReportExecutionSnapshot {
  const modelProvider = setting.modelProviderOverride
    ?? (env.DAILY_REPORT_DEFAULT_MODEL_PROVIDER ?? (env.VOLCENGINE_API_KEY ? 'volcengine' : 'fallback'));
  const modelName = setting.modelNameOverride
    ?? env.DAILY_REPORT_DEFAULT_MODEL_NAME
    ?? (modelProvider === 'volcengine' ? 'doubao-seed-2-0-lite-260215' : 'built-in-fallback');

  return {
    generateWhenNoVisit: setting.generateWhenNoVisit,
    promptSnapshot: getDailyReportSystemPrompt(setting.promptTemplate),
    modelProvider,
    modelName,
  };
}

export async function getProjectDailyReportSetting(projectId: string) {
  const result = await query<DailyReportSettingRow>(
    `
    select
      project_id,
      enabled,
      timezone,
      business_day_close_time_local::text as business_day_close_time_local,
      prompt_template,
      generate_when_no_visit,
      model_provider_override,
      model_name_override,
      updated_by,
      created_at,
      updated_at
    from lobehub_admin.project_daily_report_settings
    where project_id = $1
    limit 1
    `,
    [projectId],
  );

  return mapSettingRow(result.rows[0], projectId);
}

export async function upsertProjectDailyReportSetting(
  projectId: string,
  actorId: string,
  input: {
    enabled: boolean;
    timezone: string;
    businessDayCloseTimeLocal: string;
    promptTemplate: string;
    generateWhenNoVisit: boolean;
    modelProviderOverride: 'volcengine' | 'fallback' | null;
    modelNameOverride: string | null;
  },
) {
  await query(
    `
    insert into lobehub_admin.project_daily_report_settings (
      project_id,
      enabled,
      timezone,
      business_day_close_time_local,
      prompt_template,
      generate_when_no_visit,
      model_provider_override,
      model_name_override,
      updated_by
    )
    values ($1, $2, $3, $4::time, $5, $6, $7, $8, $9)
    on conflict (project_id) do update
      set enabled = excluded.enabled,
          timezone = excluded.timezone,
          business_day_close_time_local = excluded.business_day_close_time_local,
          prompt_template = excluded.prompt_template,
          generate_when_no_visit = excluded.generate_when_no_visit,
          model_provider_override = excluded.model_provider_override,
          model_name_override = excluded.model_name_override,
          updated_by = excluded.updated_by,
          updated_at = now()
    `,
    [
      projectId,
      input.enabled,
      input.timezone,
      input.businessDayCloseTimeLocal,
      input.promptTemplate,
      input.generateWhenNoVisit,
      input.modelProviderOverride,
      input.modelNameOverride,
      actorId,
    ],
  );

  return getProjectDailyReportSetting(projectId);
}

export async function listProjectDailyReports(projectId: string, filters: DailyReportListFilters) {
  const conditions = ['project_id = $1', 'is_current = true'];
  const values: unknown[] = [projectId];

  if (filters.businessDateFrom) {
    values.push(filters.businessDateFrom);
    conditions.push(`business_date >= $${values.length}::date`);
  }

  if (filters.businessDateTo) {
    values.push(filters.businessDateTo);
    conditions.push(`business_date <= $${values.length}::date`);
  }

  const whereSql = conditions.join(' and ');
  const offset = (filters.page - 1) * filters.pageSize;
  const totalResult = await query<{ total: number }>(
    `
    select count(*)::int as total
    from lobehub_admin.project_daily_reports
    where ${whereSql}
    `,
    values,
  );
  const rowsResult = await query<DailyReportListRow>(
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
    where ${whereSql}
    order by business_date desc, revision desc
    limit $${values.length + 1}
    offset $${values.length + 2}
    `,
    [...values, filters.pageSize, offset],
  );

  const total = totalResult.rows[0]?.total ?? 0;

  return {
    rows: rowsResult.rows.map((row) => ({
      reportId: row.id,
      businessDate: row.business_date,
      revision: row.revision,
      isCurrent: row.is_current,
      visitedCustomerCount: row.visited_customer_count,
      activeTopicCount: row.active_topic_count,
      totalMessageCount: row.total_message_count,
      userMessageCount: row.user_message_count,
      assistantMessageCount: row.assistant_message_count,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      generatedAt: toIsoTimestamp(row.created_at),
    })),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
  };
}

export async function getProjectDailyReportDetail(projectId: string, reportId: string) {
  const result = await query<DailyReportDetailRow>(
    `
    select
      id,
      project_id,
      business_date::text as business_date,
      revision,
      is_current,
      job_id,
      timezone,
      window_start_at,
      window_end_at,
      visited_customer_count,
      active_topic_count,
      total_message_count,
      user_message_count,
      assistant_message_count,
      summary_json,
      summary_markdown,
      prompt_snapshot,
      system_prompt_version,
      model_provider,
      model_name,
      generation_meta,
      created_by,
      created_at,
      updated_at
    from lobehub_admin.project_daily_reports
    where project_id = $1
      and id = $2
    limit 1
    `,
    [projectId, reportId],
  );

  return result.rows[0] ?? null;
}

export async function getProjectDailyReportJob(projectId: string, jobId: string) {
  const result = await query<DailyReportJobRow>(
    `
    select
      id,
      project_id,
      business_date::text as business_date,
      trigger_source,
      status,
      timezone,
      close_time_local,
      generate_when_no_visit,
      window_start_at,
      window_end_at,
      prompt_snapshot,
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
      and id = $2
    limit 1
    `,
    [projectId, jobId],
  );

  return result.rows[0] ?? null;
}

export async function getCurrentDailyReportForBusinessDate(projectId: string, businessDate: string) {
  const result = await query<{ id: string }>(
    `
    select id
    from lobehub_admin.project_daily_reports
    where project_id = $1
      and business_date = $2::date
      and is_current = true
    limit 1
    `,
    [projectId, businessDate],
  );

  return result.rows[0]?.id ?? null;
}

export async function getLatestDailyReportJobs(projectId: string, limit = 6) {
  const result = await query<DailyReportJobRow>(
    `
    select
      id,
      project_id,
      business_date::text as business_date,
      trigger_source,
      status,
      timezone,
      close_time_local,
      generate_when_no_visit,
      window_start_at,
      window_end_at,
      prompt_snapshot,
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
    order by created_at desc
    limit $2
    `,
    [projectId, limit],
  );

  return result.rows;
}

async function hasCompletedOrCancelledScheduledJob(projectId: string, businessDate: string) {
  const result = await query<{ id: string }>(
    `
    select id
    from lobehub_admin.daily_report_jobs
    where project_id = $1
      and business_date = $2::date
      and trigger_source = 'scheduled'
      and status in ('completed', 'cancelled')
    limit 1
    `,
    [projectId, businessDate],
  );

  return Boolean(result.rows[0]?.id);
}

export async function collectProjectDailyReportSource(projectId: string, window: DailyReportWindow): Promise<DailyReportSourcePayload> {
  const projectResult = await query<ProjectInfoRow>(
    `
    select id, name, description
    from lobehub_admin.projects
    where id = $1
    limit 1
    `,
    [projectId],
  );

  const project = projectResult.rows[0];

  if (!project) {
    throw withStatus(`Project not found: ${projectId}`, 404);
  }

  const result = await query<DailyReportSourceMessageRow>(
    `
    select
      p.id as project_id,
      p.name as project_name,
      p.description as project_description,
      pm.user_id,
      lobehub_admin.user_display_name(pm.user_id) as display_name,
      u.email,
      pma.managed_session_id,
      managed_session.title as managed_session_title,
      t.id as topic_id,
      coalesce(nullif(btrim(t.title), ''), 'Untitled topic') as topic_title,
      t.created_at as topic_created_at,
      t.updated_at as topic_updated_at,
      m.id as message_id,
      m.role as message_role,
      coalesce(
        nullif(trim(m.content), ''),
        nullif(trim(m.summary), ''),
        case when m.editor_data is not null then m.editor_data::text else null end,
        ''
      ) as message_content,
      m.created_at as message_created_at
    from lobehub_admin.projects p
    join lobehub_admin.project_members pm
      on pm.project_id = p.id
     and pm.role = 'member'
    join public.users u
      on u.id = pm.user_id
    join lobehub_admin.project_managed_agents pma
      on pma.project_id = pm.project_id
     and pma.user_id = pm.user_id
     and pma.managed_session_id is not null
    left join public.sessions managed_session
      on managed_session.id = pma.managed_session_id
    join public.topics t
      on t.user_id = pm.user_id
     and t.session_id = pma.managed_session_id
    join public.messages m
      on m.topic_id = t.id
    where p.id = $1
      and m.created_at >= $2::timestamptz
      and m.created_at < $3::timestamptz
      and m.role <> 'tool'
      and (
        length(trim(coalesce(m.content, ''))) > 0
        or length(trim(coalesce(m.summary, ''))) > 0
        or m.editor_data is not null
      )
    order by pm.user_id asc, t.created_at asc, m.created_at asc, m.id asc
    `,
    [projectId, window.startAt, window.endAt],
  );

  const customerMap = new Map<string, DailyReportSourceCustomer>();
  let activeTopicCount = 0;
  let totalMessageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const row of result.rows) {
    const messageContent = row.message_content.trim();
    if (!messageContent) {
      continue;
    }

    let customer = customerMap.get(row.user_id);
    if (!customer) {
      customer = {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        managedSessionId: row.managed_session_id,
        managedSessionTitle: row.managed_session_title,
        topics: [],
      };
      customerMap.set(row.user_id, customer);
    }

    let topic = customer.topics.find((item) => item.topicId === row.topic_id);
    if (!topic) {
      topic = {
        topicId: row.topic_id,
        title: row.topic_title,
        createdAt: toIsoTimestamp(row.topic_created_at),
        updatedAt: toIsoTimestamp(row.topic_updated_at),
        messages: [],
      };
      customer.topics.push(topic);
      activeTopicCount += 1;
    }

    topic.messages.push({
      id: row.message_id,
      role: row.message_role,
      content: messageContent,
      createdAt: toIsoTimestamp(row.message_created_at),
    });

    totalMessageCount += 1;
    if (row.message_role === 'user') userMessageCount += 1;
    if (row.message_role === 'assistant') assistantMessageCount += 1;
  }

  const customers = [...customerMap.values()]
    .filter((customer) => customer.topics.some((topic) => topic.messages.length > 0))
    .sort((left, right) => {
      const leftLast = left.topics.flatMap((topic) => topic.messages).at(-1)?.createdAt ?? '';
      const rightLast = right.topics.flatMap((topic) => topic.messages).at(-1)?.createdAt ?? '';
      return rightLast.localeCompare(leftLast);
    });

  const visitedCustomerCount = customers.reduce((count, customer) =>
    count + customer.topics.filter((topic) => topic.messages.some((message) => message.role === 'user')).length, 0);

  return {
    project: {
      projectId: project.id,
      projectName: project.name,
      description: project.description,
    },
    window,
    customers,
    metrics: {
      visitedCustomerCount,
      activeTopicCount,
      totalMessageCount,
      userMessageCount,
      assistantMessageCount,
    },
  };
}

export async function createDailyReportJob(
  projectId: string,
  businessDate: string,
  triggerSource: 'scheduled' | 'manual' | 'retry',
  createdBy: string | null,
) {
  const setting = await getProjectDailyReportSetting(projectId);
  const existingReportId = await getCurrentDailyReportForBusinessDate(projectId, businessDate);

  if (existingReportId && triggerSource === 'scheduled') {
    return null;
  }

  if (triggerSource === 'scheduled' && await hasCompletedOrCancelledScheduledJob(projectId, businessDate)) {
    return null;
  }

  const activeJobResult = await query<{ id: string }>(
    `
    select id
    from lobehub_admin.daily_report_jobs
    where project_id = $1
      and business_date = $2::date
      and status in ('pending', 'running')
    limit 1
    `,
    [projectId, businessDate],
  );
  const activeJobId = activeJobResult.rows[0]?.id ?? null;

  if (activeJobId) {
    if (triggerSource === 'scheduled') {
      return activeJobId;
    }

    throw withStatus(`A daily report job is already running for ${businessDate}: ${activeJobId}`, 409);
  }

  const window = resolveBusinessWindow(
    businessDate,
    setting.timezone,
    setting.businessDayCloseTimeLocal,
  );
  const executionSnapshot = resolveExecutionSnapshot(setting);
  const jobResult = await query<{ id: string }>(
    `
    insert into lobehub_admin.daily_report_jobs (
      project_id,
      business_date,
      trigger_source,
      status,
      timezone,
      close_time_local,
      generate_when_no_visit,
      window_start_at,
      window_end_at,
      prompt_snapshot,
      model_provider,
      model_name,
      created_by
    )
    values ($1, $2::date, $3, 'pending', $4, $5::time, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11, $12)
    returning id
    `,
    [
      projectId,
      businessDate,
      triggerSource,
      setting.timezone,
      setting.businessDayCloseTimeLocal,
      executionSnapshot.generateWhenNoVisit,
      window.startAt,
      window.endAt,
      executionSnapshot.promptSnapshot,
      executionSnapshot.modelProvider,
      executionSnapshot.modelName,
      createdBy,
    ],
  );

  return jobResult.rows[0]?.id ?? null;
}

export async function runDailyReportJob(jobId: string): Promise<{ reportId: string | null; generated: DailyReportGenerationResult | null }> {
  const jobResult = await query<DailyReportJobRow>(
    `
    select
      id,
      project_id,
      business_date::text as business_date,
      trigger_source,
      status,
      timezone,
      close_time_local,
      generate_when_no_visit,
      window_start_at,
      window_end_at,
      prompt_snapshot,
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
    where id = $1
    limit 1
    `,
    [jobId],
  );
  const job = jobResult.rows[0];

  if (!job) {
    throw new Error(`Daily report job not found: ${jobId}`);
  }

  if (job.status === 'completed') {
    return { reportId: job.report_id, generated: null };
  }

  await query(
    `
    update lobehub_admin.daily_report_jobs
    set status = 'running',
        error_message = null,
        started_at = coalesce(started_at, now()),
        finished_at = null,
        updated_at = now()
    where id = $1
    `,
    [jobId],
  );

  try {
    const source = await collectProjectDailyReportSource(job.project_id, {
      businessDate: job.business_date,
      timeZone: job.timezone,
      closeTimeLocal: job.close_time_local,
      startAt: toIsoTimestamp(job.window_start_at),
      endAt: toIsoTimestamp(job.window_end_at),
    });

    if (source.metrics.visitedCustomerCount === 0 && !job.generate_when_no_visit) {
      await query(
        `
        update lobehub_admin.daily_report_jobs
        set status = 'cancelled',
            error_message = 'No visiting customers in the business window and generate_when_no_visit=false',
            finished_at = now(),
            updated_at = now()
        where id = $1
        `,
        [jobId],
      );

      return { reportId: null, generated: null };
    }

    const generated = await generateDailyReportSummary(source, {
      generateWhenNoVisit: job.generate_when_no_visit,
      promptSnapshot: job.prompt_snapshot,
      modelProvider: job.model_provider as DailyReportExecutionSnapshot['modelProvider'],
      modelName: job.model_name,
    });
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const revisionResult = await client.query<{ next_revision: number }>(
        `
        select coalesce(max(revision), 0)::int + 1 as next_revision
        from lobehub_admin.project_daily_reports
        where project_id = $1
          and business_date = $2::date
        `,
        [job.project_id, job.business_date],
      );
      const nextRevision = revisionResult.rows[0]?.next_revision ?? 1;

      await client.query(
        `
        update lobehub_admin.project_daily_reports
        set is_current = false,
            updated_at = now()
        where project_id = $1
          and business_date = $2::date
          and is_current = true
        `,
        [job.project_id, job.business_date],
      );

      const reportInsertResult = await client.query<{ id: string }>(
        `
        insert into lobehub_admin.project_daily_reports (
          project_id,
          business_date,
          revision,
          is_current,
          job_id,
          timezone,
          window_start_at,
          window_end_at,
          visited_customer_count,
          active_topic_count,
          total_message_count,
          user_message_count,
          assistant_message_count,
          summary_json,
          summary_markdown,
          prompt_snapshot,
          system_prompt_version,
          model_provider,
          model_name,
          generation_meta,
          created_by
        )
        values (
          $1,
          $2::date,
          $3,
          true,
          $4,
          $5,
          $6::timestamptz,
          $7::timestamptz,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::jsonb,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19::jsonb,
          $20
        )
        returning id
        `,
        [
          job.project_id,
          job.business_date,
          nextRevision,
          job.id,
          job.timezone,
          job.window_start_at,
          job.window_end_at,
          generated.summary.stats.visitedGroupCount,
          generated.summary.stats.activeTopicCount,
          generated.summary.stats.totalMessageCount,
          generated.summary.stats.userMessageCount,
          generated.summary.stats.assistantMessageCount,
          JSON.stringify(generated.summary),
          generated.summaryMarkdown,
          job.prompt_snapshot,
          generated.summary.generation.promptVersion,
          generated.summary.generation.modelProvider,
          generated.summary.generation.modelName,
          JSON.stringify(generated.generationMeta),
          job.created_by,
        ],
      );

      const reportId = reportInsertResult.rows[0]?.id ?? null;

      await client.query(
        `
        update lobehub_admin.daily_report_jobs
        set status = 'completed',
            report_id = $2,
            error_message = null,
            finished_at = now(),
            updated_at = now()
        where id = $1
        `,
        [jobId, reportId],
      );

      await client.query('COMMIT');
      return { reportId, generated };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await query(
      `
      update lobehub_admin.daily_report_jobs
      set status = 'failed',
          error_message = $2,
          finished_at = now(),
          updated_at = now()
      where id = $1
      `,
      [jobId, (error as Error).message],
    );

    throw error;
  }
}

export async function listDueDailyReportProjects(now = new Date()) {
  const result = await query<DailyReportSettingRow & QueryResultRow>(
    `
    select
      project_id,
      enabled,
      timezone,
      business_day_close_time_local::text as business_day_close_time_local,
      prompt_template,
      generate_when_no_visit,
      model_provider_override,
      model_name_override,
      updated_by,
      created_at,
      updated_at
    from lobehub_admin.project_daily_report_settings
    where enabled = true
    `,
  );

  return result.rows.map((row) => ({
    setting: mapSettingRow(row, row.project_id),
    now,
  }));
}
