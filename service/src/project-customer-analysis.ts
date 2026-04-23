import type { PoolClient } from 'pg';
import { env } from './config.js';
import { db, query } from './db.js';
import { getVolcengineRuntimeConfig } from './volcengine-config.js';

export type CustomerAnalysisRangePreset = 'today' | 'last7days' | 'last30days' | 'custom';

type ProjectCustomerAnalysisSessionRow = {
  id: string;
  title: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
  last_message_role: 'user' | 'assistant' | null;
  last_message_preview: string | null;
};

type ProjectCustomerAnalysisMessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  range_preset: CustomerAnalysisRangePreset | null;
  date_from: string | null;
  date_to: string | null;
  start_at: string | null;
  end_at: string | null;
  model_provider: string | null;
  model_name: string | null;
  generation_meta: unknown;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectCustomerAnalysisSessionDetailRow = {
  id: string;
  project_id: string;
  title: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectCustomerAnalysisJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

type ProjectCustomerAnalysisJobRow = {
  id: string;
  project_id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  status: ProjectCustomerAnalysisJobStatus;
  range_preset: CustomerAnalysisRangePreset;
  date_from: string;
  date_to: string;
  start_at: string;
  end_at: string;
  prompt_content: string;
  prompt_preview: string;
  model_provider: string | null;
  model_name: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type ProjectInfoRow = {
  id: string;
  name: string;
  description: string | null;
};

type SourceMessageRow = {
  project_id: string;
  project_name: string;
  project_description: string | null;
  user_id: string;
  owner_display_name: string;
  owner_email: string | null;
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

type ModelConfig = {
  provider: 'volcengine' | 'fallback';
  modelName: string;
  endpoint: string | null;
  apiKey: string | null;
};

type ConcernStat = {
  label: string;
  count: number;
};

type ProjectConversationMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type ProjectConversationGroup = {
  topicId: string;
  title: string;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerEmail: string | null;
  managedSessionId: string;
  managedSessionTitle: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ProjectConversationMessage[];
};

type CustomerAnalysisRange = {
  rangePreset: CustomerAnalysisRangePreset;
  dateFrom: string;
  dateTo: string;
  startAt: string;
  endAt: string;
  label: string;
};

type CustomerAnalysisSource = {
  project: {
    projectId: string;
    projectName: string;
    description: string | null;
  };
  range: CustomerAnalysisRange;
  groups: ProjectConversationGroup[];
  metrics: {
    activeMemberCount: number;
    activeTopicCount: number;
    totalMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  };
  concernStats: ConcernStat[];
};

type PromptGroup = {
  topicId: string;
  title: string;
  ownerDisplayName: string;
  ownerEmail: string | null;
  managedSessionTitle: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  totalMessageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  initialCustomerMessage: string | null;
  recentUserMessages: string[];
  detectedConcerns: string[];
  recentMessages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }>;
};

type PromptInput = {
  payload: {
    project: CustomerAnalysisSource['project'];
    analysisRange: CustomerAnalysisSource['range'];
    summary: {
      activeMemberCount: number;
      activeTopicCount: number;
      totalMessageCount: number;
      userMessageCount: number;
      assistantMessageCount: number;
      topConcerns: ConcernStat[];
    };
    groups: PromptGroup[];
  };
  stats: {
    includedGroupCount: number;
    truncatedGroupCount: number;
    includedMessageCount: number;
    truncatedMessageCount: number;
  };
};

type SessionHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  rangePreset: CustomerAnalysisRangePreset | null;
  dateFrom: string | null;
  dateTo: string | null;
};

type AnalysisGenerationResult = {
  content: string;
  modelProvider: string;
  modelName: string;
  generationMeta: Record<string, unknown>;
};

const DEFAULT_SESSION_TITLE = '新会话';
const CUSTOMER_ANALYSIS_PROMPT_VERSION = 'customer-analysis-v1';

const concernMatchers: Array<{ label: string; pattern: RegExp }> = [
  { label: '价格预算', pattern: /报价|价格|总价|预算|优惠|折扣|贵|便宜|首付|月供/ },
  { label: '房源楼层', pattern: /房源|楼层|户型|加推|新楼栋|洋房|小高层|面积|朝向/ },
  { label: '学区配套', pattern: /学区|学校|上学|配套|商业|交通|地铁|医院/ },
  { label: '竞品对比', pattern: /竞品|对比|别家|其他项目|绿城|万科|招商/ },
  { label: '复访决策', pattern: /复访|邀约|不愿沟通|做不了主|决策人|再看看|以后再说|考虑一下/ },
  { label: '交付工程', pattern: /交付|工程|工期|现房|准现房|装修|品质/ },
  { label: '渠道拓客', pattern: /中介|渠道|经纪人|分销|拓客|带看/ },
];

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number) {
  const normalized = normalizeText(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

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

function buildRangeLabel(rangePreset: CustomerAnalysisRangePreset, dateFrom: string, dateTo: string) {
  switch (rangePreset) {
    case 'today':
      return `今日 (${dateFrom})`;
    case 'last7days':
      return `近 7 天 (${dateFrom} ~ ${dateTo})`;
    case 'last30days':
      return `近 30 天 (${dateFrom} ~ ${dateTo})`;
    case 'custom':
    default:
      return `自定义区间 (${dateFrom} ~ ${dateTo})`;
  }
}

export function resolveCustomerAnalysisRange(input: {
  rangePreset: CustomerAnalysisRangePreset;
  dateFrom?: string | null;
  dateTo?: string | null;
}, now = new Date()): CustomerAnalysisRange {
  if (input.rangePreset === 'custom') {
    const dateFrom = input.dateFrom?.trim();
    const dateTo = input.dateTo?.trim();

    if (!dateFrom || !dateTo) {
      throw withStatus('dateFrom and dateTo are required when rangePreset is custom', 400);
    }

    if (dateFrom > dateTo) {
      throw withStatus('dateFrom must be less than or equal to dateTo', 400);
    }

    return {
      rangePreset: input.rangePreset,
      dateFrom,
      dateTo,
      startAt: toShanghaiMidnightTimestamp(dateFrom),
      endAt: toShanghaiMidnightTimestamp(addDays(dateTo, 1)),
      label: buildRangeLabel(input.rangePreset, dateFrom, dateTo),
    };
  }

  const today = getShanghaiTodayDateString(now);
  let dateFrom = today;

  switch (input.rangePreset) {
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
    rangePreset: input.rangePreset,
    dateFrom,
    dateTo: today,
    startAt: toShanghaiMidnightTimestamp(dateFrom),
    endAt: toShanghaiMidnightTimestamp(addDays(today, 1)),
    label: buildRangeLabel(input.rangePreset, dateFrom, today),
  };
}

export function getProjectCustomerAnalysisSystemPrompt() {
  return [
    '你是项目管理后台里的自由盘点助手，只能基于提供的项目对话记录和当前会话历史进行分析。',
    '你的任务是帮助项目管理员盘点高意向客户、判断近期可能成交的客户、识别客户关注热点、说明原因，并给出可执行的管理动作建议。',
    '回答要求：',
    '1. 先给结论，再给证据，再给建议动作。',
    '2. 如果提到客户或对话，尽量写清楚话题标题、销售员、最近时间和判断原因。',
    '3. 如果做推断，要明确标注“推断”或“基于对话判断”。',
    '4. 如果信息不足，要直接说明缺口，不要编造。',
    '5. 用中文输出，可以使用简洁小标题和列表，不要输出 JSON。',
  ].join('\n');
}

function resolveModelConfig(): ModelConfig {
  const volcengine = getVolcengineRuntimeConfig();
  const provider = env.DAILY_REPORT_DEFAULT_MODEL_PROVIDER
    ?? (volcengine.hasUsableApiKey ? 'volcengine' : 'fallback');
  const modelName = env.DAILY_REPORT_DEFAULT_MODEL_NAME
    ?? (provider === 'volcengine' ? 'doubao-seed-2-0-lite-260215' : 'built-in-fallback');

  if (provider === 'volcengine') {
    return {
      provider,
      modelName,
      endpoint: volcengine.endpoint,
      apiKey: volcengine.apiKey,
    };
  }

  return {
    provider: 'fallback',
    modelName,
    endpoint: null,
    apiKey: null,
  };
}

function resolveResponsesUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, '');

  if (trimmed.endsWith('/api/v3')) {
    return `${trimmed}/responses`;
  }

  return `${trimmed}/api/v3/responses`;
}

function extractResponsesText(responseBody: Record<string, unknown>) {
  if (typeof responseBody.output_text === 'string' && responseBody.output_text.trim()) {
    return responseBody.output_text.trim();
  }

  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;

    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];

    for (const part of content) {
      if (typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim());
      }

      if (typeof part.content === 'string' && part.content.trim()) {
        chunks.push(part.content.trim());
      }
    }
  }

  return chunks.join('\n').trim();
}

function detectConcerns(messages: string[]) {
  const joined = messages.join('\n');
  const matched = concernMatchers
    .filter((item) => item.pattern.test(joined))
    .map((item) => item.label);

  return matched.length > 0 ? matched : ['需求待澄清'];
}

function getInitialCustomerMessage(messages: ProjectConversationMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content ?? '';
  return firstUserMessage ? truncateText(firstUserMessage, 220) : null;
}

function getRecentUserMessages(messages: ProjectConversationMessage[]) {
  return messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => truncateText(message.content, 180));
}

function buildPromptInput(source: CustomerAnalysisSource): PromptInput {
  const maxGroups = 24;
  const maxMessagesPerGroup = 6;
  const groups = source.groups
    .map((group) => {
      const firstMessageAt = group.messages[0]?.createdAt ?? group.createdAt;
      const lastMessageAt = group.messages[group.messages.length - 1]?.createdAt ?? group.updatedAt;
      const userMessages = group.messages.filter((message) => message.role === 'user');
      const assistantMessages = group.messages.filter((message) => message.role === 'assistant');
      const concernLabels = detectConcerns(
        (userMessages.length > 0 ? userMessages : group.messages).map((message) => message.content),
      );

      return {
        topicId: group.topicId,
        title: group.title,
        ownerDisplayName: group.ownerDisplayName,
        ownerEmail: group.ownerEmail,
        managedSessionTitle: group.managedSessionTitle,
        firstMessageAt,
        lastMessageAt,
        totalMessageCount: group.messages.length,
        userMessageCount: userMessages.length,
        assistantMessageCount: assistantMessages.length,
        initialCustomerMessage: getInitialCustomerMessage(group.messages),
        recentUserMessages: getRecentUserMessages(group.messages),
        detectedConcerns: concernLabels,
        recentMessages: group.messages.slice(-maxMessagesPerGroup).map((message) => ({
          id: message.id,
          role: message.role,
          content: truncateText(message.content, 200),
          createdAt: message.createdAt,
        })),
      } satisfies PromptGroup;
    })
    .sort((left, right) =>
      right.lastMessageAt.localeCompare(left.lastMessageAt)
      || right.totalMessageCount - left.totalMessageCount);

  const includedGroups = groups.slice(0, maxGroups);
  const truncatedGroups = groups.slice(maxGroups);
  const concernCountMap = new Map<string, number>();

  for (const group of groups) {
    for (const label of group.detectedConcerns) {
      concernCountMap.set(label, (concernCountMap.get(label) ?? 0) + 1);
    }
  }

  const topConcerns = [...concernCountMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, 8)
    .map(([label, count]) => ({ label, count }));
  const includedMessageCount = includedGroups.reduce((count, group) => count + group.totalMessageCount, 0);
  const truncatedMessageCount = truncatedGroups.reduce((count, group) => count + group.totalMessageCount, 0);

  return {
    payload: {
      project: source.project,
      analysisRange: source.range,
      summary: {
        activeMemberCount: source.metrics.activeMemberCount,
        activeTopicCount: source.metrics.activeTopicCount,
        totalMessageCount: source.metrics.totalMessageCount,
        userMessageCount: source.metrics.userMessageCount,
        assistantMessageCount: source.metrics.assistantMessageCount,
        topConcerns,
      },
      groups: includedGroups,
    },
    stats: {
      includedGroupCount: includedGroups.length,
      truncatedGroupCount: truncatedGroups.length,
      includedMessageCount,
      truncatedMessageCount,
    },
  };
}

function formatHistoryMessageForModel(message: SessionHistoryMessage) {
  const rangeLabel = message.rangePreset && message.dateFrom && message.dateTo
    ? buildRangeLabel(message.rangePreset, message.dateFrom, message.dateTo)
    : '未指定分析窗口';

  if (message.role === 'user') {
    return `历史管理员问题（${rangeLabel}）：\n${message.content}`;
  }

  return `历史分析回答：\n${message.content}`;
}

function buildModelPrompt(
  source: CustomerAnalysisSource,
  userPrompt: string,
  promptInput: PromptInput,
) {
  const topConcernText = promptInput.payload.summary.topConcerns.length > 0
    ? promptInput.payload.summary.topConcerns.map((item) => `${item.label}(${item.count})`).join('、')
    : '暂无明显高频关注点';
  const truncationHint = promptInput.stats.truncatedGroupCount > 0
    ? `注意：本轮模型分析纳入 ${promptInput.stats.includedGroupCount} 组对话，另有 ${promptInput.stats.truncatedGroupCount} 组因上下文长度限制未纳入。`
    : '本轮模型分析已纳入当前窗口内全部活跃对话组。';

  return [
    `项目名称：${source.project.projectName}`,
    `分析窗口：${source.range.label}`,
    `窗口时间：${source.range.startAt} ~ ${source.range.endAt}`,
    `当前管理员需求：${userPrompt.trim()}`,
    `数据概览：活跃销售 ${source.metrics.activeMemberCount} 人，活跃客户组 ${source.metrics.activeTopicCount} 组，总消息 ${source.metrics.totalMessageCount} 条，客户消息 ${source.metrics.userMessageCount} 条，助手消息 ${source.metrics.assistantMessageCount} 条。`,
    `高频关注：${topConcernText}`,
    truncationHint,
    '下面是项目对话的结构化摘录(JSON)：',
    JSON.stringify(promptInput.payload),
  ].join('\n\n');
}

function buildFallbackAnalysisText(
  source: CustomerAnalysisSource,
  userPrompt: string,
  promptInput: PromptInput,
) {
  const hottestConcerns = promptInput.payload.summary.topConcerns
    .slice(0, 5)
    .map((item) => `${item.label}(${item.count})`)
    .join('、');
  const latestGroups = promptInput.payload.groups
    .slice(0, 5)
    .map((group) => `- ${group.title} / 销售 ${group.ownerDisplayName} / 最近 ${group.lastMessageAt} / 关注 ${group.detectedConcerns.join('、')}`)
    .join('\n');

  return [
    `当前环境未配置可用的默认模型，暂时无法对“${userPrompt.trim()}”做深度推理，以下返回基础盘客摘要。`,
    '',
    `分析窗口：${source.range.label}`,
    `活跃销售：${source.metrics.activeMemberCount} 人`,
    `活跃客户组：${source.metrics.activeTopicCount} 组`,
    `总消息数：${source.metrics.totalMessageCount} 条`,
    `高频关注：${hottestConcerns || '暂无明显集中话题'}`,
    '',
    '最近活跃客户组：',
    latestGroups || '- 当前窗口内暂无有效客户组',
    '',
    '如需按自定义口令获得完整推理结论，请配置可用的默认模型。',
  ].join('\n');
}

async function requestProjectCustomerAnalysis(
  source: CustomerAnalysisSource,
  historyMessages: SessionHistoryMessage[],
  userPrompt: string,
): Promise<AnalysisGenerationResult> {
  const modelConfig = resolveModelConfig();
  const promptInput = buildPromptInput(source);

  if (modelConfig.provider === 'fallback') {
    return {
      content: buildFallbackAnalysisText(source, userPrompt, promptInput),
      modelProvider: modelConfig.provider,
      modelName: modelConfig.modelName,
      generationMeta: {
        promptVersion: CUSTOMER_ANALYSIS_PROMPT_VERSION,
        modelProvider: modelConfig.provider,
        modelName: modelConfig.modelName,
        mode: 'fallback',
        fallbackReason: 'Default model provider is set to fallback',
        ...promptInput.stats,
      },
    };
  }

  if (!modelConfig.endpoint || !modelConfig.apiKey) {
    return {
      content: buildFallbackAnalysisText(source, userPrompt, promptInput),
      modelProvider: 'fallback',
      modelName: 'built-in-fallback',
      generationMeta: {
        promptVersion: CUSTOMER_ANALYSIS_PROMPT_VERSION,
        modelProvider: 'fallback',
        modelName: 'built-in-fallback',
        mode: 'fallback',
        fallbackReason: 'Default model endpoint or API key is not configured',
        ...promptInput.stats,
      },
    };
  }

  const response = await fetch(resolveResponsesUrl(modelConfig.endpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${modelConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelConfig.modelName,
      temperature: 0.2,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: getProjectCustomerAnalysisSystemPrompt(),
            },
          ],
        },
        ...historyMessages.map((message) => ({
          role: message.role,
          content: [
            {
              type: 'input_text',
              text: formatHistoryMessageForModel(message),
            },
          ],
        })),
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildModelPrompt(source, userPrompt, promptInput),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Customer analysis model request failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const text = extractResponsesText(data);

  if (!text) {
    throw new Error('Customer analysis model returned empty content');
  }

  return {
    content: text,
    modelProvider: modelConfig.provider,
    modelName: modelConfig.modelName,
    generationMeta: {
      promptVersion: CUSTOMER_ANALYSIS_PROMPT_VERSION,
      modelProvider: modelConfig.provider,
      modelName: modelConfig.modelName,
      mode: 'llm',
      ...promptInput.stats,
    },
  };
}

function mapSessionSummary(row: ProjectCustomerAnalysisSessionRow) {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    lastMessageRole: row.last_message_role,
    lastMessagePreview: row.last_message_preview,
  };
}

function mapMessage(row: ProjectCustomerAnalysisMessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    rangePreset: row.range_preset,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    startAt: row.start_at,
    endAt: row.end_at,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    generationMeta: row.generation_meta && typeof row.generation_meta === 'object'
      ? row.generation_meta as Record<string, unknown>
      : null,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJob(row: ProjectCustomerAnalysisJobRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    status: row.status,
    promptPreview: row.prompt_preview,
    rangePreset: row.range_preset,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    startAt: row.start_at,
    endAt: row.end_at,
    modelProvider: row.model_provider,
    modelName: row.model_name,
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function getProjectCustomerAnalysisJobRow(jobId: string, projectId?: string) {
  const values: unknown[] = [jobId];
  let projectCondition = '';

  if (projectId) {
    values.push(projectId);
    projectCondition = `and j.project_id = $${values.length}`;
  }

  const result = await query<ProjectCustomerAnalysisJobRow>(
    `
    select
      j.id,
      j.project_id,
      j.session_id,
      j.user_message_id,
      j.assistant_message_id,
      j.status,
      j.range_preset,
      j.date_from::text as date_from,
      j.date_to::text as date_to,
      j.start_at,
      j.end_at,
      coalesce(user_message.content, '') as prompt_content,
      left(regexp_replace(coalesce(user_message.content, ''), '\s+', ' ', 'g'), 200) as prompt_preview,
      j.model_provider,
      j.model_name,
      j.error_message,
      j.created_by,
      j.created_at,
      j.updated_at,
      j.started_at,
      j.finished_at
    from lobehub_admin.project_customer_analysis_jobs j
    join lobehub_admin.project_customer_analysis_messages user_message
      on user_message.id = j.user_message_id
    where j.id = $1
      ${projectCondition}
    limit 1
    `,
    values,
  );

  return result.rows[0] ?? null;
}

async function getActiveProjectCustomerAnalysisJobForSession(sessionId: string) {
  const result = await query<ProjectCustomerAnalysisJobRow>(
    `
    select
      j.id,
      j.project_id,
      j.session_id,
      j.user_message_id,
      j.assistant_message_id,
      j.status,
      j.range_preset,
      j.date_from::text as date_from,
      j.date_to::text as date_to,
      j.start_at,
      j.end_at,
      coalesce(user_message.content, '') as prompt_content,
      left(regexp_replace(coalesce(user_message.content, ''), '\s+', ' ', 'g'), 200) as prompt_preview,
      j.model_provider,
      j.model_name,
      j.error_message,
      j.created_by,
      j.created_at,
      j.updated_at,
      j.started_at,
      j.finished_at
    from lobehub_admin.project_customer_analysis_jobs j
    join lobehub_admin.project_customer_analysis_messages user_message
      on user_message.id = j.user_message_id
    where j.session_id = $1
      and j.status in ('pending', 'running')
    order by j.created_at desc
    limit 1
    `,
    [sessionId],
  );

  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function getProjectCustomerAnalysisSessionRow(projectId: string, sessionId: string) {
  const result = await query<ProjectCustomerAnalysisSessionDetailRow>(
    `
    select
      s.id,
      s.project_id,
      s.title,
      s.created_by,
      lobehub_admin.user_display_name(s.created_by) as created_by_name,
      s.created_at,
      s.updated_at
    from lobehub_admin.project_customer_analysis_sessions s
    where s.project_id = $1
      and s.id = $2
    limit 1
    `,
    [projectId, sessionId],
  );

  const session = result.rows[0];

  if (!session) {
    throw withStatus(`Customer analysis session not found: ${sessionId}`, 404);
  }

  return session;
}

async function listSessionMessages(sessionId: string) {
  const result = await query<ProjectCustomerAnalysisMessageRow>(
    `
    select
      m.id,
      m.role,
      m.content,
      m.range_preset,
      m.date_from::text as date_from,
      m.date_to::text as date_to,
      m.start_at,
      m.end_at,
      m.model_provider,
      m.model_name,
      m.generation_meta,
      m.created_by,
      lobehub_admin.user_display_name(m.created_by) as created_by_name,
      m.created_at,
      m.updated_at
    from lobehub_admin.project_customer_analysis_messages m
    where m.session_id = $1
    order by m.created_at asc, m.id asc
    `,
    [sessionId],
  );

  return result.rows.map(mapMessage);
}

async function listRecentHistoryMessages(sessionId: string, limit = 8, excludeMessageId?: string) {
  const values: unknown[] = [sessionId];
  let excludeCondition = '';

  if (excludeMessageId) {
    values.push(excludeMessageId);
    excludeCondition = `and m.id <> $${values.length}`;
  }

  const result = await query<ProjectCustomerAnalysisMessageRow>(
    `
    select
      m.id,
      m.role,
      m.content,
      m.range_preset,
      m.date_from::text as date_from,
      m.date_to::text as date_to,
      m.start_at,
      m.end_at,
      m.model_provider,
      m.model_name,
      m.generation_meta,
      m.created_by,
      lobehub_admin.user_display_name(m.created_by) as created_by_name,
      m.created_at,
      m.updated_at
    from lobehub_admin.project_customer_analysis_messages m
    where m.session_id = $1
      ${excludeCondition}
    order by m.created_at desc, m.id desc
    limit $${values.length + 1}
    `,
    [...values, limit],
  );

  return result.rows
    .reverse()
    .map((row) => ({
      role: row.role,
      content: row.content,
      rangePreset: row.range_preset,
      dateFrom: row.date_from,
      dateTo: row.date_to,
    } satisfies SessionHistoryMessage));
}

async function countUserMessages(sessionId: string, client?: PoolClient) {
  const executor = client ?? db;
  const result = await executor.query<{ total: number }>(
    `
    select count(*)::int as total
    from lobehub_admin.project_customer_analysis_messages
    where session_id = $1
      and role = 'user'
    `,
    [sessionId],
  );

  return result.rows[0]?.total ?? 0;
}

async function insertSessionMessage(input: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  range: CustomerAnalysisRange | null;
  modelProvider?: string | null;
  modelName?: string | null;
  generationMeta?: Record<string, unknown> | null;
  createdBy: string | null;
}, client?: PoolClient) {
  const generationMeta = input.generationMeta ?? {};
  const executor = client ?? db;

  const result = await executor.query<ProjectCustomerAnalysisMessageRow>(
    `
    insert into lobehub_admin.project_customer_analysis_messages (
      session_id,
      role,
      content,
      range_preset,
      date_from,
      date_to,
      start_at,
      end_at,
      model_provider,
      model_name,
      generation_meta,
      created_by
    )
    values (
      $1,
      $2,
      $3,
      $4,
      $5::date,
      $6::date,
      $7::timestamptz,
      $8::timestamptz,
      $9,
      $10,
      $11::jsonb,
      $12
    )
    returning
      id,
      role,
      content,
      range_preset,
      date_from::text as date_from,
      date_to::text as date_to,
      start_at,
      end_at,
      model_provider,
      model_name,
      generation_meta,
      created_by,
      lobehub_admin.user_display_name(created_by) as created_by_name,
      created_at,
      updated_at
    `,
    [
      input.sessionId,
      input.role,
      input.content,
      input.range?.rangePreset ?? null,
      input.range?.dateFrom ?? null,
      input.range?.dateTo ?? null,
      input.range?.startAt ?? null,
      input.range?.endAt ?? null,
      input.modelProvider ?? null,
      input.modelName ?? null,
      JSON.stringify(generationMeta),
      input.createdBy,
    ],
  );

  await executor.query(
    `
    update lobehub_admin.project_customer_analysis_sessions
    set updated_at = now()
    where id = $1
    `,
    [input.sessionId],
  );

  const message = result.rows[0];

  if (!message) {
    throw new Error('Failed to insert customer analysis message');
  }

  return mapMessage(message);
}

function buildDefaultSessionTitle() {
  return DEFAULT_SESSION_TITLE;
}

function formatSessionTitleFromPrompt(prompt: string) {
  const normalized = truncateText(prompt, 40);
  return normalized || DEFAULT_SESSION_TITLE;
}

function isPgUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === '23505');
}

export async function listProjectCustomerAnalysisSessions(projectId: string) {
  const result = await query<ProjectCustomerAnalysisSessionRow>(
    `
    select
      s.id,
      s.title,
      s.created_by,
      lobehub_admin.user_display_name(s.created_by) as created_by_name,
      s.created_at,
      s.updated_at,
      coalesce(message_stats.message_count, 0)::int as message_count,
      message_stats.last_message_at,
      last_message.role as last_message_role,
      last_message.preview as last_message_preview
    from lobehub_admin.project_customer_analysis_sessions s
    left join lateral (
      select
        count(*)::int as message_count,
        max(m.created_at) as last_message_at
      from lobehub_admin.project_customer_analysis_messages m
      where m.session_id = s.id
    ) message_stats on true
    left join lateral (
      select
        m.role,
        left(regexp_replace(coalesce(m.content, ''), '\s+', ' ', 'g'), 200) as preview
      from lobehub_admin.project_customer_analysis_messages m
      where m.session_id = s.id
      order by m.created_at desc, m.id desc
      limit 1
    ) last_message on true
    where s.project_id = $1
    order by coalesce(message_stats.last_message_at, s.updated_at, s.created_at) desc, s.created_at desc
    `,
    [projectId],
  );

  return result.rows.map(mapSessionSummary);
}

export async function createProjectCustomerAnalysisSession(
  projectId: string,
  actorId: string,
  title?: string | null,
) {
  const resolvedTitle = title?.trim() || buildDefaultSessionTitle();
  const result = await query<ProjectCustomerAnalysisSessionDetailRow>(
    `
    insert into lobehub_admin.project_customer_analysis_sessions (
      project_id,
      title,
      created_by
    )
    values ($1, $2, $3)
    returning
      id,
      project_id,
      title,
      created_by,
      lobehub_admin.user_display_name(created_by) as created_by_name,
      created_at,
      updated_at
    `,
    [projectId, resolvedTitle, actorId],
  );

  const session = result.rows[0];

  if (!session) {
    throw new Error('Failed to create customer analysis session');
  }

  return {
    session: {
      id: session.id,
      title: session.title,
      createdBy: session.created_by,
      createdByName: session.created_by_name,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messageCount: 0,
      lastMessageAt: null,
      lastMessageRole: null,
      lastMessagePreview: null,
    },
    messages: [],
    activeJob: null,
  };
}

export async function getProjectCustomerAnalysisSession(projectId: string, sessionId: string) {
  const [session, messages, activeJob] = await Promise.all([
    getProjectCustomerAnalysisSessionRow(projectId, sessionId),
    listSessionMessages(sessionId),
    getActiveProjectCustomerAnalysisJobForSession(sessionId),
  ]);

  return {
    session: {
      id: session.id,
      title: session.title,
      createdBy: session.created_by,
      createdByName: session.created_by_name,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messageCount: messages.length,
      lastMessageAt: messages.at(-1)?.createdAt ?? null,
      lastMessageRole: messages.at(-1)?.role ?? null,
      lastMessagePreview: messages.at(-1)?.content.slice(0, 200) ?? null,
    },
    messages,
    activeJob,
  };
}

export async function listProjectCustomerAnalysisJobs(projectId: string, limit = 12) {
  const result = await query<ProjectCustomerAnalysisJobRow>(
    `
    select
      j.id,
      j.project_id,
      j.session_id,
      j.user_message_id,
      j.assistant_message_id,
      j.status,
      j.range_preset,
      j.date_from::text as date_from,
      j.date_to::text as date_to,
      j.start_at,
      j.end_at,
      coalesce(user_message.content, '') as prompt_content,
      left(regexp_replace(coalesce(user_message.content, ''), '\s+', ' ', 'g'), 200) as prompt_preview,
      j.model_provider,
      j.model_name,
      j.error_message,
      j.created_by,
      j.created_at,
      j.updated_at,
      j.started_at,
      j.finished_at
    from lobehub_admin.project_customer_analysis_jobs j
    join lobehub_admin.project_customer_analysis_messages user_message
      on user_message.id = j.user_message_id
    where j.project_id = $1
    order by j.created_at desc
    limit $2
    `,
    [projectId, limit],
  );

  return result.rows.map(mapJob);
}

export async function getProjectCustomerAnalysisJob(projectId: string, jobId: string) {
  const job = await getProjectCustomerAnalysisJobRow(jobId, projectId);
  return job ? mapJob(job) : null;
}

export async function collectProjectCustomerAnalysisSource(
  projectId: string,
  range: CustomerAnalysisRange,
): Promise<CustomerAnalysisSource> {
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

  const result = await query<SourceMessageRow>(
    `
    select
      p.id as project_id,
      p.name as project_name,
      p.description as project_description,
      pm.user_id,
      lobehub_admin.user_display_name(pm.user_id) as owner_display_name,
      u.email as owner_email,
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
    [projectId, range.startAt, range.endAt],
  );

  const topicMap = new Map<string, ProjectConversationGroup>();
  const activeMemberIds = new Set<string>();
  let totalMessageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const row of result.rows) {
    const messageContent = row.message_content.trim();

    if (!messageContent) {
      continue;
    }

    let group = topicMap.get(row.topic_id);
    if (!group) {
      group = {
        topicId: row.topic_id,
        title: row.topic_title,
        ownerUserId: row.user_id,
        ownerDisplayName: row.owner_display_name,
        ownerEmail: row.owner_email,
        managedSessionId: row.managed_session_id,
        managedSessionTitle: row.managed_session_title,
        createdAt: toIsoTimestamp(row.topic_created_at),
        updatedAt: toIsoTimestamp(row.topic_updated_at),
        messages: [],
      };
      topicMap.set(row.topic_id, group);
    }

    group.messages.push({
      id: row.message_id,
      role: row.message_role,
      content: messageContent,
      createdAt: toIsoTimestamp(row.message_created_at),
    });

    activeMemberIds.add(row.user_id);
    totalMessageCount += 1;
    if (row.message_role === 'user') userMessageCount += 1;
    if (row.message_role === 'assistant') assistantMessageCount += 1;
  }

  const groups = [...topicMap.values()]
    .filter((group) => group.messages.length > 0)
    .sort((left, right) => {
      const leftLast = left.messages.at(-1)?.createdAt ?? '';
      const rightLast = right.messages.at(-1)?.createdAt ?? '';
      return rightLast.localeCompare(leftLast);
    });
  const concernCountMap = new Map<string, number>();

  for (const group of groups) {
    const userTexts = group.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content);

    for (const label of detectConcerns(userTexts.length > 0 ? userTexts : group.messages.map((message) => message.content))) {
      concernCountMap.set(label, (concernCountMap.get(label) ?? 0) + 1);
    }
  }

  const concernStats = [...concernCountMap.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .map(([label, count]) => ({ label, count }));

  return {
    project: {
      projectId: project.id,
      projectName: project.name,
      description: project.description,
    },
    range,
    groups,
    metrics: {
      activeMemberCount: activeMemberIds.size,
      activeTopicCount: groups.length,
      totalMessageCount,
      userMessageCount,
      assistantMessageCount,
    },
    concernStats,
  };
}

export async function appendProjectCustomerAnalysisTurn(
  projectId: string,
  sessionId: string,
  actorId: string,
  input: {
    prompt: string;
    rangePreset: CustomerAnalysisRangePreset;
    dateFrom?: string | null;
    dateTo?: string | null;
  },
) {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw withStatus('Prompt is required', 400);
  }

  await getProjectCustomerAnalysisSessionRow(projectId, sessionId);
  const range = resolveCustomerAnalysisRange(input);
  const [historyMessages, existingUserCount] = await Promise.all([
    listRecentHistoryMessages(sessionId),
    countUserMessages(sessionId),
  ]);

  const userMessage = await insertSessionMessage({
    sessionId,
    role: 'user',
    content: prompt,
    range,
    createdBy: actorId,
  });

  if (existingUserCount === 0) {
    await query(
      `
      update lobehub_admin.project_customer_analysis_sessions
      set title = $2,
          updated_at = now()
      where id = $1
      `,
      [sessionId, formatSessionTitleFromPrompt(prompt)],
    );
  }

  let assistantMessage;

  try {
    const source = await collectProjectCustomerAnalysisSource(projectId, range);
    const generated = await requestProjectCustomerAnalysis(source, historyMessages, prompt);

    assistantMessage = await insertSessionMessage({
      sessionId,
      role: 'assistant',
      content: generated.content,
      range,
      modelProvider: generated.modelProvider,
      modelName: generated.modelName,
      generationMeta: {
        ...generated.generationMeta,
        activeMemberCount: source.metrics.activeMemberCount,
        activeTopicCount: source.metrics.activeTopicCount,
        totalMessageCount: source.metrics.totalMessageCount,
        rangeLabel: source.range.label,
      },
      createdBy: actorId,
    });
  } catch (error) {
    assistantMessage = await insertSessionMessage({
      sessionId,
      role: 'assistant',
      content: `本次自由盘点失败：${(error as Error).message}`,
      range,
      generationMeta: {
        promptVersion: CUSTOMER_ANALYSIS_PROMPT_VERSION,
        mode: 'failed',
        errorMessage: (error as Error).message,
      },
      createdBy: actorId,
    });
  }

  const updated = await getProjectCustomerAnalysisSession(projectId, sessionId);

  return {
    session: updated.session,
    userMessage,
    assistantMessage,
    messages: updated.messages,
  };
}

export async function createQueuedProjectCustomerAnalysisJob(
  projectId: string,
  sessionId: string,
  actorId: string,
  input: {
    prompt: string;
    rangePreset: CustomerAnalysisRangePreset;
    dateFrom?: string | null;
    dateTo?: string | null;
  },
) {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw withStatus('Prompt is required', 400);
  }

  await getProjectCustomerAnalysisSessionRow(projectId, sessionId);
  const range = resolveCustomerAnalysisRange(input);
  const client = await db.connect();
  let jobId = '';
  let userMessage: Awaited<ReturnType<typeof insertSessionMessage>> | null = null;

  try {
    await client.query('BEGIN');

    const activeJobResult = await client.query<{ id: string }>(
      `
      select id
      from lobehub_admin.project_customer_analysis_jobs
      where session_id = $1
        and status in ('pending', 'running')
      limit 1
      `,
      [sessionId],
    );

    if (activeJobResult.rows[0]?.id) {
      throw withStatus(`A customer analysis job is already running for session ${sessionId}: ${activeJobResult.rows[0].id}`, 409);
    }

    const existingUserCount = await countUserMessages(sessionId, client);
    userMessage = await insertSessionMessage({
      sessionId,
      role: 'user',
      content: prompt,
      range,
      createdBy: actorId,
    }, client);

    if (existingUserCount === 0) {
      await client.query(
        `
        update lobehub_admin.project_customer_analysis_sessions
        set title = $2,
            updated_at = now()
        where id = $1
        `,
        [sessionId, formatSessionTitleFromPrompt(prompt)],
      );
    }

    const jobResult = await client.query<{ id: string }>(
      `
      insert into lobehub_admin.project_customer_analysis_jobs (
        project_id,
        session_id,
        user_message_id,
        status,
        range_preset,
        date_from,
        date_to,
        start_at,
        end_at,
        created_by
      )
      values (
        $1,
        $2,
        $3,
        'pending',
        $4,
        $5::date,
        $6::date,
        $7::timestamptz,
        $8::timestamptz,
        $9
      )
      returning id
      `,
      [
        projectId,
        sessionId,
        userMessage.id,
        range.rangePreset,
        range.dateFrom,
        range.dateTo,
        range.startAt,
        range.endAt,
        actorId,
      ],
    );

    jobId = jobResult.rows[0]?.id ?? '';

    if (!jobId) {
      throw new Error('Failed to create customer analysis job');
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    if (isPgUniqueViolation(error)) {
      throw withStatus(`A customer analysis job is already running for session ${sessionId}`, 409);
    }

    throw error;
  } finally {
    client.release();
  }

  const [updated, job] = await Promise.all([
    getProjectCustomerAnalysisSession(projectId, sessionId),
    getProjectCustomerAnalysisJob(projectId, jobId),
  ]);

  if (!job || !userMessage) {
    throw new Error(`Customer analysis job not found after creation: ${jobId}`);
  }

  return {
    session: updated.session,
    userMessage,
    messages: updated.messages,
    activeJob: updated.activeJob,
    job,
  };
}

export async function runProjectCustomerAnalysisJob(jobId: string) {
  const job = await getProjectCustomerAnalysisJobRow(jobId);

  if (!job) {
    throw new Error(`Customer analysis job not found: ${jobId}`);
  }

  if (job.status === 'completed') {
    return {
      job: mapJob(job),
      assistantMessageId: job.assistant_message_id,
    };
  }

  await query(
    `
    update lobehub_admin.project_customer_analysis_jobs
    set status = 'running',
        error_message = null,
        started_at = coalesce(started_at, now()),
        finished_at = null,
        updated_at = now()
    where id = $1
    `,
    [jobId],
  );

  const range: CustomerAnalysisRange = {
    rangePreset: job.range_preset,
    dateFrom: job.date_from,
    dateTo: job.date_to,
    startAt: toIsoTimestamp(job.start_at),
    endAt: toIsoTimestamp(job.end_at),
    label: buildRangeLabel(job.range_preset, job.date_from, job.date_to),
  };

  try {
    const [historyMessages, source] = await Promise.all([
      listRecentHistoryMessages(job.session_id, 8, job.user_message_id),
      collectProjectCustomerAnalysisSource(job.project_id, range),
    ]);
    const generated = await requestProjectCustomerAnalysis(source, historyMessages, job.prompt_content);
    const client = await db.connect();
    let assistantMessageId: string | null = null;

    try {
      await client.query('BEGIN');

      const assistantMessage = await insertSessionMessage({
        sessionId: job.session_id,
        role: 'assistant',
        content: generated.content,
        range,
        modelProvider: generated.modelProvider,
        modelName: generated.modelName,
        generationMeta: {
          ...generated.generationMeta,
          activeMemberCount: source.metrics.activeMemberCount,
          activeTopicCount: source.metrics.activeTopicCount,
          totalMessageCount: source.metrics.totalMessageCount,
          rangeLabel: source.range.label,
          jobId,
        },
        createdBy: job.created_by,
      }, client);

      assistantMessageId = assistantMessage.id;

      await client.query(
        `
        update lobehub_admin.project_customer_analysis_jobs
        set status = 'completed',
            assistant_message_id = $2,
            model_provider = $3,
            model_name = $4,
            error_message = null,
            finished_at = now(),
            updated_at = now()
        where id = $1
        `,
        [jobId, assistantMessageId, generated.modelProvider, generated.modelName],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const updatedJob = await getProjectCustomerAnalysisJobRow(jobId);

    if (!updatedJob) {
      throw new Error(`Customer analysis job not found after completion: ${jobId}`);
    }

    return {
      job: mapJob(updatedJob),
      assistantMessageId,
    };
  } catch (error) {
    try {
      const client = await db.connect();

      try {
        await client.query('BEGIN');

        const assistantMessage = await insertSessionMessage({
          sessionId: job.session_id,
          role: 'assistant',
          content: `本次自由盘点失败：${(error as Error).message}`,
          range,
          generationMeta: {
            promptVersion: CUSTOMER_ANALYSIS_PROMPT_VERSION,
            mode: 'failed',
            errorMessage: (error as Error).message,
            jobId,
          },
          createdBy: job.created_by,
        }, client);

        await client.query(
          `
          update lobehub_admin.project_customer_analysis_jobs
          set status = 'failed',
              assistant_message_id = $2,
              error_message = $3,
              finished_at = now(),
              updated_at = now()
          where id = $1
          `,
          [jobId, assistantMessage.id, (error as Error).message],
        );

        await client.query('COMMIT');
      } catch (innerError) {
        await client.query('ROLLBACK');
        throw innerError;
      } finally {
        client.release();
      }
    } catch {
      await query(
        `
        update lobehub_admin.project_customer_analysis_jobs
        set status = 'failed',
            error_message = $2,
            finished_at = now(),
            updated_at = now()
        where id = $1
        `,
        [jobId, (error as Error).message],
      );
    }

    throw error;
  }
}
