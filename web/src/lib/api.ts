import type {
  AgentOption,
  ActorContext,
  DatabaseTableListResult,
  DatabaseTableDataResult,
  JobDetail,
  JobItem,
  DailyReportJob,
  ProjectMember,
  ProjectMemberAssistantDetail,
  ProjectDailyReportDetailResult,
  ProjectDailyReportListFilters,
  ProjectDailyReportListResult,
  ProjectDailyReportSettings,
  ProjectReportFilters,
  ProjectReportResult,
  ProjectTopicDetailResult,
  ProjectTopicStatsFilters,
  ProjectTopicListResult,
  ProjectTopicStatsResult,
  ProjectSummary,
  ProjectTemplate,
  UserOption,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3321';

type RequestOptions = {
  method?: string;
  actorId?: string;
  body?: unknown;
};

function createHeaders(options: RequestOptions) {
  const headers: Record<string, string> = {
    ...(options.actorId ? { 'x-admin-user-id': options.actorId } : {}),
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: createHeaders(options),
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const errorBody = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(errorBody?.message || `Request failed: ${response.status}`);
    }

    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function requestBlob(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: createHeaders(options),
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const errorBody = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(errorBody?.message || `Request failed: ${response.status}`);
    }

    const errorText = await response.text();
    throw new Error(errorText || `Request failed: ${response.status}`);
  }

  return response.blob();
}

export const api = {
  login: async (email: string, password: string) =>
    request<ActorContext>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    }),

  logout: async () =>
    request<void>('/api/auth/logout', {
      method: 'POST',
    }),

  getActorContext: async (actorId?: string) =>
    request<ActorContext>('/api/me/context', {
      actorId,
    }),

  listDatabaseTables: async (actorId: string) =>
    request<DatabaseTableListResult>('/api/system/database/tables', {
      actorId,
    }),

  getDatabaseTableData: async (
    actorId: string,
    params: { schema: string; table: string; page?: number; pageSize?: number },
  ) =>
    request<DatabaseTableDataResult>(
      `/api/system/database/table-data${buildQueryString(params)}`,
      {
        actorId,
      },
    ),

  searchUsers: async (actorId: string, keyword: string) =>
    request<{ users: UserOption[] }>(`/api/users?q=${encodeURIComponent(keyword)}`, {
      actorId,
    }),

  listProjects: async (actorId: string) =>
    request<{ projects: ProjectSummary[] }>('/api/projects', {
      actorId,
    }),

  createProject: async (actorId: string, payload: { name: string; description?: string; adminUserIds: string[] }) =>
    request<{ projectId: string }>('/api/projects', {
      method: 'POST',
      actorId,
      body: payload,
    }),

  deleteProject: async (actorId: string, projectId: string) =>
    request<void>(`/api/projects/${projectId}`, {
      method: 'DELETE',
      actorId,
    }),

  getProject: async (actorId: string, projectId: string) =>
    request<{ project: ProjectSummary | null }>(`/api/projects/${projectId}`, {
      actorId,
    }),

  getMembers: async (actorId: string, projectId: string) =>
    request<{ admins: ProjectMember[]; members: ProjectMember[] }>(`/api/projects/${projectId}/members`, {
      actorId,
    }),

  getProjectMemberAssistantDetail: async (
    actorId: string,
    projectId: string,
    userId: string,
    assistantId: string,
  ) =>
    request<{ assistant: ProjectMemberAssistantDetail }>(
      `/api/projects/${projectId}/agents?userId=${encodeURIComponent(userId)}&agentId=${encodeURIComponent(assistantId)}`,
      {
        actorId,
      },
    ),

  addMembers: async (actorId: string, projectId: string, emails: string[], role: 'admin' | 'member') =>
    request<{
      results: Array<{
        email: string;
        userId: string | null;
        status: string;
        message: string;
      }>;
    }>(`/api/projects/${projectId}/members`, {
      method: 'POST',
      actorId,
      body: { emails, role },
    }),

  updateMemberRole: async (actorId: string, projectId: string, userId: string, role: 'admin' | 'member') =>
    request<void>(`/api/projects/${projectId}/members/${userId}/role`, {
      method: 'PUT',
      actorId,
      body: { role },
    }),

  removeMember: async (actorId: string, projectId: string, userId: string) =>
    request<void>(`/api/projects/${projectId}/members/${userId}`, {
      method: 'DELETE',
      actorId,
    }),

  getTemplate: async (actorId: string, projectId: string) =>
    request<{ template: ProjectTemplate | null }>(`/api/projects/${projectId}/template`, {
      actorId,
    }),

  setTemplate: async (
    actorId: string,
    projectId: string,
    payload: { templateUserId: string; templateAgentId: string; copySkills: boolean },
  ) =>
    request<{ template: ProjectTemplate | null }>(`/api/projects/${projectId}/template`, {
      method: 'PUT',
      actorId,
      body: payload,
    }),

  getAgents: async (actorId: string, projectId: string, adminUserId: string) =>
    request<{ agents: AgentOption[] }>(
      `/api/projects/${projectId}/agents?adminUserId=${encodeURIComponent(adminUserId)}`,
      { actorId },
    ),

  runProvision: async (actorId: string, projectId: string, setDefaultAgent: boolean) =>
    request<{ jobId: string }>(`/api/projects/${projectId}/provision`, {
      method: 'POST',
      actorId,
      body: { setDefaultAgent },
    }),

  runRefresh: async (actorId: string, projectId: string, setDefaultAgent: boolean) =>
    request<{ jobId: string }>(`/api/projects/${projectId}/provision/refresh`, {
      method: 'POST',
      actorId,
      body: { setDefaultAgent },
    }),

  getJob: async (actorId: string, projectId: string, jobId: string) =>
    request<{ job: JobDetail | null; items: JobItem[] }>(`/api/projects/${projectId}/jobs/${jobId}`, {
      actorId,
    }),

  getProjectReport: async (actorId: string, projectId: string, filters: ProjectReportFilters) =>
    request<ProjectReportResult>(
      `/api/projects/${projectId}/reports/member-activity${buildQueryString(filters)}`,
      {
        actorId,
      },
    ),

  exportProjectReport: async (actorId: string, projectId: string, filters: ProjectReportFilters) =>
    requestBlob(
      `/api/projects/${projectId}/reports/member-activity/export${buildQueryString(filters)}`,
      { actorId },
    ),

  getProjectTopicStats: async (actorId: string, projectId: string, filters: ProjectTopicStatsFilters) =>
    request<ProjectTopicStatsResult>(
      `/api/projects/${projectId}/reports/topic-stats${buildQueryString(filters)}`,
      {
        actorId,
      },
    ),

  getProjectUserTopics: async (actorId: string, projectId: string, userId: string, filters: ProjectTopicStatsFilters) =>
    request<ProjectTopicListResult>(
      `/api/projects/${projectId}/reports/topic-stats/users/${encodeURIComponent(userId)}/topics${buildQueryString(filters)}`,
      {
        actorId,
      },
    ),

  getProjectTopicDetail: async (actorId: string, projectId: string, topicId: string) =>
    request<ProjectTopicDetailResult>(
      `/api/projects/${projectId}/reports/topic-stats/topics/${encodeURIComponent(topicId)}`,
      {
        actorId,
      },
    ),

  getProjectDailyReportSettings: async (actorId: string, projectId: string) =>
    request<{ settings: ProjectDailyReportSettings }>(
      `/api/projects/${projectId}/reports/daily-settings`,
      { actorId },
    ),

  updateProjectDailyReportSettings: async (
    actorId: string,
    projectId: string,
    payload: Omit<ProjectDailyReportSettings, 'projectId' | 'systemPrompt' | 'updatedBy' | 'createdAt' | 'updatedAt'>,
  ) =>
    request<{ settings: ProjectDailyReportSettings }>(
      `/api/projects/${projectId}/reports/daily-settings`,
      {
        method: 'PUT',
        actorId,
        body: payload,
      },
    ),

  listProjectDailyReports: async (actorId: string, projectId: string, filters: ProjectDailyReportListFilters) =>
    request<ProjectDailyReportListResult>(
      `/api/projects/${projectId}/reports/daily-reports${buildQueryString(filters)}`,
      { actorId },
    ),

  getProjectDailyReportDetail: async (actorId: string, projectId: string, reportId: string) =>
    request<ProjectDailyReportDetailResult>(
      `/api/projects/${projectId}/reports/daily-reports/${encodeURIComponent(reportId)}`,
      { actorId },
    ),

  runProjectDailyReport: async (actorId: string, projectId: string, businessDate?: string) =>
    request<{ jobId: string | null; businessDate: string }>(
      `/api/projects/${projectId}/reports/daily-reports/run`,
      {
        method: 'POST',
        actorId,
        body: businessDate ? { businessDate } : {},
      },
    ),

  listProjectDailyReportJobs: async (actorId: string, projectId: string) =>
    request<{ jobs: DailyReportJob[] }>(
      `/api/projects/${projectId}/reports/daily-jobs`,
      { actorId },
    ),

  getProjectDailyReportJob: async (actorId: string, projectId: string, jobId: string) =>
    request<{ job: DailyReportJob }>(
      `/api/projects/${projectId}/reports/daily-jobs/${encodeURIComponent(jobId)}`,
      { actorId },
    ),
};
