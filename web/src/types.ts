export type UserOption = {
  id: string;
  email: string | null;
  avatar: string | null;
  displayName: string;
};

export type ActorContext = {
  actor: UserOption;
  isSystemAdmin: boolean;
  managedProjectCount: number;
  joinedProjectCount: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
  adminCount?: number;
  memberCount?: number;
  admin_count?: string;
  member_count?: string;
  actorRole?: 'system_admin' | 'admin' | 'member';
  actor_role?: 'system_admin' | 'admin' | 'member';
};

export type ProjectMember = {
  userId: string;
  role: 'admin' | 'member';
  joinedAt: string;
  email: string | null;
  avatar: string | null;
  displayName: string;
  assistantCount: number;
  assistants: ProjectMemberAssistant[];
  projectManagedAssistantId: string | null;
  projectManagedAssistantTitle: string | null;
  projectManagedStatus: 'provisioned' | 'failed' | 'skipped' | null;
  projectManagedMessage: string | null;
};

export type ProjectMemberAssistant = {
  id: string;
  title: string | null;
  slug: string | null;
  updatedAt: string;
  isProjectManaged: boolean;
  managedStatus: 'provisioned' | 'failed' | 'skipped' | null;
};

export type ProjectTemplate = {
  project_id: string;
  template_user_id: string | null;
  template_agent_id: string | null;
  copy_skills?: boolean;
  updated_at: string;
  updated_by?: string | null;
  template_user_email?: string | null;
  template_user_display_name?: string | null;
  template_agent_title?: string | null;
  template_skill_count?: string | number;
};

export type AgentOption = {
  id: string;
  title: string | null;
  slug: string | null;
  updatedAt: string;
  skillCount: number;
};

export type JobDetail = {
  id: string;
  project_id: string;
  job_type: string;
  status: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
};

export type JobItem = {
  user_id: string;
  user_email?: string | null;
  user_display_name?: string | null;
  status: string;
  message: string | null;
  managed_agent_id: string | null;
  managed_session_id: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type ProjectReportFilters = {
  keyword?: string;
  userId?: string;
  role?: 'all' | 'admin' | 'member';
  managedStatus?: 'all' | 'provisioned' | 'failed' | 'skipped' | 'unconfigured';
  dateField?: 'joinedAt' | 'provisionedAt' | 'managedSessionUpdatedAt';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type ProjectReportSummary = {
  totalMembers: number;
  adminCount: number;
  memberCount: number;
  managedMemberCount: number;
  failedManagedCount: number;
  skippedManagedCount: number;
  unconfiguredCount: number;
  assistantCount: number;
  managedSessionCount: number;
  defaultAgentCount: number;
};

export type ProjectReportRow = {
  userId: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member';
  joinedAt: string;
  assistantCount: number;
  sessionCount: number;
  latestAssistantUpdatedAt: string | null;
  latestSessionUpdatedAt: string | null;
  managedAssistantId: string | null;
  managedAssistantTitle: string | null;
  managedSessionId: string | null;
  managedSessionTitle: string | null;
  managedStatus: 'provisioned' | 'failed' | 'skipped' | 'unconfigured';
  managedMessage: string | null;
  provisionedAt: string | null;
  managedSessionUpdatedAt: string | null;
  lastJobId: string | null;
  lastJobStatus: string | null;
  lastJobFinishedAt: string | null;
  isDefaultAgent: boolean;
};

export type ProjectReportJob = {
  id: string;
  jobType: 'configure' | 'refresh';
  status: string;
  totalCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdByName: string | null;
};

export type ProjectReportResult = {
  summary: ProjectReportSummary;
  rows: ProjectReportRow[];
  recentJobs: ProjectReportJob[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type ProjectTopicStatsRangePreset = 'today' | 'last3days' | 'last7days' | 'last30days' | 'custom';

export type ProjectTopicStatsFilters = {
  rangePreset?: ProjectTopicStatsRangePreset;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
};

export type ProjectTopicStatsSummary = {
  totalMembers: number;
  adminCount: number;
  memberCount: number;
  managedSessionCount: number;
  activeMemberCount: number;
  inactiveMemberCount: number;
  totalTopics: number;
  firstTopicAt: string | null;
  lastTopicAt: string | null;
};

export type ProjectTopicStatsRow = {
  userId: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member';
  joinedAt: string;
  managedSessionId: string | null;
  managedSessionTitle: string | null;
  topicCount: number;
  firstTopicAt: string | null;
  lastTopicAt: string | null;
};

export type ProjectTopicStatsResult = {
  range: {
    rangePreset: ProjectTopicStatsRangePreset;
    dateFrom: string;
    dateTo: string;
  };
  summary: ProjectTopicStatsSummary;
  rows: ProjectTopicStatsRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type ProjectTopicListMember = {
  userId: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member';
  joinedAt: string;
  managedSessionId: string | null;
  managedSessionTitle: string | null;
};

export type ProjectTopicListItem = {
  topicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  preview: string | null;
};

export type ProjectTopicListResult = {
  range: {
    rangePreset: ProjectTopicStatsRangePreset;
    dateFrom: string;
    dateTo: string;
  };
  member: ProjectTopicListMember;
  topics: ProjectTopicListItem[];
};

export type ProjectTopicMessage = {
  id: string;
  role: string;
  content: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTopicDetail = {
  topicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
  displayName: string;
  email: string | null;
  managedSessionId: string | null;
  managedSessionTitle: string | null;
};

export type ProjectTopicDetailResult = {
  topic: ProjectTopicDetail;
  messages: ProjectTopicMessage[];
};

export type DatabaseTableOption = {
  schema: string;
  name: string;
  fullName: string;
};

export type DatabaseAccessScope = {
  mode: 'system' | 'project';
  allowedSchemas: string[];
  projectNames: string[];
  projectFieldName: 'project';
};

export type DatabaseTableListResult = {
  tables: DatabaseTableOption[];
  accessScope: DatabaseAccessScope;
};

export type DatabaseTableColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
};

export type DatabaseTableDataResult = {
  table: DatabaseTableOption;
  columns: DatabaseTableColumn[];
  rows: Record<string, unknown>[];
  accessScope: DatabaseAccessScope;
  projectColumnPresent: boolean;
  emptyReason?: string | null;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
