import { env } from './config.js';
import {
  DAILY_REPORT_PROMPT_VERSION,
  type DailyReportExecutionSnapshot,
  type DailyReportGenerationResult,
  type DailyReportSourceCustomer,
  type DailyReportSourcePayload,
  type DailyReportSourceTopic,
  type DailyReportSummary,
} from './daily-report-types.js';

type ResolvedModelConfig = {
  provider: 'volcengine' | 'fallback';
  modelName: string;
  endpoint: string | null;
  apiKey: string | null;
};

type PromptInputStats = {
  includedGroupCount: number;
  truncatedGroupCount: number;
  includedMessageCount: number;
  truncatedMessageCount: number;
};

type IntentBand = 'A' | 'B' | 'C' | 'D';

type TopicIntentInsight = {
  topicId: string;
  intentBand: IntentBand | null;
  intentGrade: string | null;
  summary: string | null;
};

type TopicGroupDigest = {
  groupId: string;
  topicId: string;
  title: string;
  ownerDisplayName: string;
  ownerEmail: string | null;
  intentBand: IntentBand | null;
  intentGrade: string | null;
  firstMessageAt: string;
  lastMessageAt: string;
  totalMessageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  stage: 'inquiry' | 'evaluating' | 'negotiating' | 'blocked' | 'support';
  intentLevel: 'high' | 'medium' | 'low' | 'unknown';
  riskLevel: 'high' | 'medium' | 'low';
  overallSummary: string;
  initialCustomerMessage: string | null;
  mainConcerns: string[];
  managementNeed: string;
  recommendedAction: string;
  actionType: 'inventory_release' | 'pricing_policy' | 'sales_collateral' | 'revisit_campaign' | 'channel_expansion' | 'broker_incentive';
  evidenceMessageIds: string[];
  lastUserMessages: string[];
};

const concernMatchers: Array<{ label: string; pattern: RegExp }> = [
  { label: '价格预算', pattern: /报价|价格|总价|预算|优惠|折扣|贵|便宜|首付|月供/ },
  { label: '房源楼层', pattern: /房源|楼层|户型|加推|新楼栋|洋房|小高层|面积|133|143|129|130/ },
  { label: '学区配套', pattern: /学区|学校|上学|配套|商业|交通|地铁|医院/ },
  { label: '竞品对比', pattern: /竞品|公园道|绿城|对比|别家|其他项目/ },
  { label: '复访决策', pattern: /复访|邀约|不愿沟通|做不了主|决策人|再看看|来年|以后再说/ },
  { label: '交付工程', pattern: /交付|工程|工期|现房|准现房|装修|品质/ },
  { label: '渠道拓客', pattern: /中介|渠道|经纪人|分销|拓客|带看/ },
];

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

function dedupeStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function isIntentBand(value: unknown): value is IntentBand {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D';
}

function parseIntentExtractionResult(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const jsonStart = fenced.indexOf('{');
  const jsonEnd = fenced.lastIndexOf('}');

  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error('Intent extraction did not return valid JSON object');
  }

  const parsed = JSON.parse(fenced.slice(jsonStart, jsonEnd + 1)) as { groups?: unknown };

  if (!Array.isArray(parsed.groups)) {
    throw new Error('Intent extraction JSON is missing groups array');
  }

  return parsed.groups.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Intent extraction group item is invalid');
    }

    const record = item as Record<string, unknown>;
    const topicId = typeof record.topicId === 'string' ? record.topicId.trim() : '';
    const intentBand = isIntentBand(record.intentBand) ? record.intentBand : null;
    const intentGrade = typeof record.intentGrade === 'string' && record.intentGrade.trim()
      ? record.intentGrade.trim().slice(0, 20)
      : null;
    const summary = typeof record.summary === 'string' && record.summary.trim()
      ? truncateText(record.summary, 280)
      : null;

    if (!topicId) {
      throw new Error('Intent extraction group item is missing topicId');
    }

    return {
      topicId,
      intentBand,
      intentGrade,
      summary,
    } satisfies TopicIntentInsight;
  });
}

function resolveModelConfig(snapshot: DailyReportExecutionSnapshot): ResolvedModelConfig {
  if (snapshot.modelProvider === 'volcengine') {
    return {
      provider: 'volcengine',
      modelName: snapshot.modelName,
      endpoint: env.VOLCENGINE_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: env.VOLCENGINE_API_KEY?.trim() || null,
    };
  }

  return {
    provider: 'fallback',
    modelName: snapshot.modelName || 'built-in-fallback',
    endpoint: null,
    apiKey: null,
  };
}

function pickStage(texts: string[]): TopicGroupDigest['stage'] {
  const joined = texts.join('\n');

  if (/报价|价格|预算|优惠|折扣|合同|认筹|定金/.test(joined)) return 'negotiating';
  if (/交付|工程|报错|异常|投诉/.test(joined)) return 'support';
  if (/做不了主|不愿沟通|来年|以后再说|竞品|别家|不考虑/.test(joined)) return 'blocked';
  if (/学区|配套|户型|楼层|房源|加推|新楼栋|对比/.test(joined)) return 'evaluating';
  return 'inquiry';
}

function resolveIntentLevel(intentBand: IntentBand | null): TopicGroupDigest['intentLevel'] {
  if (intentBand === 'A' || intentBand === 'B') return 'high';
  if (intentBand === 'C') return 'medium';
  if (intentBand === 'D') return 'low';
  return 'unknown';
}

function pickRiskLevel(texts: string[]): TopicGroupDigest['riskLevel'] {
  const joined = texts.join('\n');
  let score = 0;

  if (/做不了主|决策人|不愿沟通/.test(joined)) score += 2;
  if (/贵|预算|优惠/.test(joined)) score += 1;
  if (/竞品|别家|公园道|绿城/.test(joined)) score += 1;
  if (/来年|以后再说|不考虑/.test(joined)) score += 1;
  if (/房源|楼层|加推|新楼栋/.test(joined)) score += 1;

  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

function detectConcerns(texts: string[]) {
  const joined = texts.join('\n');
  const labels = concernMatchers
    .filter((item) => item.pattern.test(joined))
    .map((item) => item.label);

  return labels.length > 0 ? labels : ['需求待澄清'];
}

function pickActionType(concerns: string[], stage: TopicGroupDigest['stage'], intentLevel: TopicGroupDigest['intentLevel'], riskLevel: TopicGroupDigest['riskLevel']): TopicGroupDigest['actionType'] {
  if (concerns.includes('房源楼层')) return 'inventory_release';
  if (concerns.includes('价格预算')) return 'pricing_policy';
  if (concerns.includes('学区配套') || concerns.includes('竞品对比') || concerns.includes('交付工程')) return 'sales_collateral';
  if (concerns.includes('复访决策') || stage === 'blocked') return 'revisit_campaign';
  if (concerns.includes('渠道拓客')) return 'broker_incentive';
  if (intentLevel === 'low' && riskLevel === 'low') return 'channel_expansion';
  return 'sales_collateral';
}

function getInitialCustomerMessage(topic: DailyReportSourceTopic) {
  const firstUserMessage = topic.messages.find((message) => message.role === 'user')?.content ?? '';
  return firstUserMessage ? truncateText(firstUserMessage, 220) : null;
}

function buildMissingInfoSummary(topic: DailyReportSourceTopic) {
  const initialCustomerMessage = getInitialCustomerMessage(topic);

  if (initialCustomerMessage) {
    return truncateText(
      `当前客户描述为“${initialCustomerMessage}”，但对话分析结果里没有明确给出 A/B/C/D 意向等级，建议补充预算、决策人和房源匹配等关键信息后再分析。`,
      220,
    );
  }

  return '当前未从对话分析结果中识别出明确的 A/B/C/D 意向等级，建议补充客户预算、决策人和房源匹配等关键信息后再分析。';
}

function describeMissingInfoNeed() {
  return '需要销售补齐客户预算、决策人到场情况、核心购房诉求和房源匹配情况';
}

function describeMissingInfoAction() {
  return '补充客户关键信息后重新发起分析，优先确认预算、决策人和核心诉求';
}

function describeManagementNeed(actionType: TopicGroupDigest['actionType'], concerns: string[]) {
  switch (actionType) {
    case 'inventory_release':
      return '需要管理端给出加推房源、可售楼层或新楼栋释放口径';
    case 'pricing_policy':
      return '需要管理端评估优惠边界、价格口径或限时政策';
    case 'sales_collateral':
      return `需要补齐${concerns.join('、')}相关对比物料与统一说辞`;
    case 'revisit_campaign':
      return '需要为复访邀约和决策人触达提供统一话术与节奏';
    case 'broker_incentive':
      return '需要评估中介联动和激励工具，提升带看转化';
    case 'channel_expansion':
    default:
      return '需要扩大有效来访来源，补充渠道触达和拓客动作';
  }
}

function describeRecommendedAction(actionType: TopicGroupDigest['actionType'], concerns: string[]) {
  switch (actionType) {
    case 'inventory_release':
      return '尽快明确可加推房源、主推楼栋和可释放时间，给前线一个清晰承诺';
    case 'pricing_policy':
      return '复核成交底价和优惠口径，必要时对重点客户释放限时政策';
    case 'sales_collateral':
      return `整理${concerns.join('、')}的对比资料，形成可直接转发给客户的道具`;
    case 'revisit_campaign':
      return '围绕复访理由、决策人到场和限时节点设计一轮集中回访动作';
    case 'broker_incentive':
      return '针对重点产品或重点客群评估提高中介激励或联动范围';
    case 'channel_expansion':
    default:
      return '在项目端增加带看入口，扩大渠道、中介或外部联动覆盖';
  }
}

function getLastUserMessages(topic: DailyReportSourceTopic) {
  return topic.messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) => truncateText(message.content, 180));
}

function buildTopicGroupDigest(
  owner: DailyReportSourceCustomer,
  topic: DailyReportSourceTopic,
  insightByTopicId: Map<string, TopicIntentInsight>,
): TopicGroupDigest {
  const userMessages = topic.messages.filter((message) => message.role === 'user');
  const assistantMessages = topic.messages.filter((message) => message.role === 'assistant');
  const textSource = userMessages.length > 0 ? userMessages.map((message) => message.content) : topic.messages.map((message) => message.content);
  const concerns = detectConcerns(textSource);
  const stage = pickStage(textSource);
  const llmInsight = insightByTopicId.get(topic.topicId) ?? null;
  const intentBand = llmInsight?.intentBand ?? null;
  const intentGrade = llmInsight?.intentGrade ?? null;
  const intentLevel = resolveIntentLevel(intentBand);
  const riskLevel = pickRiskLevel(textSource);
  const actionType = pickActionType(concerns, stage, intentLevel, riskLevel);
  const initialCustomerMessage = getInitialCustomerMessage(topic);
  const overallSummary = llmInsight?.summary
    ? truncateText(llmInsight.summary, 220)
    : intentBand
      ? truncateText(
        `${topic.title}，客户主要关注${concerns.join('、')}，当前处于${stage}阶段，${intentBand === 'A' || intentBand === 'B' ? '属于高意向客户' : intentBand === 'C' ? '仍在持续评估' : '当前成交优先级较低'}。`,
        220,
      )
      : buildMissingInfoSummary(topic);

  return {
    groupId: topic.topicId,
    topicId: topic.topicId,
    title: topic.title,
    ownerDisplayName: owner.displayName,
    ownerEmail: owner.email,
    intentBand,
    intentGrade,
    firstMessageAt: topic.messages[0]?.createdAt ?? topic.createdAt,
    lastMessageAt: topic.messages[topic.messages.length - 1]?.createdAt ?? topic.updatedAt,
    totalMessageCount: topic.messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    stage,
    intentLevel,
    riskLevel,
    overallSummary,
    initialCustomerMessage,
    mainConcerns: concerns,
    managementNeed: intentBand ? describeManagementNeed(actionType, concerns) : describeMissingInfoNeed(),
    recommendedAction: intentBand ? describeRecommendedAction(actionType, concerns) : describeMissingInfoAction(),
    actionType,
    evidenceMessageIds: userMessages.slice(-3).map((message) => message.id),
    lastUserMessages: getLastUserMessages(topic),
  };
}

function getGroupScore(group: TopicGroupDigest) {
  const intentScore = group.intentBand === 'A'
    ? 40
    : group.intentBand === 'B'
      ? 30
      : group.intentBand === null
        ? 18
        : group.intentBand === 'C'
          ? 10
          : 0;

  return intentScore
    + (group.riskLevel === 'high' ? 10 : group.riskLevel === 'medium' ? 5 : 0)
    + group.userMessageCount;
}

function buildTopicGroups(source: DailyReportSourcePayload, insightByTopicId = new Map<string, TopicIntentInsight>()) {
  return source.customers
    .flatMap((owner) => owner.topics.map((topic) => buildTopicGroupDigest(owner, topic, insightByTopicId)))
    .sort((left, right) =>
      getGroupScore(right) - getGroupScore(left)
      || right.lastMessageAt.localeCompare(left.lastMessageAt));
}

function buildCommonConcerns(groups: TopicGroupDigest[]) {
  const bucket = new Map<string, { count: number; topicIds: string[] }>();

  for (const group of groups) {
    for (const label of group.mainConcerns) {
      const current = bucket.get(label) ?? { count: 0, topicIds: [] };
      current.count += 1;
      current.topicIds.push(group.topicId);
      bucket.set(label, current);
    }
  }

  return [...bucket.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0], 'zh-CN'))
    .map(([label, value]) => ({
      label,
      count: value.count,
      detail: `当日共有 ${value.count} 组客户提到${label}相关问题。`,
      topicIds: value.topicIds,
    }))
    .slice(0, 8);
}

function buildHighlights(groups: TopicGroupDigest[], commonConcerns: ReturnType<typeof buildCommonConcerns>) {
  const highlights: Array<{ title: string; detail: string; relatedTopicIds: string[] }> = [];
  const highIntentGroups = groups.filter((group) => group.intentBand === 'A' || group.intentBand === 'B');
  const blockedGroups = groups.filter((group) => group.stage === 'blocked' || group.riskLevel === 'high');
  const missingIntentGroups = groups.filter((group) => group.intentBand === null);

  if (highIntentGroups.length > 0) {
    highlights.push({
      title: '今日已有可重点推进的成交机会',
      detail: `共有 ${highIntentGroups.length} 组客户在 AI 分析结果中被识别为 A/B 类，可作为今日重点盘客对象。`,
      relatedTopicIds: highIntentGroups.map((group) => group.topicId),
    });
  }

  for (const concern of commonConcerns.slice(0, 2)) {
    highlights.push({
      title: `${concern.label}成为今日高频关注点`,
      detail: concern.detail,
      relatedTopicIds: concern.topicIds,
    });
  }

  if (blockedGroups.length > 0) {
    highlights.push({
      title: '部分客户卡在复访或决策环节',
      detail: `共有 ${blockedGroups.length} 组客户存在明显卡点，需要项目端集中干预。`,
      relatedTopicIds: blockedGroups.map((group) => group.topicId),
    });
  }

  if (missingIntentGroups.length > 0) {
    highlights.push({
      title: '部分客户信息不足，暂未形成意向分级',
      detail: `共有 ${missingIntentGroups.length} 组客户未在 AI 分析结果中输出明确等级，建议补充预算、决策人和房源匹配信息。`,
      relatedTopicIds: missingIntentGroups.map((group) => group.topicId),
    });
  }

  if (highlights.length === 0) {
    highlights.push({
      title: '今日来访整体平稳',
      detail: groups.length > 0 ? `当日来访 ${groups.length} 组，暂无明显集中卡点。` : '当日暂无有效来访组。', 
      relatedTopicIds: groups.map((group) => group.topicId),
    });
  }

  return highlights.slice(0, 5);
}

function buildManagementFocus(groups: TopicGroupDigest[], commonConcerns: ReturnType<typeof buildCommonConcerns>) {
  const focusItems: Array<{ title: string; severity: 'high' | 'medium' | 'low'; detail: string; relatedTopicIds: string[] }> = [];
  const highRiskGroups = groups.filter((group) => group.riskLevel === 'high');
  const blockedGroups = groups.filter((group) => group.stage === 'blocked');
  const missingIntentGroups = groups.filter((group) => group.intentBand === null);

  if (highRiskGroups.length > 0) {
    focusItems.push({
      title: '高风险客户组需要管理层直接关注',
      severity: 'high',
      detail: `共有 ${highRiskGroups.length} 组客户在价格、决策人或竞品问题上存在明显流失风险。`,
      relatedTopicIds: highRiskGroups.map((group) => group.topicId),
    });
  }

  if (blockedGroups.length > 0) {
    focusItems.push({
      title: '复访和决策推进存在阻塞',
      severity: blockedGroups.length >= 2 ? 'high' : 'medium',
      detail: `共有 ${blockedGroups.length} 组客户停留在“再看看/等决策/决策人不到场”的状态。`,
      relatedTopicIds: blockedGroups.map((group) => group.topicId),
    });
  }

  if (missingIntentGroups.length > 0) {
    focusItems.push({
      title: '部分客户资料不足，影响意向判定',
      severity: missingIntentGroups.length >= 3 ? 'high' : 'medium',
      detail: `共有 ${missingIntentGroups.length} 组客户未输出明确等级，建议一线补齐预算、决策人和核心需求后再分析。`,
      relatedTopicIds: missingIntentGroups.map((group) => group.topicId),
    });
  }

  for (const concern of commonConcerns.slice(0, 3)) {
    focusItems.push({
      title: `${concern.label}是管理层需要统一解决的问题`,
      severity: concern.count >= 3 ? 'high' : 'medium',
      detail: concern.detail,
      relatedTopicIds: concern.topicIds,
    });
  }

  return focusItems.slice(0, 6);
}

function buildManagementActions(groups: TopicGroupDigest[], commonConcerns: ReturnType<typeof buildCommonConcerns>) {
  const actions = new Map<string, {
    actionType: TopicGroupDigest['actionType'];
    title: string;
    priority: 'high' | 'medium' | 'low';
    detail: string;
    reason: string;
    relatedTopicIds: string[];
  }>();

  const concernMap = new Map(commonConcerns.map((item) => [item.label, item]));

  if (concernMap.has('房源楼层')) {
    const concern = concernMap.get('房源楼层')!;
    actions.set('inventory_release', {
      actionType: 'inventory_release',
      title: '准备加推房源或释放可售楼层口径',
      priority: concern.count >= 2 ? 'high' : 'medium',
      detail: '把加推节奏、可售楼层和主推房源统一成一线可直接使用的话术。',
      reason: `当日 ${concern.count} 组客户明确提到房源、楼层或新楼栋问题。`,
      relatedTopicIds: concern.topicIds,
    });
  }

  if (concernMap.has('价格预算')) {
    const concern = concernMap.get('价格预算')!;
    actions.set('pricing_policy', {
      actionType: 'pricing_policy',
      title: '复核价格策略并准备优惠口径',
      priority: concern.count >= 2 ? 'high' : 'medium',
      detail: '评估是否需要限时优惠、总价口径或重点客户专属政策。',
      reason: `当日 ${concern.count} 组客户卡在价格、预算或优惠问题。`,
      relatedTopicIds: concern.topicIds,
    });
  }

  const materialConcernLabels = ['学区配套', '竞品对比', '交付工程'];
  const materialTopics = materialConcernLabels.flatMap((label) => concernMap.get(label)?.topicIds ?? []);
  if (materialTopics.length > 0) {
    actions.set('sales_collateral', {
      actionType: 'sales_collateral',
      title: '补齐对比资料和销售道具',
      priority: materialTopics.length >= 3 ? 'high' : 'medium',
      detail: '建议整理学区、配套、竞品、工程进度等一页式对比物料，供一线转发。',
      reason: `客户关注点集中在${materialConcernLabels.filter((label) => concernMap.has(label)).join('、')}。`,
      relatedTopicIds: materialTopics,
    });
  }

  const blockedGroups = groups.filter((group) => group.stage === 'blocked' || group.mainConcerns.includes('复访决策'));
  if (blockedGroups.length > 0) {
    actions.set('revisit_campaign', {
      actionType: 'revisit_campaign',
      title: '组织一轮复访与决策人触达动作',
      priority: blockedGroups.length >= 2 ? 'high' : 'medium',
      detail: '围绕决策人到场、复访理由和限时节点，统一安排回访动作与话术。',
      reason: `共有 ${blockedGroups.length} 组客户卡在复访或决策推进环节。`,
      relatedTopicIds: blockedGroups.map((group) => group.topicId),
    });
  }

  if (groups.length <= 2) {
    actions.set('channel_expansion', {
      actionType: 'channel_expansion',
      title: '扩大有效来访渠道',
      priority: 'medium',
      detail: '当日有效来访组偏少，建议补强渠道投放、中介联动或外部拓客动作。',
      reason: `当日仅有 ${groups.length} 组有效来访。`,
      relatedTopicIds: groups.map((group) => group.topicId),
    });
  }

  if (groups.some((group) => group.mainConcerns.includes('渠道拓客'))) {
    const relatedTopicIds = groups
      .filter((group) => group.mainConcerns.includes('渠道拓客'))
      .map((group) => group.topicId);

    actions.set('broker_incentive', {
      actionType: 'broker_incentive',
      title: '评估中介范围和激励政策',
      priority: 'medium',
      detail: '若项目当前自然来访不足，可同步评估扩大中介覆盖或提高重点产品激励。',
      reason: '当日对话中已出现渠道或中介相关诉求。',
      relatedTopicIds,
    });
  }

  return [...actions.values()].slice(0, 6);
}

function buildOverviewHeadline(groups: TopicGroupDigest[], managementActions: ReturnType<typeof buildManagementActions>) {
  const highIntentCount = groups.filter((group) => group.intentBand === 'A' || group.intentBand === 'B').length;
  const missingIntentCount = groups.filter((group) => group.intentBand === null).length;
  const highRiskCount = groups.filter((group) => group.riskLevel === 'high').length;

  return `今日来访 ${groups.length} 组，A/B 高意向 ${highIntentCount} 组，信息不足 ${missingIntentCount} 组，高风险 ${highRiskCount} 组`;
}

function buildExecutiveSummary(groups: TopicGroupDigest[], commonConcerns: ReturnType<typeof buildCommonConcerns>, managementActions: ReturnType<typeof buildManagementActions>) {
  if (groups.length === 0) {
    return '今日营业时间内暂无有效来访组，暂时无法形成经营判断。';
  }

  const topGroups = groups
    .filter((group) => group.intentBand === 'A' || group.intentBand === 'B')
    .slice(0, 3)
    .map((group) => group.title)
    .join('、');
  const topConcerns = commonConcerns.slice(0, 3).map((item) => item.label).join('、');
  const topActions = managementActions.slice(0, 2).map((item) => item.title).join('；');
  const missingIntentCount = groups.filter((group) => group.intentBand === null).length;

  return truncateText(
    `今日共识别 ${groups.length} 组有效来访，对话主要集中在 ${topConcerns || '客户需求澄清'}。${topGroups ? `当前最值得关注的 A/B 类客户包括 ${topGroups}。` : '今日暂未识别出明确的 A/B 类客户。'}${missingIntentCount > 0 ? `另有 ${missingIntentCount} 组客户因信息不足未形成明确等级。` : ''}从管理动作看，建议优先处理：${topActions || '持续观察来访变化'}。`,
    600,
  );
}

function mapGroupToSummaryItem(group: TopicGroupDigest) {
  return {
    groupId: group.groupId,
    topicId: group.topicId,
    title: group.title,
    ownerDisplayName: group.ownerDisplayName,
    ownerEmail: group.ownerEmail,
    intentBand: group.intentBand,
    intentGrade: group.intentGrade,
    firstMessageAt: group.firstMessageAt,
    lastMessageAt: group.lastMessageAt,
    totalMessageCount: group.totalMessageCount,
    userMessageCount: group.userMessageCount,
    assistantMessageCount: group.assistantMessageCount,
    stage: group.stage,
    intentLevel: group.intentLevel,
    riskLevel: group.riskLevel,
    overallSummary: group.overallSummary,
    initialCustomerMessage: group.initialCustomerMessage,
    mainConcerns: group.mainConcerns,
    managementNeed: group.managementNeed,
    recommendedAction: group.recommendedAction,
    evidenceMessageIds: group.evidenceMessageIds,
  };
}

function buildFallbackSummary(
  source: DailyReportSourcePayload,
  modelConfig: ResolvedModelConfig,
  fallbackReason: string | null,
  insightByTopicId = new Map<string, TopicIntentInsight>(),
): DailyReportSummary {
  const groups = buildTopicGroups(source, insightByTopicId);
  const commonConcerns = buildCommonConcerns(groups);
  const managementActions = buildManagementActions(groups, commonConcerns);
  const managementFocus = buildManagementFocus(groups, commonConcerns);
  const highlights = buildHighlights(groups, commonConcerns);
  const aIntentGroups = groups.filter((group) => group.intentBand === 'A');
  const bIntentGroups = groups.filter((group) => group.intentBand === 'B');
  const cIntentGroups = groups.filter((group) => group.intentBand === 'C');
  const dIntentGroups = groups.filter((group) => group.intentBand === 'D');
  const highIntentGroups = [...aIntentGroups, ...bIntentGroups];
  const missingIntentGroups = groups.filter((group) => group.intentBand === null);

  return {
    schemaVersion: 2,
    overview: {
      projectId: source.project.projectId,
      projectName: source.project.projectName,
      businessDate: source.window.businessDate,
      timezone: source.window.timeZone,
      windowStartAt: source.window.startAt,
      windowEndAt: source.window.endAt,
      headline: buildOverviewHeadline(groups, managementActions),
      executiveSummary: buildExecutiveSummary(groups, commonConcerns, managementActions),
    },
    stats: {
      visitedGroupCount: groups.length,
      aIntentGroupCount: aIntentGroups.length,
      bIntentGroupCount: bIntentGroups.length,
      cIntentGroupCount: cIntentGroups.length,
      dIntentGroupCount: dIntentGroups.length,
      missingIntentGroupCount: missingIntentGroups.length,
      highIntentGroupCount: highIntentGroups.length,
      mediumIntentGroupCount: cIntentGroups.length,
      lowIntentGroupCount: dIntentGroups.length,
      highRiskGroupCount: groups.filter((group) => group.riskLevel === 'high').length,
      activeTopicCount: source.metrics.activeTopicCount,
      totalMessageCount: source.metrics.totalMessageCount,
      userMessageCount: source.metrics.userMessageCount,
      assistantMessageCount: source.metrics.assistantMessageCount,
    },
    highlights,
    keyCustomerGroups: highIntentGroups.slice(0, 12).map(mapGroupToSummaryItem),
    missingInfoCustomers: missingIntentGroups.slice(0, 12).map(mapGroupToSummaryItem),
    commonConcerns,
    managementFocus,
    managementActions,
    generation: {
      promptVersion: DAILY_REPORT_PROMPT_VERSION,
      modelProvider: modelConfig.provider,
      modelName: modelConfig.modelName,
      sourceTopicCount: source.metrics.activeTopicCount,
      sourceMessageCount: source.metrics.totalMessageCount,
      includedMessageCount: source.metrics.totalMessageCount,
      truncatedMessageCount: 0,
      generatedAt: new Date().toISOString(),
      mode: 'fallback' as const,
      fallbackReason,
    },
  };
}

function renderMarkdown(summary: DailyReportSummary) {
  const lines: string[] = [];

  lines.push(`# ${summary.overview.projectName} 经营日报`);
  lines.push('');
  lines.push(`- 业务日期：${summary.overview.businessDate}`);
  lines.push(`- 时区：${summary.overview.timezone}`);
  lines.push(`- 统计窗口：${summary.overview.windowStartAt} ~ ${summary.overview.windowEndAt}`);
  lines.push(`- 总览：${summary.overview.headline}`);
  lines.push('');
  lines.push('## 项目概览');
  lines.push(summary.overview.executiveSummary);
  lines.push('');
  lines.push('## 核心指标');
  lines.push(`- 来访组数：${summary.stats.visitedGroupCount}`);
  lines.push(`- A 类客户：${summary.stats.aIntentGroupCount}`);
  lines.push(`- B 类客户：${summary.stats.bIntentGroupCount}`);
  lines.push(`- C 类客户：${summary.stats.cIntentGroupCount}`);
  lines.push(`- D 类客户：${summary.stats.dIntentGroupCount}`);
  lines.push(`- 高意向组数：${summary.stats.highIntentGroupCount}`);
  lines.push(`- 信息不足组数：${summary.stats.missingIntentGroupCount}`);
  lines.push(`- 高风险组数：${summary.stats.highRiskGroupCount}`);
  lines.push(`- 总消息数：${summary.stats.totalMessageCount}`);
  lines.push(`- 客户消息数：${summary.stats.userMessageCount}`);
  lines.push(`- 助手消息数：${summary.stats.assistantMessageCount}`);
  lines.push('');

  if (summary.highlights.length > 0) {
    lines.push('## 今日重点');
    for (const item of summary.highlights) {
      lines.push(`- ${item.title}：${item.detail}`);
    }
    lines.push('');
  }

  if (summary.keyCustomerGroups.length > 0) {
    lines.push('## 今日重点客户');
    for (const group of summary.keyCustomerGroups) {
      lines.push(`### ${group.title}`);
      lines.push(`- 销售员：${group.ownerDisplayName}`);
      lines.push(`- 意向等级：${group.intentGrade ?? group.intentBand ?? '未识别'}`);
      lines.push(`- 主要关注：${group.mainConcerns.join('、')}`);
      lines.push(`- 摘要：${group.overallSummary}`);
      lines.push(`- 管理关注：${group.managementNeed}`);
      lines.push(`- 建议动作：${group.recommendedAction}`);
      lines.push('');
    }
  }

  if (summary.missingInfoCustomers.length > 0) {
    lines.push('## 待补信息客户');
    for (const group of summary.missingInfoCustomers) {
      lines.push(`### ${group.title}`);
      lines.push(`- 销售员：${group.ownerDisplayName}`);
      if (group.initialCustomerMessage) {
        lines.push(`- 初始描述：${group.initialCustomerMessage}`);
      }
      lines.push(`- 摘要：${group.overallSummary}`);
      lines.push(`- 建议动作：${group.recommendedAction}`);
      lines.push('');
    }
  }

  if (summary.commonConcerns.length > 0) {
    lines.push('## 客户共性关注');
    for (const concern of summary.commonConcerns) {
      lines.push(`- ${concern.label}：${concern.detail}`);
    }
    lines.push('');
  }

  if (summary.managementFocus.length > 0) {
    lines.push('## 管理层需关注');
    for (const item of summary.managementFocus) {
      lines.push(`- [${item.severity}] ${item.title}：${item.detail}`);
    }
    lines.push('');
  }

  if (summary.managementActions.length > 0) {
    lines.push('## 建议提供的管理动作/道具');
    for (const item of summary.managementActions) {
      lines.push(`- [${item.priority}] ${item.title}：${item.detail}。原因：${item.reason}`);
    }
    lines.push('');
  }

  lines.push('## 生成信息');
  lines.push(`- 生成方式：${summary.generation.mode}`);
  lines.push(`- 模型：${summary.generation.modelProvider} / ${summary.generation.modelName}`);
  if (summary.generation.fallbackReason) {
    lines.push(`- 回退原因：${summary.generation.fallbackReason}`);
  }

  return lines.join('\n');
}

function buildPromptInput(source: DailyReportSourcePayload) {
  const maxGroups = 24;
  const maxMessagesPerGroup = 6;
  const allGroups = source.customers
    .flatMap((owner) => owner.topics.map((topic) => ({
      topicId: topic.topicId,
      title: topic.title,
      ownerDisplayName: owner.displayName,
      ownerEmail: owner.email,
      firstMessageAt: topic.messages[0]?.createdAt ?? topic.createdAt,
      lastMessageAt: topic.messages[topic.messages.length - 1]?.createdAt ?? topic.updatedAt,
      totalMessageCount: topic.messages.length,
      recentMessages: topic.messages.slice(-maxMessagesPerGroup).map((message) => ({
        id: message.id,
        role: message.role,
        content: truncateText(message.content, 240),
      })),
      initialCustomerMessage: getInitialCustomerMessage(topic),
    })))
    .sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
  const includedGroups = allGroups.slice(0, maxGroups);
  const truncatedGroups = allGroups.slice(maxGroups);

  const payload = {
    project: source.project,
    window: source.window,
    stats: {
      visitedGroupCount: allGroups.length,
      totalMessageCount: source.metrics.totalMessageCount,
      userMessageCount: source.metrics.userMessageCount,
      assistantMessageCount: source.metrics.assistantMessageCount,
    },
    groups: includedGroups.map((group) => ({
      topicId: group.topicId,
      title: group.title,
      ownerDisplayName: group.ownerDisplayName,
      ownerEmail: group.ownerEmail,
      firstMessageAt: group.firstMessageAt,
      lastMessageAt: group.lastMessageAt,
      totalMessageCount: group.totalMessageCount,
      initialCustomerMessage: group.initialCustomerMessage,
      recentMessages: group.recentMessages,
    })),
  };

  const includedMessageCount = includedGroups.reduce((count, group) => count + group.totalMessageCount, 0);
  const truncatedMessageCount = truncatedGroups.reduce((count, group) => count + group.totalMessageCount, 0);

  return {
    payload,
    stats: {
      includedGroupCount: includedGroups.length,
      truncatedGroupCount: truncatedGroups.length,
      includedMessageCount,
      truncatedMessageCount,
    } satisfies PromptInputStats,
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
    return responseBody.output_text;
  }

  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as Array<Record<string, unknown>>
      : [];

    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        chunks.push(part.text);
      }
      if (typeof part?.content === 'string' && part.content.trim()) {
        chunks.push(part.content);
      }
    }
  }

  return chunks.join('\n').trim();
}

async function requestVolcengineIntentInsights(
  source: DailyReportSourcePayload,
  modelConfig: ResolvedModelConfig,
) {
  if (!modelConfig.endpoint || !modelConfig.apiKey) {
    throw new Error('VOLCENGINE endpoint or API key is not configured');
  }

  const promptInput = buildPromptInput(source);
  const response = await fetch(resolveResponsesUrl(modelConfig.endpoint), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${modelConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelConfig.modelName,
      temperature: 0.1,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                '你将收到项目客户对话的结构化原文。',
                '',
                '你的任务不是重新判断客户意向，也不是输出日报正文。',
                '你只做结构化抽取：',
                '1. 如果原文中的 AI 分析结果已经明确出现 A/B/C/D 等级，就提取出来。',
                '2. intentBand 只允许返回 A/B/C/D/null。',
                '3. intentGrade 返回原始等级文本，例如 B+、C+、B；如果没有明确等级则返回 null。',
                '4. summary 输出一句中文结论，不超过 70 个字；如果没有明确等级，要明确写“信息不足，需要补充客户信息”。',
                '5. 不得自行猜测等级；原文没有就返回 null。',
                '6. topicId 必须原样返回。',
                '7. 只输出 JSON，不要 markdown，不要解释。',
                '',
                '输出格式：',
                '{"groups":[{"topicId":"...","intentBand":"A","intentGrade":"B+","summary":"..."}]}',
                '',
                `输入数据如下：\n${JSON.stringify(promptInput.payload)}`,
              ].join('\n'),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Daily report model request failed: ${response.status}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const text = extractResponsesText(data);

  if (!text) {
    throw new Error('Daily report model returned empty content');
  }

  return {
    insights: parseIntentExtractionResult(text),
    promptStats: promptInput.stats,
  };
}

export async function generateDailyReportSummary(
  source: DailyReportSourcePayload,
  executionSnapshot: DailyReportExecutionSnapshot,
): Promise<DailyReportGenerationResult> {
  const modelConfig = resolveModelConfig(executionSnapshot);
  const promptInput = buildPromptInput(source);
  const fallbackSummary = buildFallbackSummary(
    source,
    modelConfig,
    modelConfig.provider === 'fallback' ? 'Daily report model provider is set to fallback' : null,
  );

  if (modelConfig.provider === 'fallback') {
    return {
      summary: fallbackSummary,
      summaryMarkdown: renderMarkdown(fallbackSummary),
      generationMeta: {
        ...fallbackSummary.generation,
        ...promptInput.stats,
      },
    };
  }

  try {
    const llmResult = await requestVolcengineIntentInsights(source, modelConfig);
    const insightByTopicId = new Map(llmResult.insights.map((item) => [item.topicId, item]));
    const llmSummary: DailyReportSummary = {
      ...buildFallbackSummary(source, modelConfig, null, insightByTopicId),
      generation: {
        ...fallbackSummary.generation,
        modelProvider: modelConfig.provider,
        modelName: modelConfig.modelName,
        includedMessageCount: llmResult.promptStats.includedMessageCount,
        truncatedMessageCount: llmResult.promptStats.truncatedMessageCount,
        generatedAt: new Date().toISOString(),
        mode: 'llm',
        fallbackReason: null,
      },
    };

    return {
      summary: llmSummary,
      summaryMarkdown: renderMarkdown(llmSummary),
      generationMeta: {
        ...llmSummary.generation,
        ...llmResult.promptStats,
      },
    };
  } catch (error) {
    const failedFallbackSummary: DailyReportSummary = {
      ...fallbackSummary,
      generation: {
        ...fallbackSummary.generation,
        fallbackReason: `LLM generation failed: ${(error as Error).message}`,
      },
    };

    return {
      summary: failedFallbackSummary,
      summaryMarkdown: renderMarkdown(failedFallbackSummary),
      generationMeta: {
        ...failedFallbackSummary.generation,
        ...promptInput.stats,
      },
    };
  }
}


