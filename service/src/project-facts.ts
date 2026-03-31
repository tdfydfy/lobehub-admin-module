import { db, query } from './db.js';
import { addDays, getLocalDateString, normalizeTimeString, zonedLocalDateTimeToUtc } from './daily-report-time.js';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DEFAULT_CLOSE_TIME = '22:00:00';
const FACT_REFRESH_THRESHOLD_MS = 2 * 60 * 1000;

const EFFECTIVE_CONTENT_SQL = `
  coalesce(
    nullif(trim(m.content), ''),
    nullif(trim(m.summary), ''),
    case when m.editor_data is not null then m.editor_data::text else null end,
    ''
  )
`;

type FactSettingsRow = {
  timezone: string | null;
  business_day_close_time_local: string | null;
};

type ProjectInfoRow = {
  id: string;
  name: string;
  description: string | null;
};

type RelevantTopicRow = {
  topic_id: string;
  owner_user_id: string;
  managed_session_id: string;
  topic_title: string;
  topic_created_at: string;
  topic_updated_at: string;
};

type TopicMessageRow = {
  topic_id: string;
  message_id: string;
  role: string;
  content: string;
  created_at: string;
};

type TopicUserHistoryRow = {
  topic_id: string;
  first_user_message_at: string | null;
  previous_user_message_at: string | null;
  last_user_message_at: string | null;
};

type FactRow = {
  project_id: string;
  business_date: string;
  topic_id: string;
  owner_user_id: string;
  managed_session_id: string;
  topic_created_at: string;
  topic_updated_at: string;
  first_user_message_at: string | null;
  previous_user_message_at: string | null;
  last_user_message_at: string | null;
  last_visible_message_at: string | null;
  is_new_topic: boolean;
  is_active_topic: boolean;
  has_visit: boolean;
  is_first_visit: boolean;
  is_revisit: boolean;
  visible_message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  latest_intent_band: 'A' | 'B' | 'C' | 'D' | null;
  latest_intent_grade: string | null;
  latest_intent_at: string | null;
};

export type ProjectFactWindow = {
  businessDate: string;
  timeZone: string;
  closeTimeLocal: string;
  startAt: string;
  endAt: string;
  isPartial: boolean;
};

export type ProjectOverview = {
  project: {
    projectId: string;
    projectName: string;
    description: string | null;
    timezone: string;
    closeTimeLocal: string;
    businessDate: string;
    windowStartAt: string;
    windowEndAt: string;
    isPartial: boolean;
  };
  stats: {
    newTopicCount: number;
    activeTopicCount: number;
    visitCustomerCount: number;
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
    lastActiveAt: string | null;
  };
  members: {
    totalMembers: number;
    adminCount: number;
    memberCount: number;
    managedMemberCount: number;
    failedMemberCount: number;
    pendingMemberCount: number;
  };
  trend: Array<{
    businessDate: string;
    newTopicCount: number;
    activeTopicCount: number;
    visitCustomerCount: number;
    firstVisitCount: number;
    revisitCount: number;
    aIntentCount: number;
    bIntentCount: number;
    highIntentCount: number;
    missingIntentCount: number;
  }>;
  attentionTopics: Array<{
    topicId: string;
    title: string;
    ownerUserId: string;
    ownerDisplayName: string;
    ownerEmail: string | null;
    visitType: 'first' | 'revisit' | 'unknown';
    previousVisitAt: string | null;
    latestVisitAt: string | null;
    lastActiveAt: string | null;
    visibleMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    latestIntentBand: 'A' | 'B' | 'C' | 'D' | null;
    latestIntentGrade: string | null;
  }>;
  attentionMembers: Array<{
    userId: string;
    displayName: string;
    email: string | null;
    activeTopicCount: number;
    visitCustomerCount: number;
    revisitCount: number;
    lastActiveAt: string | null;
  }>;
  latestReport: null | {
    reportId: string;
    businessDate: string;
    revision: number;
    generatedAt: string;
    visitedCustomerCount: number;
    activeTopicCount: number;
    totalMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    modelProvider: string;
    modelName: string;
  };
  runningJob: null | {
    jobId: string;
    businessDate: string;
    triggerSource: 'scheduled' | 'manual' | 'retry';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    windowStartAt: string;
    windowEndAt: string;
    modelProvider: string;
    modelName: string;
    reportId: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

function toIsoTimestamp(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return value == null ? null : String(value);
}

function parseIntentSignal(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const gradePatterns = [
    /"intentGrade"\s*:\s*"([ABCD][+-]?)/i,
    /(?:意向(?:等级|级别|分级)?|客户(?:等级|分级)?|等级|级别)\s*[:：]?\s*([ABCD][+-]?)/i,
    /\b([ABCD][+-]?)\s*(?:类|级|档|意向)\b/i,
  ];

  for (const pattern of gradePatterns) {
    const grade = trimmed.match(pattern)?.[1]?.toUpperCase();
    if (grade && ['A', 'B', 'C', 'D'].includes(grade[0]!)) {
      return { band: grade[0] as 'A' | 'B' | 'C' | 'D', grade };
    }
  }

  const bandPatterns = [
    /"intentBand"\s*:\s*"([ABCD])"/i,
    /(?:意向(?:等级|级别|分级)?|客户(?:等级|分级)?|等级|级别)\s*[:：]?\s*([ABCD])(?![A-Z])/i,
    /\b([ABCD])\s*(?:类|级|档|意向)\b/i,
  ];

  for (const pattern of bandPatterns) {
    const band = trimmed.match(pattern)?.[1]?.toUpperCase();
    if (band && ['A', 'B', 'C', 'D'].includes(band)) {
      return { band: band as 'A' | 'B' | 'C' | 'D', grade: band };
    }
  }

  return null;
}

async function getFactSettings(projectId: string) {
  const result = await query<FactSettingsRow>(
    `
    select timezone, business_day_close_time_local::text as business_day_close_time_local
    from lobehub_admin.project_daily_report_settings
    where project_id = $1
    limit 1
    `,
    [projectId],
  );

  return {
    timezone: result.rows[0]?.timezone?.trim() || DEFAULT_TIMEZONE,
    closeTimeLocal: normalizeTimeString(result.rows[0]?.business_day_close_time_local || DEFAULT_CLOSE_TIME),
  };
}

export async function resolveProjectFactWindow(projectId: string, businessDate: string) {
  const settings = await getFactSettings(projectId);
  const startAt = zonedLocalDateTimeToUtc(businessDate, '00:00:00', settings.timezone);
  const endAt = zonedLocalDateTimeToUtc(businessDate, settings.closeTimeLocal, settings.timezone);

  return {
    businessDate,
    timeZone: settings.timezone,
    closeTimeLocal: settings.closeTimeLocal,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    isPartial: false,
  } satisfies ProjectFactWindow;
}

export async function resolveCurrentProjectFactWindow(projectId: string, now = new Date()) {
  const settings = await getFactSettings(projectId);
  const businessDate = getLocalDateString(now, settings.timezone);
  const startAt = zonedLocalDateTimeToUtc(businessDate, '00:00:00', settings.timezone);
  const closeAt = zonedLocalDateTimeToUtc(businessDate, settings.closeTimeLocal, settings.timezone);
  const endAt = now.getTime() < closeAt.getTime() ? now : closeAt;

  return {
    businessDate,
    timeZone: settings.timezone,
    closeTimeLocal: settings.closeTimeLocal,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    isPartial: endAt.getTime() < closeAt.getTime(),
  } satisfies ProjectFactWindow;
}

async function fetchRelevantTopics(projectId: string, window: ProjectFactWindow) {
  return query<RelevantTopicRow>(
    `
    select
      t.id as topic_id,
      pm.user_id as owner_user_id,
      pma.managed_session_id,
      coalesce(nullif(btrim(t.title), ''), 'Untitled topic') as topic_title,
      t.created_at as topic_created_at,
      t.updated_at as topic_updated_at
    from lobehub_admin.project_members pm
    join lobehub_admin.project_managed_agents pma
      on pma.project_id = pm.project_id
     and pma.user_id = pm.user_id
     and pma.managed_session_id is not null
    join public.topics t
      on t.user_id = pm.user_id
     and t.session_id = pma.managed_session_id
    where pm.project_id = $1
      and pm.role = 'member'
      and t.created_at < $3::timestamptz
      and (
        t.created_at >= $2::timestamptz
        or exists (
          select 1
          from public.messages m
          where m.topic_id = t.id
            and m.created_at >= $2::timestamptz
            and m.created_at < $3::timestamptz
            and m.role <> 'tool'
            and length(trim(${EFFECTIVE_CONTENT_SQL})) > 0
        )
      )
    order by pm.user_id asc, t.created_at asc, t.id asc
    `,
    [projectId, window.startAt, window.endAt],
  );
}

async function fetchWindowMessages(topicIds: string[], window: ProjectFactWindow) {
  if (topicIds.length === 0) {
    return { rows: [] as TopicMessageRow[] };
  }

  return query<TopicMessageRow>(
    `
    select
      m.topic_id,
      m.id as message_id,
      m.role,
      ${EFFECTIVE_CONTENT_SQL} as content,
      m.created_at
    from public.messages m
    where m.topic_id = any($1::text[])
      and m.created_at >= $2::timestamptz
      and m.created_at < $3::timestamptz
      and m.role <> 'tool'
      and length(trim(${EFFECTIVE_CONTENT_SQL})) > 0
    order by m.topic_id asc, m.created_at asc, m.id asc
    `,
    [topicIds, window.startAt, window.endAt],
  );
}

async function fetchUserHistory(topicIds: string[], window: ProjectFactWindow) {
  if (topicIds.length === 0) {
    return { rows: [] as TopicUserHistoryRow[] };
  }

  return query<TopicUserHistoryRow>(
    `
    select
      m.topic_id,
      min(m.created_at) as first_user_message_at,
      max(m.created_at) filter (where m.created_at < $2::timestamptz) as previous_user_message_at,
      max(m.created_at) filter (
        where m.created_at >= $2::timestamptz
          and m.created_at < $3::timestamptz
      ) as last_user_message_at
    from public.messages m
    where m.topic_id = any($1::text[])
      and m.created_at < $3::timestamptz
      and m.role = 'user'
      and length(trim(${EFFECTIVE_CONTENT_SQL})) > 0
    group by m.topic_id
    `,
    [topicIds, window.startAt, window.endAt],
  );
}

function buildFactRows(projectId: string, window: ProjectFactWindow, topics: RelevantTopicRow[], messages: TopicMessageRow[], historyRows: TopicUserHistoryRow[]) {
  const messagesByTopic = new Map<string, TopicMessageRow[]>();
  const historyByTopic = new Map<string, TopicUserHistoryRow>();

  for (const row of messages) {
    const current = messagesByTopic.get(row.topic_id) ?? [];
    current.push(row);
    messagesByTopic.set(row.topic_id, current);
  }

  for (const row of historyRows) {
    historyByTopic.set(row.topic_id, row);
  }

  return topics.map((topic) => {
    const topicMessages = messagesByTopic.get(topic.topic_id) ?? [];
    const history = historyByTopic.get(topic.topic_id);
    const userMessages = topicMessages.filter((item) => item.role === 'user');
    const assistantMessages = topicMessages.filter((item) => item.role === 'assistant');
    const topicCreatedAt = toIsoTimestamp(topic.topic_created_at);
    const topicUpdatedAt = toIsoTimestamp(topic.topic_updated_at);

    let latestIntentBand: FactRow['latest_intent_band'] = null;
    let latestIntentGrade: string | null = null;
    let latestIntentAt: string | null = null;

    for (let index = topicMessages.length - 1; index >= 0; index -= 1) {
      const signal = parseIntentSignal(topicMessages[index]!.content);
      if (signal) {
        latestIntentBand = signal.band;
        latestIntentGrade = signal.grade;
        latestIntentAt = topicMessages[index]!.created_at;
        break;
      }
    }

    const firstUserMessageAt = history?.first_user_message_at ? toIsoTimestamp(history.first_user_message_at) : null;
    const previousUserMessageAt = history?.previous_user_message_at ? toIsoTimestamp(history.previous_user_message_at) : null;
    const lastUserMessageAt = history?.last_user_message_at ? toIsoTimestamp(history.last_user_message_at) : null;
    const lastVisibleMessageAt = topicMessages.length > 0 ? toIsoTimestamp(topicMessages.at(-1)?.created_at) : null;
    const hasVisit = userMessages.length > 0;

    return {
      project_id: projectId,
      business_date: window.businessDate,
      topic_id: topic.topic_id,
      owner_user_id: topic.owner_user_id,
      managed_session_id: topic.managed_session_id,
      topic_created_at: topicCreatedAt!,
      topic_updated_at: topicUpdatedAt!,
      first_user_message_at: firstUserMessageAt,
      previous_user_message_at: previousUserMessageAt,
      last_user_message_at: lastUserMessageAt,
      last_visible_message_at: lastVisibleMessageAt,
      is_new_topic: Boolean(topicCreatedAt && topicCreatedAt >= window.startAt && topicCreatedAt < window.endAt),
      is_active_topic: topicMessages.length > 0,
      has_visit: hasVisit,
      is_first_visit: Boolean(hasVisit && firstUserMessageAt && firstUserMessageAt >= window.startAt && firstUserMessageAt < window.endAt),
      is_revisit: Boolean(hasVisit && firstUserMessageAt && firstUserMessageAt < window.startAt),
      visible_message_count: topicMessages.length,
      user_message_count: userMessages.length,
      assistant_message_count: assistantMessages.length,
      latest_intent_band: latestIntentBand,
      latest_intent_grade: latestIntentGrade,
      latest_intent_at: latestIntentAt,
    } satisfies FactRow;
  });
}

async function replaceDailyFacts(projectId: string, businessDate: string, rows: FactRow[]) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `
      delete from lobehub_admin.project_topic_daily_facts
      where project_id = $1
        and business_date = $2::date
      `,
      [projectId, businessDate],
    );

    if (rows.length > 0) {
      const columns = [
        'project_id',
        'business_date',
        'topic_id',
        'owner_user_id',
        'managed_session_id',
        'topic_created_at',
        'topic_updated_at',
        'first_user_message_at',
        'previous_user_message_at',
        'last_user_message_at',
        'last_visible_message_at',
        'is_new_topic',
        'is_active_topic',
        'has_visit',
        'is_first_visit',
        'is_revisit',
        'visible_message_count',
        'user_message_count',
        'assistant_message_count',
        'latest_intent_band',
        'latest_intent_grade',
        'latest_intent_at',
      ] as const;

      const values: unknown[] = [];
      const valueSql = rows.map((row, rowIndex) => {
        const rowValues = [
          row.project_id,
          row.business_date,
          row.topic_id,
          row.owner_user_id,
          row.managed_session_id,
          row.topic_created_at,
          row.topic_updated_at,
          row.first_user_message_at,
          row.previous_user_message_at,
          row.last_user_message_at,
          row.last_visible_message_at,
          row.is_new_topic,
          row.is_active_topic,
          row.has_visit,
          row.is_first_visit,
          row.is_revisit,
          row.visible_message_count,
          row.user_message_count,
          row.assistant_message_count,
          row.latest_intent_band,
          row.latest_intent_grade,
          row.latest_intent_at,
        ];
        values.push(...rowValues);
        const offset = rowIndex * columns.length;
        return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
      }).join(',\n');

      await client.query(
        `
        insert into lobehub_admin.project_topic_daily_facts (${columns.join(', ')})
        values ${valueSql}
        `,
        values,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rebuildProjectTopicDailyFacts(projectId: string, window: ProjectFactWindow) {
  const topicsResult = await fetchRelevantTopics(projectId, window);
  const topicIds = topicsResult.rows.map((row) => row.topic_id);
  const [messagesResult, historyResult] = await Promise.all([
    fetchWindowMessages(topicIds, window),
    fetchUserHistory(topicIds, window),
  ]);
  const rows = buildFactRows(projectId, window, topicsResult.rows, messagesResult.rows, historyResult.rows);
  await replaceDailyFacts(projectId, window.businessDate, rows);
  return rows.length;
}

async function shouldRefreshFacts(projectId: string, businessDate: string, now = new Date()) {
  const result = await query<{ updated_at: string | null }>(
    `
    select max(updated_at) as updated_at
    from lobehub_admin.project_topic_daily_facts
    where project_id = $1
      and business_date = $2::date
    `,
    [projectId, businessDate],
  );
  const updatedAt = result.rows[0]?.updated_at;
  if (!updatedAt) return true;
  return now.getTime() - new Date(updatedAt).getTime() > FACT_REFRESH_THRESHOLD_MS;
}

export async function ensureCurrentProjectTopicDailyFacts(projectId: string, now = new Date()) {
  const window = await resolveCurrentProjectFactWindow(projectId, now);
  if (await shouldRefreshFacts(projectId, window.businessDate, now)) {
    await rebuildProjectTopicDailyFacts(projectId, window);
  }
  return window;
}

async function ensureProjectTopicDailyFacts(projectId: string, businessDate: string | undefined, now = new Date()) {
  if (!businessDate) {
    return ensureCurrentProjectTopicDailyFacts(projectId, now);
  }

  const settings = await getFactSettings(projectId);
  const currentBusinessDate = getLocalDateString(now, settings.timezone);

  if (businessDate === currentBusinessDate) {
    return ensureCurrentProjectTopicDailyFacts(projectId, now);
  }

  const window = await resolveProjectFactWindow(projectId, businessDate);
  const existingFacts = await query<{ row_count: number }>(
    `
    select count(*)::int as row_count
    from lobehub_admin.project_topic_daily_facts
    where project_id = $1
      and business_date = $2::date
    `,
    [projectId, businessDate],
  );

  if ((existingFacts.rows[0]?.row_count ?? 0) === 0) {
    await rebuildProjectTopicDailyFacts(projectId, window);
  }

  return window;
}

async function fetchProjectInfo(projectId: string) {
  const result = await query<ProjectInfoRow>(
    `
    select id, name, description
    from lobehub_admin.projects
    where id = $1
    limit 1
    `,
    [projectId],
  );
  return result.rows[0] ?? null;
}

export async function getProjectOverview(projectId: string, businessDate?: string, now = new Date()) {
  const project = await fetchProjectInfo(projectId);
  if (!project) return null;

  const window = await ensureProjectTopicDailyFacts(projectId, businessDate, now);

  const statsResult = await query<{
      new_topic_count: number;
      active_topic_count: number;
      visit_customer_count: number;
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
      last_active_at: string | null;
    }>(
      `
      select
        count(*) filter (where is_new_topic)::int as new_topic_count,
        count(*) filter (where is_active_topic)::int as active_topic_count,
        count(*) filter (where has_visit)::int as visit_customer_count,
        count(*) filter (where is_first_visit)::int as first_visit_count,
        count(*) filter (where is_revisit)::int as revisit_count,
        count(distinct owner_user_id) filter (where is_active_topic)::int as active_member_count,
        coalesce(sum(visible_message_count), 0)::int as visible_message_count,
        coalesce(sum(user_message_count), 0)::int as user_message_count,
        coalesce(sum(assistant_message_count), 0)::int as assistant_message_count,
        count(*) filter (where latest_intent_band = 'A')::int as a_intent_count,
        count(*) filter (where latest_intent_band = 'B')::int as b_intent_count,
        count(*) filter (where latest_intent_band = 'C')::int as c_intent_count,
        count(*) filter (where latest_intent_band = 'D')::int as d_intent_count,
        count(*) filter (where has_visit and latest_intent_band is null)::int as missing_intent_count,
        max(last_visible_message_at) as last_active_at
      from lobehub_admin.project_topic_daily_facts
      where project_id = $1
        and business_date = $2::date
      `,
      [projectId, window.businessDate],
    );
  const membersResult = await query<{
      total_members: number;
      admin_count: number;
      member_count: number;
      managed_member_count: number;
      failed_member_count: number;
      pending_member_count: number;
    }>(
      `
      select
        count(*)::int as total_members,
        count(*) filter (where pm.role = 'admin')::int as admin_count,
        count(*) filter (where pm.role = 'member')::int as member_count,
        count(*) filter (where pm.role = 'member' and pma.last_status = 'provisioned')::int as managed_member_count,
        count(*) filter (where pm.role = 'member' and pma.last_status = 'failed')::int as failed_member_count,
        count(*) filter (where pm.role = 'member' and (pma.user_id is null or pma.last_status = 'skipped'))::int as pending_member_count
      from lobehub_admin.project_members pm
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pm.project_id
       and pma.user_id = pm.user_id
      where pm.project_id = $1
      `,
      [projectId],
    );
  const trendResult = await query<{
      business_date: string;
      new_topic_count: number;
      active_topic_count: number;
      visit_customer_count: number;
      first_visit_count: number;
      revisit_count: number;
      a_intent_count: number;
      b_intent_count: number;
      missing_intent_count: number;
    }>(
      `
      select
        business_date::text as business_date,
        new_topic_count,
        active_topic_count,
        visit_customer_count,
        first_visit_count,
        revisit_count,
        a_intent_count,
        b_intent_count,
        missing_intent_count
      from lobehub_admin.project_daily_overview_view
      where project_id = $1
        and business_date >= $2::date
        and business_date <= $3::date
      order by business_date desc
      `,
      [projectId, addDays(window.businessDate, -6), window.businessDate],
    );
  const topicsResult = await query<{
      topic_id: string;
      title: string;
      owner_user_id: string;
      owner_display_name: string;
      owner_email: string | null;
      previous_user_message_at: string | null;
      last_user_message_at: string | null;
      last_visible_message_at: string | null;
      is_first_visit: boolean;
      is_revisit: boolean;
      visible_message_count: number;
      user_message_count: number;
      assistant_message_count: number;
      latest_intent_band: 'A' | 'B' | 'C' | 'D' | null;
      latest_intent_grade: string | null;
    }>(
      `
      select
        f.topic_id,
        coalesce(nullif(btrim(t.title), ''), 'Untitled topic') as title,
        f.owner_user_id,
        lobehub_admin.user_display_name(f.owner_user_id) as owner_display_name,
        u.email as owner_email,
        f.previous_user_message_at,
        f.last_user_message_at,
        f.last_visible_message_at,
        f.is_first_visit,
        f.is_revisit,
        f.visible_message_count,
        f.user_message_count,
        f.assistant_message_count,
        f.latest_intent_band,
        f.latest_intent_grade
      from lobehub_admin.project_topic_daily_facts f
      join public.topics t on t.id = f.topic_id
      join public.users u on u.id = f.owner_user_id
      where f.project_id = $1
        and f.business_date = $2::date
        and (f.is_new_topic or f.is_active_topic or f.has_visit)
      order by
        case
          when f.latest_intent_band = 'A' then 0
          when f.latest_intent_band = 'B' then 1
          when f.latest_intent_band is null then 2
          when f.latest_intent_band = 'C' then 3
          when f.latest_intent_band = 'D' then 4
          else 5
        end asc,
        f.is_revisit desc,
        f.has_visit desc,
        f.user_message_count desc,
        f.last_visible_message_at desc nulls last
      limit 6
      `,
      [projectId, window.businessDate],
    );
  const attentionMembersResult = await query<{
      user_id: string;
      display_name: string;
      email: string | null;
      active_topic_count: number;
      visit_customer_count: number;
      revisit_count: number;
      last_active_at: string | null;
    }>(
      `
      select
        f.owner_user_id as user_id,
        lobehub_admin.user_display_name(f.owner_user_id) as display_name,
        u.email,
        count(*) filter (where f.is_active_topic)::int as active_topic_count,
        count(*) filter (where f.has_visit)::int as visit_customer_count,
        count(*) filter (where f.is_revisit)::int as revisit_count,
        max(f.last_visible_message_at) as last_active_at
      from lobehub_admin.project_topic_daily_facts f
      join public.users u on u.id = f.owner_user_id
      where f.project_id = $1
        and f.business_date = $2::date
      group by f.owner_user_id, u.email
      order by
        count(*) filter (where f.is_revisit) desc,
        count(*) filter (where f.has_visit) desc,
        count(*) filter (where f.is_active_topic) desc,
        max(f.last_visible_message_at) desc nulls last
      limit 5
      `,
      [projectId, window.businessDate],
    );
  const latestReportResult = await query<{
      id: string;
      business_date: string;
      revision: number;
      created_at: string;
      visited_customer_count: number;
      active_topic_count: number;
      total_message_count: number;
      user_message_count: number;
      assistant_message_count: number;
      model_provider: string;
      model_name: string;
    }>(
      `
      select
        id,
        business_date::text as business_date,
        revision,
        created_at,
        visited_customer_count,
        active_topic_count,
        total_message_count,
        user_message_count,
        assistant_message_count,
        model_provider,
        model_name
      from lobehub_admin.project_daily_reports
      where project_id = $1
        and is_current = true
      order by business_date desc, created_at desc
      limit 1
      `,
      [projectId],
    );
  const runningJobResult = await query<{
      id: string;
      business_date: string;
      trigger_source: 'scheduled' | 'manual' | 'retry';
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      window_start_at: string;
      window_end_at: string;
      model_provider: string;
      model_name: string;
      report_id: string | null;
      error_message: string | null;
      started_at: string | null;
      finished_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      select
        id,
        business_date::text as business_date,
        trigger_source,
        status,
        window_start_at,
        window_end_at,
        model_provider,
        model_name,
        report_id,
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
      [projectId],
    );

  const stats = statsResult.rows[0] ?? {
    new_topic_count: 0,
    active_topic_count: 0,
    visit_customer_count: 0,
    first_visit_count: 0,
    revisit_count: 0,
    active_member_count: 0,
    visible_message_count: 0,
    user_message_count: 0,
    assistant_message_count: 0,
    a_intent_count: 0,
    b_intent_count: 0,
    c_intent_count: 0,
    d_intent_count: 0,
    missing_intent_count: 0,
    last_active_at: null,
  };
  const members = membersResult.rows[0] ?? {
    total_members: 0,
    admin_count: 0,
    member_count: 0,
    managed_member_count: 0,
    failed_member_count: 0,
    pending_member_count: 0,
  };
  const latestReport = latestReportResult.rows[0] ?? null;
  const runningJob = runningJobResult.rows[0] ?? null;

  return {
    project: {
      projectId: project.id,
      projectName: project.name,
      description: project.description,
      timezone: window.timeZone,
      closeTimeLocal: window.closeTimeLocal,
      businessDate: window.businessDate,
      windowStartAt: window.startAt,
      windowEndAt: window.endAt,
      isPartial: window.isPartial,
    },
    stats: {
      newTopicCount: stats.new_topic_count,
      activeTopicCount: stats.active_topic_count,
      visitCustomerCount: stats.visit_customer_count,
      firstVisitCount: stats.first_visit_count,
      revisitCount: stats.revisit_count,
      activeMemberCount: stats.active_member_count,
      visibleMessageCount: stats.visible_message_count,
      userMessageCount: stats.user_message_count,
      assistantMessageCount: stats.assistant_message_count,
      aIntentCount: stats.a_intent_count,
      bIntentCount: stats.b_intent_count,
      cIntentCount: stats.c_intent_count,
      dIntentCount: stats.d_intent_count,
      highIntentCount: stats.a_intent_count + stats.b_intent_count,
      missingIntentCount: stats.missing_intent_count,
      lastActiveAt: toIsoTimestamp(stats.last_active_at),
    },
    members: {
      totalMembers: members.total_members,
      adminCount: members.admin_count,
      memberCount: members.member_count,
      managedMemberCount: members.managed_member_count,
      failedMemberCount: members.failed_member_count,
      pendingMemberCount: members.pending_member_count,
    },
    trend: trendResult.rows.map((row) => ({
      businessDate: row.business_date,
      newTopicCount: row.new_topic_count,
      activeTopicCount: row.active_topic_count,
      visitCustomerCount: row.visit_customer_count,
      firstVisitCount: row.first_visit_count,
      revisitCount: row.revisit_count,
      aIntentCount: row.a_intent_count,
      bIntentCount: row.b_intent_count,
      highIntentCount: row.a_intent_count + row.b_intent_count,
      missingIntentCount: row.missing_intent_count,
    })),
    attentionTopics: topicsResult.rows.map((row) => ({
      topicId: row.topic_id,
      title: row.title,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: row.owner_display_name,
      ownerEmail: row.owner_email,
      visitType: row.is_first_visit ? 'first' : row.is_revisit ? 'revisit' : 'unknown',
      previousVisitAt: toIsoTimestamp(row.previous_user_message_at),
      latestVisitAt: toIsoTimestamp(row.last_user_message_at),
      lastActiveAt: toIsoTimestamp(row.last_visible_message_at),
      visibleMessageCount: row.visible_message_count,
      userMessageCount: row.user_message_count,
      assistantMessageCount: row.assistant_message_count,
      latestIntentBand: row.latest_intent_band,
      latestIntentGrade: row.latest_intent_grade,
    })),
    attentionMembers: attentionMembersResult.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      activeTopicCount: row.active_topic_count,
      visitCustomerCount: row.visit_customer_count,
      revisitCount: row.revisit_count,
      lastActiveAt: toIsoTimestamp(row.last_active_at),
    })),
    latestReport: latestReport ? {
      reportId: latestReport.id,
      businessDate: latestReport.business_date,
      revision: latestReport.revision,
      generatedAt: latestReport.created_at,
      visitedCustomerCount: latestReport.visited_customer_count,
      activeTopicCount: latestReport.active_topic_count,
      totalMessageCount: latestReport.total_message_count,
      userMessageCount: latestReport.user_message_count,
      assistantMessageCount: latestReport.assistant_message_count,
      modelProvider: latestReport.model_provider,
      modelName: latestReport.model_name,
    } : null,
    runningJob: runningJob ? {
      jobId: runningJob.id,
      businessDate: runningJob.business_date,
      triggerSource: runningJob.trigger_source,
      status: runningJob.status,
      windowStartAt: runningJob.window_start_at,
      windowEndAt: runningJob.window_end_at,
      modelProvider: runningJob.model_provider,
      modelName: runningJob.model_name,
      reportId: runningJob.report_id,
      errorMessage: runningJob.error_message,
      startedAt: runningJob.started_at,
      finishedAt: runningJob.finished_at,
      createdAt: runningJob.created_at,
      updatedAt: runningJob.updated_at,
    } : null,
  } satisfies ProjectOverview;
}
