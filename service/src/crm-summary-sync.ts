import type { PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { ZodError, z } from 'zod';

import { env } from './config.js';
import { db, query } from './db.js';

const CRM_SUMMARY_STORAGE_SCHEMA = 'crm_customer_summary.v2';
const SUPPORTED_CRM_SUMMARY_SCHEMAS = ['crm_customer_summary.v1', CRM_SUMMARY_STORAGE_SCHEMA] as const;
const SYNC_WORKER_KEY = 'default';
const STATUS_PENDING = '\u5b58\u6863\u72b6\u6001\uff1a\u672a\u4fdd\u5b58';
const STATUS_SAVED = '\u5b58\u6863\u72b6\u6001\uff1a\u5df2\u4fdd\u5b58';
const STATUS_FAILED = '\u5b58\u6863\u72b6\u6001\uff1a\u4fdd\u5b58\u5931\u8d25';
const STATUS_PATTERN = /^\u5b58\u6863\u72b6\u6001\uff1a\u672a\u4fdd\u5b58$/m;
const SCAN_STALL_TIMEOUT_MS = 60_000;
const NULLISH_TEXT_TOKENS = new Set(['null', 'NULL', '未知', '未提及', '待确认', '暂无', '无']);
const LEGACY_INTENT_GRADE_MAP = new Map([
  ['高意向', 'B'],
  ['中意向', 'C'],
  ['中低意向', 'C'],
  ['低意向', 'D'],
]);

const crmSummaryPayloadSchema = z.object({
  schema: z.string(),
  persist: z.boolean(),
  customerName: z.unknown().optional(),
  gender: z.unknown().optional(),
  age: z.unknown().optional(),
  familyStructure: z.unknown().optional(),
  residenceArea: z.unknown().optional(),
  contactInfo: z.unknown().optional(),
  desiredLayout: z.unknown().optional(),
  targetUnitPrice: z.unknown().optional(),
  targetTotalPrice: z.unknown().optional(),
  firstVisitTime: z.unknown().optional(),
  intentGrade: z.unknown().optional(),
  currentStage: z.unknown().optional(),
  summary: z.unknown(),
});

type SyncStateRow = {
  cursor_message_id: string;
  cursor_updated_at: string | null;
  worker_key: string;
};

type SyncCandidateRow = {
  content: string | null;
  message_id: string;
  owner_user_id: string;
  project_id: string;
  project_name: string;
  salesperson: string | null;
  topic_id: string;
  updated_at: string;
};

type ParsedCrmSummaryPayload = {
  age: string | null;
  contactInfo: string | null;
  currentStage: string | null;
  customerName: string | null;
  desiredLayout: string | null;
  familyStructure: string | null;
  firstVisitTime: string | null;
  gender: string | null;
  intentGrade: string | null;
  residenceArea: string | null;
  schema: typeof CRM_SUMMARY_STORAGE_SCHEMA;
  summary: string;
  targetTotalPrice: string | null;
  targetUnitPrice: string | null;
};

let schedulerHandle: NodeJS.Timeout | null = null;
let scanInProgress = false;
let currentScanStartedAt = 0;

function normalizeOptionalText(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed || NULLISH_TEXT_TOKENS.has(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeIntentGrade(value: unknown) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const matched = trimmed.toUpperCase().match(/^([ABCD])(?:[+-])?$/);

  if (matched?.[1]) {
    return matched[1];
  }

  return LEGACY_INTENT_GRADE_MAP.get(trimmed) ?? null;
}

function normalizeGender(value: unknown) {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return null;
  }

  const lowered = normalized.toLowerCase();

  if (
    normalized.includes('先生')
    || normalized.includes('男士')
    || normalized.includes('男性')
    || lowered === 'male'
    || lowered === 'man'
    || normalized === '男'
  ) {
    return '男';
  }

  if (
    normalized.includes('女士')
    || normalized.includes('小姐')
    || normalized.includes('太太')
    || normalized.includes('夫人')
    || normalized.includes('女性')
    || lowered === 'female'
    || lowered === 'woman'
    || normalized === '女'
  ) {
    return '女';
  }

  return normalized;
}

function inferGenderFromCustomerName(customerName: string | null) {
  if (!customerName) {
    return null;
  }

  if (customerName.includes('先生') || customerName.includes('男士')) {
    return '男';
  }

  if (
    customerName.includes('女士')
    || customerName.includes('小姐')
    || customerName.includes('太太')
    || customerName.includes('夫人')
  ) {
    return '女';
  }

  return null;
}

function hasPendingCrmSummary(content: string | null) {
  if (!content) return false;

  return content.includes('```crm-summary') && content.includes(STATUS_PENDING);
}

function replacePendingStorageStatus(content: string, nextStatus: typeof STATUS_SAVED | typeof STATUS_FAILED) {
  return content.replace(STATUS_PATTERN, nextStatus);
}

function buildCustomerCode(topicId: string) {
  return `topic:${topicId}`;
}

function buildAccessCode(topicId: string) {
  return `crm:${topicId}`;
}

function extractLastCrmSummaryBlock(content: string) {
  const pattern = /```crm-summary\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  let lastBlock: string | null = null;

  do {
    match = pattern.exec(content);

    if (match?.[1]) {
      lastBlock = match[1].trim();
    }
  } while (match);

  return lastBlock;
}

class CrmSummaryParseError extends Error {}

function parseCrmSummaryPayload(content: string): ParsedCrmSummaryPayload {
  const block = extractLastCrmSummaryBlock(content);

  if (!block) {
    throw new CrmSummaryParseError('crm-summary code block is missing');
  }

  let raw: unknown;

  try {
    raw = JSON.parse(block);
  } catch {
    throw new CrmSummaryParseError('crm-summary JSON is invalid');
  }

  let parsed: z.infer<typeof crmSummaryPayloadSchema>;

  try {
    parsed = crmSummaryPayloadSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new CrmSummaryParseError(`crm-summary shape is invalid: ${error.issues.map((issue) => issue.message).join('; ')}`);
    }

    throw error;
  }

  if (!SUPPORTED_CRM_SUMMARY_SCHEMAS.includes(parsed.schema as (typeof SUPPORTED_CRM_SUMMARY_SCHEMAS)[number])) {
    throw new CrmSummaryParseError(`unsupported crm-summary schema: ${parsed.schema}`);
  }

  if (parsed.persist !== true) {
    throw new CrmSummaryParseError('crm-summary persist must be true');
  }

  const summary = normalizeOptionalText(parsed.summary);

  if (!summary) {
    throw new CrmSummaryParseError('crm-summary summary is required');
  }

  const intentGradeRaw = normalizeOptionalText(parsed.intentGrade);
  const intentGrade = normalizeIntentGrade(intentGradeRaw);
  const customerName = normalizeOptionalText(parsed.customerName);
  const gender = normalizeGender(parsed.gender) ?? inferGenderFromCustomerName(customerName);

  if (intentGradeRaw && !intentGrade) {
    throw new CrmSummaryParseError('crm-summary intentGrade must be A/B/C/D or null');
  }

  return {
    schema: CRM_SUMMARY_STORAGE_SCHEMA,
    customerName,
    gender,
    age: normalizeOptionalText(parsed.age),
    familyStructure: normalizeOptionalText(parsed.familyStructure),
    residenceArea: normalizeOptionalText(parsed.residenceArea),
    contactInfo: normalizeOptionalText(parsed.contactInfo),
    desiredLayout: normalizeOptionalText(parsed.desiredLayout),
    targetUnitPrice: normalizeOptionalText(parsed.targetUnitPrice),
    targetTotalPrice: normalizeOptionalText(parsed.targetTotalPrice),
    firstVisitTime: normalizeOptionalText(parsed.firstVisitTime),
    intentGrade,
    currentStage: normalizeOptionalText(parsed.currentStage),
    summary,
  };
}

async function ensureSyncState() {
  await query(
    `
    insert into lobehub_admin.crm_summary_sync_state (
      worker_key,
      cursor_updated_at,
      cursor_message_id
    )
    values (
      $1,
      now() - make_interval(mins => $2::int),
      ''
    )
    on conflict (worker_key) do nothing
    `,
    [SYNC_WORKER_KEY, env.CRM_SUMMARY_SYNC_INITIAL_LOOKBACK_MINUTES],
  );

  const result = await query<SyncStateRow>(
    `
    select
      worker_key,
      cursor_updated_at::text as cursor_updated_at,
      cursor_message_id
    from lobehub_admin.crm_summary_sync_state
    where worker_key = $1
    limit 1
    `,
    [SYNC_WORKER_KEY],
  );

  const state = result.rows[0];

  if (!state) {
    throw new Error('Failed to initialize CRM summary sync state');
  }

  return state;
}

async function updateSyncCursor(updatedAt: string, messageId: string) {
  await query(
    `
    update lobehub_admin.crm_summary_sync_state
    set
      cursor_updated_at = $2::timestamptz,
      cursor_message_id = $3
    where worker_key = $1
    `,
    [SYNC_WORKER_KEY, updatedAt, messageId],
  );
}

async function listSyncCandidates(cursorUpdatedAt: string, cursorMessageId: string, quietBefore: Date) {
  return query<SyncCandidateRow>(
    `
    select
      m.id as message_id,
      m.topic_id,
      m.content,
      m.updated_at::text as updated_at,
      pm.user_id as owner_user_id,
      p.id as project_id,
      p.name as project_name,
      lobehub_admin.user_display_name(pm.user_id) as salesperson
    from public.messages m
    join public.topics t
      on t.id = m.topic_id
    join lobehub_admin.project_members pm
      on pm.user_id = t.user_id
     and pm.role in ('member', 'admin')
    join lobehub_admin.project_managed_agents pma
      on pma.project_id = pm.project_id
     and pma.user_id = pm.user_id
     and pma.managed_session_id = t.session_id
    join lobehub_admin.projects p
      on p.id = pm.project_id
    where m.role = 'assistant'
      and (
        m.updated_at > $1::timestamptz
        or (m.updated_at = $1::timestamptz and m.id > $2)
      )
      and m.updated_at <= $3::timestamptz
    order by m.updated_at asc, m.id asc
    limit $4
    `,
    [cursorUpdatedAt, cursorMessageId, quietBefore.toISOString(), env.CRM_SUMMARY_SYNC_BATCH_SIZE],
  );
}

async function updateMessageContentStatus(
  client: PoolClient,
  messageId: string,
  expectedUpdatedAt: string,
  nextContent: string,
) {
  const result = await client.query<{ updated_at: string }>(
    `
    update public.messages
    set
      content = $2,
      updated_at = now()
    where id = $1
      and updated_at = $3::timestamptz
    returning updated_at::text as updated_at
    `,
    [messageId, nextContent, expectedUpdatedAt],
  );

  if (!result.rows[0]) {
    throw new Error(`Message changed while syncing: ${messageId}`);
  }

  return result.rows[0].updated_at;
}

async function markMessageStatusFailed(message: SyncCandidateRow, log: Pick<FastifyBaseLogger, 'error' | 'warn'>, reason: string) {
  const content = message.content;

  if (!content || !content.includes(STATUS_PENDING)) {
    return false;
  }

  const nextContent = replacePendingStorageStatus(content, STATUS_FAILED);
  const client = await db.connect();

  try {
    await client.query('begin');
    const updatedAt = await updateMessageContentStatus(client, message.message_id, message.updated_at, nextContent);
    await client.query('commit');
    message.updated_at = updatedAt;
    message.content = nextContent;
    return true;
  } catch (error) {
    await client.query('rollback');
    log.warn({ error, messageId: message.message_id, reason }, 'Failed to mark CRM summary message as failed');
    return false;
  } finally {
    client.release();
  }
}

async function upsertCustomerProfile(
  client: PoolClient,
  message: SyncCandidateRow,
  payload: ParsedCrmSummaryPayload,
) {
  await client.query(
    `
    insert into crm.customer_profiles (
      customer_code,
      salesperson,
      customer_name,
      gender,
      age,
      family_structure,
      living_area,
      contact_info,
      desired_layout,
      target_unit_price,
      target_total_price,
      first_visit_time,
      summary,
      access_code,
      project,
      topic_id,
      intent_grade,
      current_stage,
      summary_json,
      last_summary_message_id,
      last_summary_at,
      created_at,
      updated_at
    )
    values (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16,
      $17,
      $18,
      $19::jsonb,
      $20,
      $21::timestamptz,
      now(),
      now()
    )
    on conflict (topic_id) do update
    set
      salesperson = excluded.salesperson,
      customer_name = coalesce(excluded.customer_name, crm.customer_profiles.customer_name),
      gender = coalesce(excluded.gender, crm.customer_profiles.gender),
      age = coalesce(excluded.age, crm.customer_profiles.age),
      family_structure = coalesce(excluded.family_structure, crm.customer_profiles.family_structure),
      living_area = coalesce(excluded.living_area, crm.customer_profiles.living_area),
      contact_info = coalesce(excluded.contact_info, crm.customer_profiles.contact_info),
      desired_layout = coalesce(excluded.desired_layout, crm.customer_profiles.desired_layout),
      target_unit_price = coalesce(excluded.target_unit_price, crm.customer_profiles.target_unit_price),
      target_total_price = coalesce(excluded.target_total_price, crm.customer_profiles.target_total_price),
      first_visit_time = coalesce(excluded.first_visit_time, crm.customer_profiles.first_visit_time),
      summary = excluded.summary,
      project = excluded.project,
      intent_grade = coalesce(excluded.intent_grade, crm.customer_profiles.intent_grade),
      current_stage = coalesce(excluded.current_stage, crm.customer_profiles.current_stage),
      summary_json = excluded.summary_json,
      last_summary_message_id = excluded.last_summary_message_id,
      last_summary_at = excluded.last_summary_at,
      updated_at = now()
    `,
    [
      buildCustomerCode(message.topic_id),
      normalizeOptionalText(message.salesperson) ?? message.owner_user_id,
      payload.customerName,
      payload.gender,
      payload.age,
      payload.familyStructure,
      payload.residenceArea,
      payload.contactInfo,
      payload.desiredLayout,
      payload.targetUnitPrice,
      payload.targetTotalPrice,
      payload.firstVisitTime,
      payload.summary,
      buildAccessCode(message.topic_id),
      message.project_name,
      message.topic_id,
      payload.intentGrade,
      payload.currentStage,
      JSON.stringify({
        schema: payload.schema,
        persist: true,
        customerName: payload.customerName,
        gender: payload.gender,
        age: payload.age,
        familyStructure: payload.familyStructure,
        residenceArea: payload.residenceArea,
        contactInfo: payload.contactInfo,
        desiredLayout: payload.desiredLayout,
        targetUnitPrice: payload.targetUnitPrice,
        targetTotalPrice: payload.targetTotalPrice,
        firstVisitTime: payload.firstVisitTime,
        intentGrade: payload.intentGrade,
        currentStage: payload.currentStage,
        summary: payload.summary,
      }),
      message.message_id,
      message.updated_at,
    ],
  );
}

async function syncSingleMessage(message: SyncCandidateRow, log: Pick<FastifyBaseLogger, 'error' | 'info' | 'warn'>) {
  const content = message.content;

  if (!hasPendingCrmSummary(content)) {
    return;
  }

  let payload: ParsedCrmSummaryPayload;

  try {
    payload = parseCrmSummaryPayload(content!);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown crm-summary parse error';
    const marked = await markMessageStatusFailed(message, log, reason);

    if (marked) {
      log.warn({ messageId: message.message_id, topicId: message.topic_id, reason }, 'CRM summary message marked as failed');
      return;
    }

    throw error;
  }

  const client = await db.connect();

  try {
    await client.query('begin');
    await upsertCustomerProfile(client, message, payload);
    const nextContent = replacePendingStorageStatus(content!, STATUS_SAVED);
    const updatedAt = await updateMessageContentStatus(client, message.message_id, message.updated_at, nextContent);
    await client.query('commit');
    message.updated_at = updatedAt;
    message.content = nextContent;
    log.info({ messageId: message.message_id, topicId: message.topic_id, projectId: message.project_id }, 'CRM summary synced');
  } catch (error) {
    await client.query('rollback');

    const reason = error instanceof Error ? error.message : 'Unknown CRM sync error';
    const marked = await markMessageStatusFailed(message, log, reason);

    if (marked) {
      log.error({ error, messageId: message.message_id, topicId: message.topic_id }, 'CRM summary sync failed and message marked as failed');
      return;
    }

    throw error;
  } finally {
    client.release();
  }
}

async function scanPendingCrmSummaries(log: Pick<FastifyBaseLogger, 'error' | 'info' | 'warn'>) {
  if (!env.CRM_SUMMARY_SYNC_ENABLED) {
    return;
  }

  if (scanInProgress) {
    const stallDurationMs = Date.now() - currentScanStartedAt;

    if (currentScanStartedAt > 0 && stallDurationMs >= SCAN_STALL_TIMEOUT_MS) {
      log.warn({ stallDurationMs }, 'CRM summary sync scan appears stuck; resetting scan lock');
      scanInProgress = false;
      currentScanStartedAt = 0;
    } else {
      return;
    }
  }

  scanInProgress = true;
  currentScanStartedAt = Date.now();

  try {
    const state = await ensureSyncState();
    const quietBefore = new Date(Date.now() - env.CRM_SUMMARY_SYNC_QUIET_PERIOD_MS);
    const cursorUpdatedAt = state.cursor_updated_at ?? new Date(0).toISOString();
    const cursorMessageId = state.cursor_message_id ?? '';
    const result = await listSyncCandidates(cursorUpdatedAt, cursorMessageId, quietBefore);

    for (const row of result.rows) {
      const scanUpdatedAt = row.updated_at;
      const scanMessageId = row.message_id;
      await syncSingleMessage(row, log);
      await updateSyncCursor(scanUpdatedAt, scanMessageId);
    }
  } catch (error) {
    log.error({ error }, 'CRM summary sync scan failed');
  } finally {
    scanInProgress = false;
    currentScanStartedAt = 0;
  }
}

export function startCrmSummarySyncScheduler(log: Pick<FastifyBaseLogger, 'error' | 'info' | 'warn'>) {
  if (!env.CRM_SUMMARY_SYNC_ENABLED) {
    log.info('CRM summary sync scheduler is disabled');
    return null;
  }

  if (schedulerHandle) {
    return schedulerHandle;
  }

  void scanPendingCrmSummaries(log);
  schedulerHandle = setInterval(() => {
    void scanPendingCrmSummaries(log);
  }, env.CRM_SUMMARY_SYNC_INTERVAL_MS);

  return schedulerHandle;
}

export function stopCrmSummarySyncScheduler() {
  if (!schedulerHandle) {
    return;
  }

  clearInterval(schedulerHandle);
  schedulerHandle = null;
}
