import { z } from 'zod';

export const DAILY_REPORT_PROMPT_VERSION = 'daily-report-v2';

export type DailyReportWindow = {
  businessDate: string;
  timeZone: string;
  closeTimeLocal: string;
  startAt: string;
  endAt: string;
};

export type DailyReportSettingRecord = {
  projectId: string;
  enabled: boolean;
  timezone: string;
  businessDayCloseTimeLocal: string;
  systemPrompt: string;
  promptTemplate: string;
  generateWhenNoVisit: boolean;
  modelProviderOverride: 'volcengine' | 'fallback' | null;
  modelNameOverride: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DailyReportExecutionSnapshot = {
  generateWhenNoVisit: boolean;
  promptSnapshot: string;
  modelProvider: 'volcengine' | 'fallback';
  modelName: string;
};

export type DailyReportSourceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | string;
  content: string;
  createdAt: string;
};

export type DailyReportSourceTopic = {
  topicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: DailyReportSourceMessage[];
};

export type DailyReportSourceCustomer = {
  userId: string;
  displayName: string;
  email: string | null;
  managedSessionId: string;
  managedSessionTitle: string | null;
  topics: DailyReportSourceTopic[];
};

export type DailyReportSourcePayload = {
  project: {
    projectId: string;
    projectName: string;
    description: string | null;
  };
  window: DailyReportWindow;
  customers: DailyReportSourceCustomer[];
  metrics: {
    visitedCustomerCount: number;
    activeTopicCount: number;
    totalMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  };
};

const concernLabelSchema = z.string().trim().min(1).max(60);

const keyCustomerGroupSchema = z.object({
  groupId: z.string().trim().min(1),
  topicId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  ownerDisplayName: z.string().trim().min(1),
  ownerEmail: z.string().trim().email().nullable(),
  intentBand: z.enum(['A', 'B', 'C', 'D']).nullable(),
  intentGrade: z.string().trim().min(1).max(20).nullable(),
  firstMessageAt: z.string().trim().min(1),
  lastMessageAt: z.string().trim().min(1),
  totalMessageCount: z.number().int().min(0),
  userMessageCount: z.number().int().min(0),
  assistantMessageCount: z.number().int().min(0),
  stage: z.string().trim().min(1).max(40),
  intentLevel: z.enum(['high', 'medium', 'low', 'unknown']),
  riskLevel: z.enum(['high', 'medium', 'low']),
  overallSummary: z.string().trim().min(1).max(800),
  initialCustomerMessage: z.string().trim().min(1).max(400).nullable(),
  mainConcerns: z.array(concernLabelSchema).max(8),
  managementNeed: z.string().trim().min(1).max(240),
  recommendedAction: z.string().trim().min(1).max(240),
  evidenceMessageIds: z.array(z.string().trim().min(1)).max(20),
});

const commonConcernSchema = z.object({
  label: concernLabelSchema,
  count: z.number().int().min(0),
  detail: z.string().trim().min(1).max(300),
  topicIds: z.array(z.string().trim().min(1)).max(50),
});

const managementFocusSchema = z.object({
  title: z.string().trim().min(1).max(120),
  severity: z.enum(['high', 'medium', 'low']),
  detail: z.string().trim().min(1).max(400),
  relatedTopicIds: z.array(z.string().trim().min(1)).max(50),
});

const managementActionSchema = z.object({
  actionType: z.enum([
    'inventory_release',
    'pricing_policy',
    'sales_collateral',
    'revisit_campaign',
    'channel_expansion',
    'broker_incentive',
  ]),
  title: z.string().trim().min(1).max(120),
  priority: z.enum(['high', 'medium', 'low']),
  detail: z.string().trim().min(1).max(400),
  reason: z.string().trim().min(1).max(280),
  relatedTopicIds: z.array(z.string().trim().min(1)).max(50),
});

export const dailyReportSummarySchema = z.object({
  schemaVersion: z.literal(2),
  overview: z.object({
    projectId: z.string().trim().min(1),
    projectName: z.string().trim().min(1),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().trim().min(1),
    windowStartAt: z.string().trim().min(1),
    windowEndAt: z.string().trim().min(1),
    headline: z.string().trim().min(1).max(200),
    executiveSummary: z.string().trim().min(1).max(1500),
  }),
  stats: z.object({
    visitedGroupCount: z.number().int().min(0),
    aIntentGroupCount: z.number().int().min(0),
    bIntentGroupCount: z.number().int().min(0),
    cIntentGroupCount: z.number().int().min(0),
    dIntentGroupCount: z.number().int().min(0),
    missingIntentGroupCount: z.number().int().min(0),
    highIntentGroupCount: z.number().int().min(0),
    mediumIntentGroupCount: z.number().int().min(0),
    lowIntentGroupCount: z.number().int().min(0),
    highRiskGroupCount: z.number().int().min(0),
    activeTopicCount: z.number().int().min(0),
    totalMessageCount: z.number().int().min(0),
    userMessageCount: z.number().int().min(0),
    assistantMessageCount: z.number().int().min(0),
  }),
  highlights: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    detail: z.string().trim().min(1).max(500),
    relatedTopicIds: z.array(z.string().trim().min(1)).max(50),
  })).max(8),
  keyCustomerGroups: z.array(keyCustomerGroupSchema).max(100),
  missingInfoCustomers: z.array(keyCustomerGroupSchema).max(100),
  commonConcerns: z.array(commonConcernSchema).max(20),
  managementFocus: z.array(managementFocusSchema).max(20),
  managementActions: z.array(managementActionSchema).max(20),
  generation: z.object({
    promptVersion: z.string().trim().min(1),
    modelProvider: z.string().trim().min(1),
    modelName: z.string().trim().min(1),
    sourceTopicCount: z.number().int().min(0),
    sourceMessageCount: z.number().int().min(0),
    includedMessageCount: z.number().int().min(0),
    truncatedMessageCount: z.number().int().min(0),
    generatedAt: z.string().trim().min(1),
    mode: z.enum(['llm', 'fallback']),
    fallbackReason: z.string().trim().min(1).nullable(),
  }),
});

export type DailyReportSummary = z.infer<typeof dailyReportSummarySchema>;

export type DailyReportGenerationResult = {
  summary: DailyReportSummary;
  summaryMarkdown: string;
  generationMeta: Record<string, unknown>;
};
