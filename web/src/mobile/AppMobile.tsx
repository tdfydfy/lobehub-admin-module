import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ProjectCustomerAnalysisMobilePage } from './ProjectCustomerAnalysisMobilePage';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type {
  ActorContext,
  DailyReportJob,
  JobDetail,
  JobItem,
  MobileProjectSummaryResult,
  ProjectOverviewResult,
  ProjectDailyReportDetail,
  ProjectDailyReportListResult,
  ProjectDailyReportSettings,
  ProjectMember,
  ProjectMemberAssistant,
  ProjectReportJob,
  ProjectSummary,
  ProjectTemplate,
  ProjectTopicDetailResult,
  ProjectTopicListResult,
  ProjectTopicStatsFilters,
  ProjectTopicStatsRangePreset,
  ProjectTopicStatsResult,
  ProjectTopicStatsRow,
} from '../types';

type FeedbackTone = 'info' | 'success' | 'danger';
type MobilePage =
  | 'overview'
  | 'members'
  | 'provision'
  | 'analysis'
  | 'topics'
  | 'topicList'
  | 'topicDetail'
  | 'daily'
  | 'dailyDetail'
  | 'more';
type MobileRootTab = 'overview' | 'topics' | 'daily' | 'more';
type MemberFilterKey = 'all' | 'pending' | 'failed' | 'admin' | 'member';
type TopicFilterState = {
  rangePreset: ProjectTopicStatsRangePreset;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};
type NormalizedProject = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  adminCount: number;
  memberCount: number;
  actorRole: 'system_admin' | 'admin' | 'member';
};
type AppFeedback = {
  message: string;
  tone: FeedbackTone;
};
type TopicSelection = {
  member: ProjectTopicStatsRow;
};
type DailySettingsDraft = {
  enabled: boolean;
  timezone: string;
  businessDayCloseTimeLocal: string;
  promptTemplate: string;
  generateWhenNoVisit: boolean;
};
type BannerState = {
  message: string;
  tone: FeedbackTone;
};

const rangePresetOptions: Array<{ value: ProjectTopicStatsRangePreset; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'last3days', label: '近3天' },
  { value: 'last7days', label: '近7天' },
  { value: 'last30days', label: '本月' },
  { value: 'custom', label: '自定义' },
];

function normalizeProject(project: ProjectSummary): NormalizedProject {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt ?? project.created_at ?? '',
    updatedAt: project.updatedAt ?? project.updated_at ?? '',
    adminCount: project.adminCount ?? Number(project.admin_count ?? 0),
    memberCount: project.memberCount ?? Number(project.member_count ?? 0),
    actorRole: project.actorRole ?? project.actor_role ?? 'member',
  };
}

function getPreferredProjectId(projects: NormalizedProject[], activeProjectId?: string | null) {
  if (activeProjectId && projects.some((project) => project.id === activeProjectId)) {
    return activeProjectId;
  }

  return projects.find((project) => project.actorRole === 'admin')?.id ?? projects[0]?.id ?? '';
}

function createDefaultTopicFilters(): TopicFilterState {
  return {
    rangePreset: 'today',
    dateFrom: '',
    dateTo: '',
    page: 1,
    pageSize: 20,
  };
}

function createDefaultDailySettingsDraft(): DailySettingsDraft {
  return {
    enabled: false,
    timezone: 'Asia/Shanghai',
    businessDayCloseTimeLocal: '22:00:00',
    promptTemplate: '',
    generateWhenNoVisit: true,
  };
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTopicFilters(filters: TopicFilterState): ProjectTopicStatsFilters {
  const normalized: ProjectTopicStatsFilters = {
    rangePreset: filters.rangePreset,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  if (filters.rangePreset === 'custom') {
    normalized.dateFrom = filters.dateFrom;
    normalized.dateTo = filters.dateTo;
  }

  return normalized;
}

function getTopicFilterValidationMessage(filters: Pick<TopicFilterState, 'rangePreset' | 'dateFrom' | 'dateTo'>) {
  if (filters.rangePreset !== 'custom') {
    return '';
  }

  if (!filters.dateFrom || !filters.dateTo) {
    return '自定义范围需要同时填写开始日期和结束日期。';
  }

  if (filters.dateFrom > filters.dateTo) {
    return '开始日期不能晚于结束日期。';
  }

  return '';
}

function normalizeSettingsToDraft(settings: ProjectDailyReportSettings): DailySettingsDraft {
  return {
    enabled: settings.enabled,
    timezone: settings.timezone,
    businessDayCloseTimeLocal: settings.businessDayCloseTimeLocal,
    promptTemplate: settings.promptTemplate,
    generateWhenNoVisit: settings.generateWhenNoVisit,
  };
}

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function formatRole(role: 'system_admin' | 'admin' | 'member') {
  if (role === 'system_admin') return '系统管理员';
  return role === 'admin' ? '管理员' : '成员';
}

function formatMessageRole(role: string) {
  switch (role) {
    case 'assistant':
      return '助手';
    case 'system':
      return '系统';
    case 'tool':
      return '工具';
    case 'user':
    default:
      return '用户';
  }
}

function getMemberStatusLabel(member: Pick<ProjectMember, 'projectManagedStatus'>) {
  if (member.projectManagedStatus === 'provisioned') return '已配置';
  if (member.projectManagedStatus === 'failed') return '分配失败';
  if (member.projectManagedStatus === 'skipped') return '已跳过';
  return '未分配';
}

function getProvisionJobLabel(jobType: string) {
  return jobType === 'refresh' ? '助手刷新' : '助手配置';
}

function getProvisionStatusLabel(status: string) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'partial':
      return '部分完成';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    case 'pending':
      return '等待中';
    default:
      return status;
  }
}

function getDailyJobStatusLabel(status: DailyReportJob['status']) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    case 'pending':
      return '等待中';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function getRootTabForPage(page: MobilePage, canAccessDaily: boolean): MobileRootTab {
  if (page === 'topics' || page === 'topicList' || page === 'topicDetail') {
    return 'topics';
  }

  if (page === 'daily' || page === 'dailyDetail') {
    return canAccessDaily ? 'daily' : 'more';
  }

  if (page === 'members' || page === 'provision' || page === 'analysis' || page === 'more') {
    return 'more';
  }

  return 'overview';
}

function asObject(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asObject(item)).filter(Boolean) as Array<Record<string, unknown>>
    : [];
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === 'number' ? value : 0;
}

function readStringArray(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function getPrimaryAssistant(member: ProjectMember): ProjectMemberAssistant | null {
  return member.assistants.find((assistant) => assistant.isProjectManaged)
    ?? member.assistants[0]
    ?? null;
}

function getDailyOverview(detail: ProjectDailyReportDetail | null) {
  const summary = asObject(detail?.summaryJson);
  const overview = asObject(summary?.overview);
  const stats = asObject(summary?.stats);
  const rawKeyCustomers = asObjectArray(summary?.keyCustomerGroups);
  const rawMissingCustomers = asObjectArray(summary?.missingInfoCustomers);

  return {
    summary,
    overview,
    stats,
    headline: readString(overview, 'headline') || '暂无标题',
    executiveSummary: readString(overview, 'executiveSummary') || detail?.summaryMarkdown || '暂无摘要',
    highlights: asObjectArray(summary?.highlights),
    keyCustomerGroups: rawKeyCustomers,
    missingInfoCustomers: rawMissingCustomers,
    managementFocus: asObjectArray(summary?.managementFocus),
    managementActions: asObjectArray(summary?.managementActions),
  };
}

function getIntentBand(item: Record<string, unknown>) {
  const intentBand = readString(item, 'intentBand');
  const intentGrade = readString(item, 'intentGrade');

  if (intentBand === 'A' || intentBand === 'B' || intentBand === 'C' || intentBand === 'D') return intentBand;
  if (intentGrade.startsWith('A')) return 'A';
  if (intentGrade.startsWith('B')) return 'B';
  if (intentGrade.startsWith('C')) return 'C';
  if (intentGrade.startsWith('D')) return 'D';
  return '';
}

function getIntentGradeLabel(item: Record<string, unknown>) {
  const rawGrade = readString(item, 'intentGrade');
  const intentBand = getIntentBand(item);

  if (rawGrade) return rawGrade.slice(0, 2);
  if (intentBand) return intentBand;
  return '待补';
}

function normalizeDailyStats(detail: ProjectDailyReportDetail | null, overview: ReturnType<typeof getDailyOverview>) {
  const stats = overview.stats;
  const aCount = readNumber(stats, 'aIntentGroupCount');
  const bCount = readNumber(stats, 'bIntentGroupCount');
  const cCount = readNumber(stats, 'cIntentGroupCount');
  const dCount = readNumber(stats, 'dIntentGroupCount');
  const highIntentCount = aCount + bCount;
  const lowMediumIntentCount = cCount + dCount;
  const visitedCount = readNumber(stats, 'visitedGroupCount') || detail?.visitedCustomerCount || 0;
  const missingCount = readNumber(stats, 'missingIntentGroupCount') || overview.missingInfoCustomers.length;
  const firstVisitCount = readNumber(stats, 'firstVisitGroupCount');
  const revisitCount = readNumber(stats, 'revisitGroupCount');

  return {
    visitedCount,
    firstVisitCount,
    revisitCount,
    aCount,
    bCount,
    cCount,
    dCount,
    highIntentCount,
    lowMediumIntentCount,
    missingCount,
  };
}

function buildOverviewLead(executiveSummary: string) {
  return executiveSummary
    .split(/(?<=[。！？])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.includes('最值得关注的客户') && !item.includes('管理动作') && !item.includes('管理问题与动作'))
    .join('');
}

function buildMobileDailyHeadline(normalizedStats: ReturnType<typeof normalizeDailyStats>) {
  return '今日来访 ' + normalizedStats.visitedCount + ' 组，首访 ' + normalizedStats.firstVisitCount + ' 组，复访 ' + normalizedStats.revisitCount + ' 组，A/B 类 ' + normalizedStats.highIntentCount + ' 组，待补信息 ' + normalizedStats.missingCount + ' 组';
}

function formatPriorityLabel(priority: string) {
  switch (priority) {
    case 'high': return '高优先级';
    case 'medium': return '中优先级';
    case 'low': return '低优先级';
    default: return '待处理';
  }
}

function getPriorityClass(priority: string) {
  switch (priority) {
    case 'high': return 'danger';
    case 'medium': return 'active';
    default: return '';
  }
}

function getManagementProblem(action: Record<string, unknown>) {
  const actionType = readString(action, 'actionType');
  const reason = readString(action, 'reason');

  switch (actionType) {
    case 'inventory_release':
      return '可售房源与楼层口径不足。' + reason;
    case 'pricing_policy':
      return '客户预算与项目价格存在明显错配。' + reason;
    case 'sales_collateral':
      return '客户关注点缺少统一对比资料和销售道具支撑。' + reason;
    case 'revisit_campaign':
      return '客户停留在复访或决策推进环节，缺少统一推进抓手。' + reason;
    case 'channel_expansion':
      return '有效来访偏少，需要补强渠道触达。' + reason;
    case 'broker_incentive':
      return '渠道与中介联动支持不足。' + reason;
    default:
      return reason || '当前存在需要项目端处理的问题。';
  }
}

function buildManagementPairs(actionItems: Array<Record<string, unknown>>) {
  return actionItems.map((action) => ({
    problem: getManagementProblem(action),
    actionTitle: readString(action, 'title'),
    actionDetail: readString(action, 'detail'),
    topicCount: readStringArray(action, 'relatedTopicIds').length,
    priority: readString(action, 'priority'),
  }));
}

function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="mobile-sheet-backdrop" onClick={onClose}>
      <div className="mobile-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-sheet-head">
          <div>
            <p className="mobile-eyebrow">Sheet</p>
            <h3>{title}</h3>
          </div>
          <button className="mobile-button ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileTopBar({
  title,
  projectName,
  roleLabel,
  canGoBack,
  onGoBack,
  onOpenProjects,
}: {
  title: string;
  projectName?: string;
  roleLabel?: string;
  canGoBack: boolean;
  onGoBack: () => void;
  onOpenProjects?: () => void;
}) {
  return (
    <header className="mobile-topbar">
      <div className="mobile-topbar-row">
        {canGoBack ? (
          <button className="mobile-icon-button" type="button" onClick={onGoBack}>
            返回
          </button>
        ) : (
          <span className="mobile-topbar-spacer" />
        )}
        <div className="mobile-topbar-center">
          <p className="mobile-eyebrow">LobeHub Admin</p>
          <h1>{title}</h1>
        </div>
        {onOpenProjects ? (
          <button className="mobile-icon-button" type="button" onClick={onOpenProjects}>
            项目
          </button>
        ) : (
          <span className="mobile-topbar-spacer" />
        )}
      </div>

      {projectName ? (
        <div className="mobile-project-row">
          <strong>{projectName}</strong>
          {roleLabel ? <span className="mobile-role-badge">{roleLabel}</span> : null}
        </div>
      ) : null}
    </header>
  );
}

function MobileBottomNav({
  currentTab,
  canAccessDaily,
  onSelect,
}: {
  currentTab: MobileRootTab;
  canAccessDaily: boolean;
  onSelect: (page: MobileRootTab) => void;
}) {
  const items: Array<{ id: MobileRootTab; label: string }> = canAccessDaily
    ? [
      { id: 'overview', label: '总览' },
      { id: 'topics', label: '对话' },
      { id: 'daily', label: '日报' },
      { id: 'more', label: '更多' },
    ]
    : [
      { id: 'overview', label: '总览' },
      { id: 'topics', label: '对话' },
      { id: 'more', label: '更多' },
    ];

  return (
    <nav className="mobile-bottom-nav">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-bottom-nav-item${currentTab === item.id ? ' active' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function ProjectSwitcherSheet({
  open,
  projects,
  selectedProjectId,
  onClose,
  onSelect,
}: {
  open: boolean;
  projects: NormalizedProject[];
  selectedProjectId: string;
  onClose: () => void;
  onSelect: (projectId: string) => void;
}) {
  return (
    <Sheet open={open} title="切换项目" onClose={onClose}>
      <div className="mobile-stack">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={`mobile-list-button${selectedProjectId === project.id ? ' active' : ''}`}
            onClick={() => {
              onSelect(project.id);
              onClose();
            }}
          >
            <div>
              <strong>{project.name}</strong>
              <p>{project.description || '暂无项目描述'}</p>
            </div>
            <div className="mobile-list-meta">
              <span>{formatRole(project.actorRole)}</span>
              <span>成员 {project.memberCount}</span>
            </div>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function SummaryCard({
  label,
  value,
  meta,
  onClick,
  stacked = false,
}: {
  label: string;
  value: string | number;
  meta: string;
  onClick?: () => void;
  stacked?: boolean;
}) {
  const content = stacked ? (
    <>
      <span className="mobile-stat-label">{label}</span>
      <strong className="mobile-stat-value stacked">{value}</strong>
      <small className="mobile-stat-meta">{meta}</small>
    </>
  ) : (
    <>
      <span className="mobile-stat-label">{label}</span>
      <strong className="mobile-stat-value">{value}</strong>
      <small className="mobile-stat-meta">{meta}</small>
    </>
  );

  if (!onClick) {
    return <article className="mobile-stat-card">{content}</article>;
  }

  return (
    <button type="button" className="mobile-stat-card button" onClick={onClick}>
      {content}
    </button>
  );
}

function MemberCard({
  member,
  onOpen,
}: {
  member: ProjectMember;
  onOpen: () => void;
}) {
  const assistant = getPrimaryAssistant(member);

  return (
    <button type="button" className="mobile-list-button" onClick={onOpen}>
      <div>
        <strong>{member.displayName}</strong>
        <p>{member.email ?? member.userId}</p>
      </div>
      <div className="mobile-list-meta">
        <span>{member.role === 'admin' ? '管理员' : '成员'}</span>
        <span>{getMemberStatusLabel(member)}</span>
        <span>{assistant?.title ?? member.projectManagedAssistantTitle ?? '未关联助手'}</span>
      </div>
    </button>
  );
}

function ProvisionJobSummary({
  latestJob,
  onOpenDetails,
}: {
  latestJob: ProjectReportJob | JobDetail | null;
  onOpenDetails?: () => void;
}) {
  if (!latestJob) {
    return (
      <div className="mobile-card">
        <p className="mobile-eyebrow">Latest Job</p>
        <h3>最近任务</h3>
        <p className="mobile-muted">还没有执行过助手配置任务。</p>
      </div>
    );
  }

  const status = 'jobType' in latestJob ? latestJob.status : latestJob.status;
  const jobLabel = 'jobType' in latestJob ? getProvisionJobLabel(latestJob.jobType) : getProvisionJobLabel(latestJob.job_type);
  const totalCount = 'totalCount' in latestJob ? latestJob.totalCount : latestJob.total_count;
  const successCount = 'successCount' in latestJob ? latestJob.successCount : latestJob.success_count;
  const failedCount = 'failedCount' in latestJob ? latestJob.failedCount : latestJob.failed_count;
  const skippedCount = 'skippedCount' in latestJob ? latestJob.skippedCount : latestJob.skipped_count;
  const startedAt = 'startedAt' in latestJob ? latestJob.startedAt : latestJob.started_at;
  const finishedAt = 'finishedAt' in latestJob ? latestJob.finishedAt : latestJob.finished_at;

  return (
    <div className="mobile-card">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Latest Job</p>
          <h3>最近任务</h3>
        </div>
        {onOpenDetails ? (
          <button className="mobile-button ghost" type="button" onClick={onOpenDetails}>
            查看明细
          </button>
        ) : null}
      </div>
      <div className="mobile-chip-row">
        <span className="mobile-chip active">{jobLabel}</span>
        <span className="mobile-chip">{getProvisionStatusLabel(status)}</span>
      </div>
      <p className="mobile-muted">总数 {totalCount} / 成功 {successCount} / 失败 {failedCount} / 跳过 {skippedCount}</p>
      <p className="mobile-muted">开始 {formatTime(startedAt)} · 结束 {formatTime(finishedAt)}</p>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  createdAt,
}: {
  role: string;
  content: string | null;
  createdAt: string;
}) {
  return (
    <article className={`mobile-message-bubble ${role}`}>
      <div className="mobile-message-head">
        <span className="mobile-role-pill">{formatMessageRole(role)}</span>
        <span>{formatTime(createdAt)}</span>
      </div>
      <pre className="mobile-pre">{content ?? '[empty]'}</pre>
    </article>
  );
}

function RangePresetPills({
  value,
  onChange,
}: {
  value: ProjectTopicStatsRangePreset;
  onChange: (value: ProjectTopicStatsRangePreset) => void;
}) {
  return (
    <div className="mobile-chip-row">
      {rangePresetOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`mobile-chip-button${value === option.value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DailySettingsSheet({
  open,
  loading,
  saving,
  settings,
  draft,
  onClose,
  onChange,
  onSave,
}: {
  open: boolean;
  loading: boolean;
  saving: boolean;
  settings: ProjectDailyReportSettings | null;
  draft: DailySettingsDraft;
  onClose: () => void;
  onChange: (next: Partial<DailySettingsDraft>) => void;
  onSave: () => void;
}) {
  return (
    <Sheet open={open} title="日报设置" onClose={onClose}>
      {loading ? <p className="mobile-muted">正在加载日报设置...</p> : null}
      <div className="mobile-stack">
        <label className="mobile-field">
          <span>启用自动日报</span>
          <select
            value={draft.enabled ? 'enabled' : 'disabled'}
            onChange={(event) => onChange({ enabled: event.target.value === 'enabled' })}
          >
            <option value="enabled">启用</option>
            <option value="disabled">停用</option>
          </select>
        </label>
        <label className="mobile-field">
          <span>时区</span>
          <input value={draft.timezone} onChange={(event) => onChange({ timezone: event.target.value })} placeholder="Asia/Shanghai" />
        </label>
        <label className="mobile-field">
          <span>营业日截点</span>
          <input
            value={draft.businessDayCloseTimeLocal}
            onChange={(event) => onChange({ businessDayCloseTimeLocal: event.target.value })}
            placeholder="22:00:00"
          />
        </label>
        <label className="mobile-field">
          <span>项目补充要求</span>
          <textarea
            rows={5}
            value={draft.promptTemplate}
            onChange={(event) => onChange({ promptTemplate: event.target.value })}
            placeholder="补充今天日报需要强调的项目视角要求"
          />
        </label>
        <label className="mobile-field">
          <span>空来访也生成</span>
          <select
            value={draft.generateWhenNoVisit ? 'yes' : 'no'}
            onChange={(event) => onChange({ generateWhenNoVisit: event.target.value === 'yes' })}
          >
            <option value="yes">是</option>
            <option value="no">否</option>
          </select>
        </label>
        <details className="mobile-details">
          <summary>系统提示词（只读）</summary>
          <pre className="mobile-pre">{settings?.systemPrompt ?? '暂无系统提示词'}</pre>
        </details>
        <button className="mobile-button primary" type="button" disabled={saving} onClick={onSave}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </Sheet>
  );
}

function MobileOverviewPage({
  actorId,
  project,
  projectRole,
  onOpenPage,
  onOpenDailyDetail,
  onFeedback,
}: {
  actorId: string;
  project: NormalizedProject;
  projectRole: 'system_admin' | 'admin' | 'member';
  onOpenPage: (page: MobilePage) => void;
  onOpenDailyDetail: (reportId: string) => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<MobileProjectSummaryResult | null>(null);
  const [overview, setOverview] = useState<ProjectOverviewResult['overview'] | null>(null);
  const [businessDate, setBusinessDate] = useState(getTodayDateString());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      setLoading(true);

      try {
        const [summaryResult, overviewResult] = await Promise.all([
          api.getMobileProjectSummary(actorId, project.id),
          projectRole !== 'member' ? api.getProjectOverview(actorId, project.id, businessDate) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setSummary(summaryResult);
        setOverview(overviewResult?.overview ?? null);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, [actorId, project.id, projectRole, businessDate, refreshKey, onFeedback]);

  const memberSummary = summary?.members ?? null;
  const topicSummary = summary?.topics ?? null;
  const dailySummary = summary?.daily ?? null;
  const latestDailyReport = dailySummary?.latestReport ?? null;
  const desktopLikeStats = overview?.stats ?? null;
  const attentionTopics = overview?.attentionTopics ?? [];
  const attentionMembers = overview?.attentionMembers ?? [];

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Overview</p>
          <h2>{project.name}</h2>
        </div>
        <button className="mobile-button ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
          刷新
        </button>
      </div>

      <div className="mobile-card hero">
        <p>{project.description || '暂无项目描述'}</p>
        <div className="mobile-chip-row">
          <span className="mobile-chip">管理员 {project.adminCount}</span>
          <span className="mobile-chip">成员 {project.memberCount}</span>
          <span className="mobile-chip">更新 {formatTime(project.updatedAt)}</span>
          {overview?.project.businessDate ? <span className="mobile-chip">业务日 {overview.project.businessDate}</span> : null}
        </div>
      </div>

      {loading ? <p className="mobile-muted">正在加载项目总览...</p> : null}

      {projectRole !== 'member' ? (
        <>
          <div className="mobile-card soft">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Business Date</p>
                <h3>查看历史业务日</h3>
              </div>
            </div>
            <div className="mobile-action-row">
              <label className="mobile-field date-field">
                <span>业务日</span>
                <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
              </label>
              <button className="mobile-button ghost" type="button" onClick={() => setBusinessDate(getTodayDateString())}>
                回到今日
              </button>
            </div>
          </div>

          <div className="mobile-grid overview-summary-grid">
            <SummaryCard
              label="今日来访"
              value={desktopLikeStats?.visitCustomerCount ?? 0}
              meta={`首访 ${desktopLikeStats?.firstVisitCount ?? 0} / 复访 ${desktopLikeStats?.revisitCount ?? 0}`}
              onClick={() => onOpenPage('daily')}
            />
            <SummaryCard
              label="高意向"
              value={desktopLikeStats?.highIntentCount ?? 0}
              meta={`A ${desktopLikeStats?.aIntentCount ?? 0} / B ${desktopLikeStats?.bIntentCount ?? 0}`}
              onClick={() => onOpenPage('daily')}
            />
            <SummaryCard
              label="中低意向"
              value={(desktopLikeStats?.cIntentCount ?? 0) + (desktopLikeStats?.dIntentCount ?? 0)}
              meta={`C ${desktopLikeStats?.cIntentCount ?? 0} / D ${desktopLikeStats?.dIntentCount ?? 0}`}
              onClick={() => onOpenPage('daily')}
            />
            <SummaryCard
              label="待补信息"
              value={desktopLikeStats?.missingIntentCount ?? 0}
              meta="独立标签"
              onClick={() => onOpenPage('daily')}
            />
          </div>

          <div className="mobile-chip-row">
            <span className="mobile-chip">新增对话 {desktopLikeStats?.newTopicCount ?? 0}</span>
            <span className="mobile-chip">活跃对话 {desktopLikeStats?.activeTopicCount ?? 0}</span>
            <span className="mobile-chip">活跃成员 {desktopLikeStats?.activeMemberCount ?? 0}</span>
            <span className="mobile-chip">总成员 {memberSummary?.totalMembers ?? 0}</span>
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Quick Actions</p>
                <h3>快捷操作</h3>
              </div>
            </div>
            <div className="mobile-action-row compact">
              <button className="mobile-button primary" type="button" onClick={() => onOpenPage('members')}>
                添加成员
              </button>
              <button className="mobile-button secondary" type="button" onClick={() => onOpenPage('provision')}>
                配置助手
              </button>
              <button className="mobile-button secondary" type="button" onClick={() => onOpenPage('analysis')}>
                自由盘点
              </button>
              <button className="mobile-button secondary" type="button" onClick={() => onOpenPage('daily')}>
                生成日报
              </button>
            </div>
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Priority</p>
                <h3>今日重点客户组</h3>
              </div>
              <button className="mobile-button ghost" type="button" onClick={() => onOpenPage('daily')}>
                查看日报
              </button>
            </div>
            {attentionTopics.length > 0 ? (
              <div className="mobile-stack">
                {attentionTopics.slice(0, 3).map((item) => (
                  <div key={item.topicId} className="mobile-inline-card">
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.ownerDisplayName}</p>
                    </div>
                    <div className="mobile-list-meta">
                      <span>{item.latestIntentGrade ?? item.latestIntentBand ?? '待补信息'}</span>
                      <span>{item.visitType === 'first' ? '首访' : item.visitType === 'revisit' ? '复访' : '待识别'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mobile-muted">当前窗口内暂无重点客户组。</p>
            )}
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Attention Members</p>
                <h3>今日活跃成员</h3>
              </div>
              <button className="mobile-button ghost" type="button" onClick={() => onOpenPage('members')}>
                查看成员
              </button>
            </div>
            {attentionMembers.length > 0 ? (
              <div className="mobile-stack">
                {attentionMembers.slice(0, 3).map((row) => (
                  <div key={row.userId} className="mobile-inline-card">
                    <div>
                      <strong>{row.displayName}</strong>
                      <p>{row.email ?? row.userId}</p>
                    </div>
                    <div className="mobile-list-meta">
                      <span>活跃 {row.activeTopicCount}</span>
                      <span>来访 {row.visitCustomerCount}</span>
                      <span>复访 {row.revisitCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mobile-muted">当前窗口内暂无活跃成员。</p>
            )}
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Latest Daily</p>
                <h3>最新日报</h3>
              </div>
              <button className="mobile-button ghost" type="button" onClick={() => onOpenPage('daily')}>
                查看全部
              </button>
            </div>
            {latestDailyReport ? (
              <button type="button" className="mobile-list-button" onClick={() => onOpenDailyDetail(latestDailyReport.reportId)}>
                <div className="mobile-stack">
                  <strong>{latestDailyReport.businessDate}</strong>
                  <p className="mobile-muted">来访 {latestDailyReport.visitedCustomerCount} / 活跃对话 {latestDailyReport.activeTopicCount}</p>
                  <p className="mobile-muted">生成于 {formatTime(latestDailyReport.generatedAt)}</p>
                </div>
              </button>
            ) : (
              <p className="mobile-muted">当前还没有生成日报。</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mobile-grid overview-summary-grid">
            <SummaryCard
              label="我的对话"
              value={topicSummary?.summary.totalTopics ?? 0}
              meta={`活跃时间 ${formatTime(topicSummary?.summary.lastTopicAt)}`}
              onClick={() => onOpenPage('topics')}
            />
            <SummaryCard
              label="托管会话"
              value={topicSummary?.summary.managedSessionCount ?? 0}
              meta={`活跃成员 ${topicSummary?.summary.activeMemberCount ?? 0}`}
              onClick={() => onOpenPage('topics')}
            />
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Topics</p>
                <h3>我的对话入口</h3>
              </div>
            </div>
            <p className="mobile-muted">当前账号以项目成员身份进入，仅开放自己的对话统计与详情查看。</p>
            <button className="mobile-button primary" type="button" onClick={() => onOpenPage('topics')}>
              查看我的对话
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MobileMembersPage({
  actorId,
  projectId,
  onFeedback,
  onProjectChanged,
}: {
  actorId: string;
  projectId: string;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
  onProjectChanged: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [admins, setAdmins] = useState<ProjectMember[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [filter, setFilter] = useState<MemberFilterKey>('all');
  const [selectedMember, setSelectedMember] = useState<ProjectMember | null>(null);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [memberEmails, setMemberEmails] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);
  const [retrySubmitting, setRetrySubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      setLoading(true);

      try {
        const [memberResult, templateResult] = await Promise.all([
          api.getMembers(actorId, projectId),
          api.getTemplate(actorId, projectId),
        ]);

        if (cancelled) return;
        setAdmins(memberResult.admins);
        setMembers(memberResult.members);
        setTemplate(templateResult.template);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, refreshKey, onFeedback]);

  const rows = [...admins, ...members];
  const filteredRows = rows.filter((member) => {
    switch (filter) {
      case 'admin':
        return member.role === 'admin';
      case 'member':
        return member.role === 'member';
      case 'failed':
        return member.projectManagedStatus === 'failed';
      case 'pending':
        return member.role === 'member' && member.projectManagedStatus !== 'provisioned';
      case 'all':
      default:
        return true;
    }
  });

  async function refreshMembers() {
    setRefreshKey((current) => current + 1);
    await onProjectChanged();
  }

  async function handleAddMembers() {
    const emails = memberEmails
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    if (emails.length === 0) {
      onFeedback('请输入至少一个邮箱', 'danger');
      return;
    }

    setSubmitting(true);

    try {
      const result = await api.addMembers(actorId, projectId, emails, memberRole);
      setMemberEmails('');
      setShowAddMembers(false);
      onFeedback(`成员处理完成：${result.results.map((item) => `${item.email}:${item.status}`).join('，')}`, 'success');
      await refreshMembers();
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRole(member: ProjectMember, role: 'admin' | 'member') {
    const actionLabel = role === 'admin' ? '设为管理员' : '降为成员';
    if (!window.confirm(`确认将 ${member.displayName} ${actionLabel}？`)) return;

    try {
      await api.updateMemberRole(actorId, projectId, member.userId, role);
      onFeedback(`${member.displayName} 已${actionLabel}`, 'success');
      setSelectedMember(null);
      await refreshMembers();
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    }
  }

  async function handleRemoveMember(member: ProjectMember) {
    if (!window.confirm(`确认将 ${member.displayName} 从项目中移除？`)) return;

    try {
      await api.removeMember(actorId, projectId, member.userId);
      onFeedback(`成员已移除：${member.displayName}`, 'success');
      setSelectedMember(null);
      await refreshMembers();
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    }
  }

  async function handleRetryProvision(member: ProjectMember) {
    setRetrySubmitting(true);

    try {
      const result = await api.retryProjectMemberProvision(actorId, projectId, member.userId);
      onFeedback(`已提交成员助手重试任务：${result.jobId}`, 'success');
      await refreshMembers();
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setRetrySubmitting(false);
    }
  }

  const primaryAssistant = selectedMember ? getPrimaryAssistant(selectedMember) : null;
  const selectedMemberIsTemplateUser = selectedMember?.userId === template?.template_user_id;
  const selectedMemberCanDowngrade = Boolean(selectedMember)
    && !selectedMemberIsTemplateUser
    && !(selectedMember?.role === 'admin' && admins.length <= 1);

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Members</p>
          <h2>成员管理</h2>
        </div>
        <button className="mobile-button primary" type="button" onClick={() => setShowAddMembers(true)}>
          添加成员
        </button>
      </div>

      <div className="mobile-chip-row">
        {[
          { key: 'all', label: '全部' },
          { key: 'pending', label: '待处理' },
          { key: 'failed', label: '失败' },
          { key: 'admin', label: '管理员' },
          { key: 'member', label: '成员' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={`mobile-chip-button${filter === item.key ? ' active' : ''}`}
            onClick={() => setFilter(item.key as MemberFilterKey)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? <p className="mobile-muted">正在加载成员列表...</p> : null}

      {filteredRows.length > 0 ? (
        <div className="mobile-stack">
          {filteredRows.map((member) => (
            <MemberCard key={member.userId} member={member} onOpen={() => setSelectedMember(member)} />
          ))}
        </div>
      ) : (
        <div className="mobile-card">
          <p className="mobile-muted">当前筛选条件下没有成员。</p>
        </div>
      )}

      <Sheet open={showAddMembers} title="添加成员" onClose={() => setShowAddMembers(false)}>
        <div className="mobile-stack">
          <label className="mobile-field">
            <span>邮箱列表</span>
            <textarea
              rows={6}
              value={memberEmails}
              onChange={(event) => setMemberEmails(event.target.value)}
              placeholder={'一行一个邮箱\nexample@company.com'}
            />
          </label>
          <label className="mobile-field">
            <span>角色</span>
            <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'admin' | 'member')}>
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button className="mobile-button primary" type="button" disabled={submitting} onClick={() => void handleAddMembers()}>
            {submitting ? '提交中...' : '添加成员'}
          </button>
        </div>
      </Sheet>

      <Sheet open={Boolean(selectedMember)} title={selectedMember?.displayName ?? '成员详情'} onClose={() => setSelectedMember(null)}>
        {selectedMember ? (
          <div className="mobile-stack">
            <div className="mobile-card soft">
              <div className="mobile-chip-row">
                <span className="mobile-chip active">{selectedMember.role === 'admin' ? '管理员' : '成员'}</span>
                <span className="mobile-chip">{getMemberStatusLabel(selectedMember)}</span>
              </div>
              <p>{selectedMember.email ?? selectedMember.userId}</p>
              <p className="mobile-muted">加入时间 {formatTime(selectedMember.joinedAt)}</p>
              {selectedMember.projectManagedMessage ? <p className="mobile-danger-text">{selectedMember.projectManagedMessage}</p> : null}
            </div>

            <div className="mobile-card soft">
              <p className="mobile-eyebrow">Assistant</p>
              <h4>{primaryAssistant?.title ?? selectedMember.projectManagedAssistantTitle ?? '未关联项目助手'}</h4>
              <p className="mobile-muted">模型 {primaryAssistant?.model ?? '-'} / Provider {primaryAssistant?.provider ?? '-'}</p>
              <p className="mobile-muted">技能 {primaryAssistant?.skills?.length ?? 0} / 更新时间 {formatTime(selectedMember.projectManagedUpdatedAt ?? primaryAssistant?.updatedAt)}</p>
            </div>

            {primaryAssistant?.systemRole ? (
              <details className="mobile-details">
                <summary>提示词预览</summary>
                <pre className="mobile-pre">{primaryAssistant.systemRole}</pre>
              </details>
            ) : null}

            {selectedMemberIsTemplateUser ? (
              <p className="mobile-muted">当前成员是模板管理员，不能直接降级或移除。</p>
            ) : null}
            {selectedMember.role === 'admin' && admins.length <= 1 ? (
              <p className="mobile-muted">项目至少需要保留一名管理员。</p>
            ) : null}

            <div className="mobile-action-row">
              {selectedMember.role === 'member' ? (
                <button className="mobile-button primary" type="button" disabled={retrySubmitting} onClick={() => void handleRetryProvision(selectedMember)}>
                  {retrySubmitting ? '提交中...' : '重试配置助手'}
                </button>
              ) : null}
              {selectedMember.role === 'member' ? (
                <button className="mobile-button secondary" type="button" onClick={() => void handleUpdateRole(selectedMember, 'admin')}>
                  设为管理员
                </button>
              ) : (
                <button
                  className="mobile-button secondary"
                  type="button"
                  disabled={!selectedMemberCanDowngrade}
                  onClick={() => void handleUpdateRole(selectedMember, 'member')}
                >
                  降为成员
                </button>
              )}
              <button
                className="mobile-button danger"
                type="button"
                disabled={!selectedMemberCanDowngrade}
                onClick={() => void handleRemoveMember(selectedMember)}
              >
                移除成员
              </button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}

function MobileProvisionPage({
  actorId,
  projectId,
  onFeedback,
  onTaskChanged,
}: {
  actorId: string;
  projectId: string;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
  onTaskChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [admins, setAdmins] = useState<ProjectMember[]>([]);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [templateAdminId, setTemplateAdminId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agents, setAgents] = useState<Array<{ id: string; title: string | null; slug: string | null; updatedAt: string; skillCount: number }>>([]);
  const [copySkills, setCopySkills] = useState(true);
  const [setDefaultAgent, setSetDefaultAgent] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [loadingAgentOptions, setLoadingAgentOptions] = useState(false);
  const [latestJobSummary, setLatestJobSummary] = useState<ProjectReportJob | null>(null);
  const [currentJobId, setCurrentJobId] = useState('');
  const [job, setJob] = useState<JobDetail | null>(null);
  const [jobItems, setJobItems] = useState<JobItem[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadProvisionState() {
      setLoading(true);

      try {
        const [memberResult, templateResult, reportResult] = await Promise.all([
          api.getMembers(actorId, projectId),
          api.getTemplate(actorId, projectId),
          api.getProjectReport(actorId, projectId, { page: 1, pageSize: 1 }),
        ]);

        if (cancelled) return;

        setAdmins(memberResult.admins);
        setTemplate(templateResult.template);
        setTemplateAdminId(templateResult.template?.template_user_id ?? memberResult.admins[0]?.userId ?? '');
        setSelectedAgentId(templateResult.template?.template_agent_id ?? '');
        setCopySkills(templateResult.template?.copy_skills ?? true);
        setLatestJobSummary(reportResult.recentJobs[0] ?? null);
        setCurrentJobId(reportResult.recentJobs[0]?.id ?? '');
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProvisionState();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!templateAdminId) {
      setAgents([]);
      return;
    }

    let cancelled = false;
    setLoadingAgentOptions(true);

    void api.getAgents(actorId, projectId, templateAdminId)
      .then((result) => {
        if (cancelled) return;
        setAgents(result.agents);
        setSelectedAgentId((current) => (
          result.agents.some((agent) => agent.id === current)
            ? current
            : (template?.template_user_id === templateAdminId ? template?.template_agent_id ?? result.agents[0]?.id ?? '' : result.agents[0]?.id ?? '')
        ));
      })
      .catch((error: Error) => {
        if (!cancelled) onFeedback(error.message, 'danger');
      })
      .finally(() => {
        if (!cancelled) setLoadingAgentOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, templateAdminId, template, onFeedback]);

  useEffect(() => {
    if (!currentJobId) return;

    let timer: number | undefined;
    let cancelled = false;

    const pull = async () => {
      try {
        const result = await api.getJob(actorId, projectId, currentJobId);

        if (cancelled) return;
        setJob(result.job);
        setJobItems(result.items);

        if (result.job && ['pending', 'running'].includes(result.job.status)) {
          timer = window.setTimeout(() => void pull(), 2500);
          return;
        }

        if (result.job) {
          onTaskChanged();
          setRefreshKey((current) => current + 1);
        }
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      }
    };

    void pull();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [actorId, currentJobId, onFeedback, onTaskChanged, projectId]);

  const templateDirty = Boolean(templateAdminId && selectedAgentId) && (
    template?.template_user_id !== templateAdminId
    || template?.template_agent_id !== selectedAgentId
    || (template?.copy_skills ?? true) !== copySkills
  );

  async function handleSaveTemplate() {
    if (!templateAdminId || !selectedAgentId) {
      onFeedback('模板管理员和模板助手都必须选择', 'danger');
      return;
    }

    setSavingTemplate(true);

    try {
      const result = await api.setTemplate(actorId, projectId, {
        templateUserId: templateAdminId,
        templateAgentId: selectedAgentId,
        copySkills,
      });
      setTemplate(result.template);
      setEditOpen(false);
      onFeedback('模板已保存', 'success');
      setRefreshKey((current) => current + 1);
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleRunProvision(jobType: 'configure' | 'refresh') {
    if (!template?.template_user_id || !template?.template_agent_id) {
      onFeedback('当前还没有模板，请先保存模板配置', 'danger');
      return;
    }

    if (templateDirty) {
      onFeedback('当前模板有未保存变更，请先保存', 'danger');
      return;
    }

    if (job && ['pending', 'running'].includes(job.status)) {
      onFeedback('当前已有任务在执行，请等待完成后再试', 'danger');
      return;
    }

    setSubmitting(true);

    try {
      const result = jobType === 'configure'
        ? await api.runProvision(actorId, projectId, setDefaultAgent)
        : await api.runRefresh(actorId, projectId, setDefaultAgent);
      setCurrentJobId(result.jobId);
      setDetailOpen(true);
      onFeedback(`任务已启动：${result.jobId}`, 'success');
      onTaskChanged();
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Provision</p>
          <h2>助手分配</h2>
        </div>
        <button className="mobile-button ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
          刷新
        </button>
      </div>

      {loading ? <p className="mobile-muted">正在加载模板和任务状态...</p> : null}

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Template</p>
            <h3>当前模板</h3>
          </div>
          <button className="mobile-button ghost" type="button" onClick={() => setEditOpen(true)}>
            修改模板
          </button>
        </div>
        <p><strong>{template?.template_agent_title ?? '未配置模板助手'}</strong></p>
        <p className="mobile-muted">
          模板管理员 {template?.template_user_display_name ?? template?.template_user_email ?? template?.template_user_id ?? '未配置'}
        </p>
        <p className="mobile-muted">技能数 {template?.template_skill_count ?? 0} / 更新时间 {formatTime(template?.updated_at)}</p>
        {templateDirty ? <p className="mobile-danger-text">当前模板有未保存变更。</p> : null}
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Actions</p>
            <h3>执行同步</h3>
          </div>
        </div>
        <div className="mobile-action-row">
          <button className="mobile-button primary" type="button" disabled={submitting} onClick={() => void handleRunProvision('configure')}>
            配置未分配成员
          </button>
          <button className="mobile-button secondary" type="button" disabled={submitting} onClick={() => void handleRunProvision('refresh')}>
            刷新全部成员
          </button>
        </div>
        <details className="mobile-details">
          <summary>高级选项</summary>
          <label className="mobile-toggle">
            <input type="checkbox" checked={copySkills} onChange={(event) => setCopySkills(event.target.checked)} />
            <span>同步模板技能</span>
          </label>
          <label className="mobile-toggle">
            <input type="checkbox" checked={setDefaultAgent} onChange={(event) => setSetDefaultAgent(event.target.checked)} />
            <span>若无默认助手则写入默认助手</span>
          </label>
          <p className="mobile-muted">当前能力是模板同步，不是逐技能手工分配。</p>
        </details>
      </div>

      <ProvisionJobSummary latestJob={job ?? latestJobSummary} onOpenDetails={currentJobId ? () => setDetailOpen(true) : undefined} />

      <Sheet open={editOpen} title="模板配置" onClose={() => setEditOpen(false)}>
        <div className="mobile-stack">
          <label className="mobile-field">
            <span>模板管理员</span>
            <select value={templateAdminId} onChange={(event) => setTemplateAdminId(event.target.value)}>
              <option value="">请选择管理员</option>
              {admins.map((admin) => (
                <option key={admin.userId} value={admin.userId}>
                  {admin.displayName} ({admin.email ?? admin.userId})
                </option>
              ))}
            </select>
          </label>
          {loadingAgentOptions ? <p className="mobile-muted">正在加载模板助手...</p> : null}
          <div className="mobile-stack">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`mobile-list-button${selectedAgentId === agent.id ? ' active' : ''}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <div>
                  <strong>{agent.title ?? agent.slug ?? agent.id}</strong>
                  <p>更新于 {formatTime(agent.updatedAt)}</p>
                </div>
                <div className="mobile-list-meta">
                  <span>技能 {agent.skillCount}</span>
                </div>
              </button>
            ))}
          </div>
          <button className="mobile-button primary" type="button" disabled={savingTemplate || loadingAgentOptions} onClick={() => void handleSaveTemplate()}>
            {savingTemplate ? '保存中...' : '保存模板'}
          </button>
        </div>
      </Sheet>

      <Sheet open={detailOpen} title="任务明细" onClose={() => setDetailOpen(false)}>
        <div className="mobile-stack">
          {job ? (
            <>
              <p><strong>{getProvisionJobLabel(job.job_type)}</strong> · {getProvisionStatusLabel(job.status)}</p>
              <p className="mobile-muted">总数 {job.total_count} / 成功 {job.success_count} / 失败 {job.failed_count} / 跳过 {job.skipped_count}</p>
              {job.error_message ? <p className="mobile-danger-text">{job.error_message}</p> : null}
            </>
          ) : (
            <p className="mobile-muted">正在加载任务明细...</p>
          )}

          {jobItems.length > 0 ? (
            jobItems.map((item) => (
              <div key={item.user_id} className="mobile-inline-card">
                <div>
                  <strong>{item.user_display_name ?? item.user_email ?? item.user_id}</strong>
                  <p>{item.user_email ?? item.user_id}</p>
                </div>
                <div className="mobile-list-meta">
                  <span>{item.status}</span>
                  <span>{item.message ?? '-'}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="mobile-muted">当前没有可展示的任务明细。</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function MobileTopicsPage({
  actorId,
  projectId,
  projectRole,
  filters,
  setFilters,
  onOpenMember,
  onFeedback,
}: {
  actorId: string;
  projectId: string;
  projectRole: 'system_admin' | 'admin' | 'member';
  filters: TopicFilterState;
  setFilters: (next: TopicFilterState) => void;
  onOpenMember: (selection: TopicSelection) => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ProjectTopicStatsResult | null>(null);
  const filterValidationMessage = getTopicFilterValidationMessage(filters);

  useEffect(() => {
    if (filterValidationMessage) {
      setReport(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadTopicStats() {
      setLoading(true);

      try {
        const result = await api.getProjectTopicStats(actorId, projectId, normalizeTopicFilters(filters));
        if (cancelled) return;
        setReport(result);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTopicStats();

    return () => {
      cancelled = true;
    };
  }, [actorId, filterValidationMessage, filters, onFeedback, projectId]);

  function updateRangePreset(rangePreset: ProjectTopicStatsRangePreset) {
    setFilters({
      ...filters,
      rangePreset,
      dateFrom: rangePreset === 'custom' ? filters.dateFrom : '',
      dateTo: rangePreset === 'custom' ? filters.dateTo : '',
      page: 1,
    });
  }

  function updatePage(nextPage: number) {
    if (!report) return;
    const bounded = Math.max(1, Math.min(nextPage, report.pagination.totalPages));
    setFilters({
      ...filters,
      page: bounded,
    });
  }

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Topics</p>
          <h2>{projectRole === 'member' ? '我的对话' : '对话统计'}</h2>
        </div>
      </div>

      <RangePresetPills value={filters.rangePreset} onChange={updateRangePreset} />

      {filters.rangePreset === 'custom' ? (
        <div className="mobile-grid single">
          <label className="mobile-field">
            <span>开始日期</span>
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value, page: 1 })} />
          </label>
          <label className="mobile-field">
            <span>结束日期</span>
            <input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value, page: 1 })} />
          </label>
        </div>
      ) : null}

      {loading ? <p className="mobile-muted">正在加载对话统计...</p> : null}

      {report ? (
        <>
          <div className="mobile-grid topic-summary-grid">
            <SummaryCard label="活跃成员" value={report.summary.activeMemberCount} meta={`总成员 ${report.summary.totalMembers}`} />
            <SummaryCard label="Topic" value={report.summary.totalTopics} meta={`最近活跃 ${formatTime(report.summary.lastTopicAt)}`} />
          </div>

          <div className="mobile-card">
            <div className="mobile-section-head">
              <div>
                <p className="mobile-eyebrow">Members</p>
                <h3>{projectRole === 'member' ? '我的会话' : '活跃成员'}</h3>
              </div>
            </div>
            {report.rows.length > 0 ? (
              <div className="mobile-stack">
                {report.rows.map((row) => (
                  <button
                    key={row.userId}
                    type="button"
                    className="mobile-list-button"
                    onClick={() => onOpenMember({ member: row })}
                  >
                    <div>
                      <strong>{row.displayName}</strong>
                      <p>{row.managedSessionTitle ?? '未配置托管会话'}</p>
                    </div>
                    <div className="mobile-list-meta">
                      <span>topic {row.topicCount}</span>
                      <span>{formatTime(row.lastTopicAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mobile-muted">当前时间范围内没有活跃对话。</p>
            )}
          </div>

          {report.pagination.totalPages > 1 ? (
            <div className="mobile-pagination">
              <button className="mobile-button ghost" type="button" disabled={report.pagination.page <= 1} onClick={() => updatePage(report.pagination.page - 1)}>
                上一页
              </button>
              <span>第 {report.pagination.page} / {report.pagination.totalPages} 页</span>
              <button className="mobile-button ghost" type="button" disabled={report.pagination.page >= report.pagination.totalPages} onClick={() => updatePage(report.pagination.page + 1)}>
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MobileTopicListPage({
  actorId,
  projectId,
  selection,
  filters,
  onOpenTopic,
  onFeedback,
}: {
  actorId: string;
  projectId: string;
  selection: TopicSelection | null;
  filters: TopicFilterState;
  onOpenTopic: (topicId: string) => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProjectTopicListResult | null>(null);
  const filterValidationMessage = getTopicFilterValidationMessage(filters);

  useEffect(() => {
    if (!selection) return;
    if (filterValidationMessage) {
      setResult(null);
      setLoading(false);
      return;
    }

    const memberUserId = selection.member.userId;
    let cancelled = false;

    async function loadTopicList() {
      setLoading(true);

      try {
        const nextResult = await api.getProjectUserTopics(
          actorId,
          projectId,
          memberUserId,
          normalizeTopicFilters(filters),
        );

        if (cancelled) return;
        setResult(nextResult);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTopicList();

    return () => {
      cancelled = true;
    };
  }, [actorId, filterValidationMessage, filters, onFeedback, projectId, selection]);

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Topic List</p>
          <h2>{selection?.member.displayName ?? '对话清单'}</h2>
        </div>
      </div>

      {result ? (
        <p className="mobile-muted">
          范围 {result.range.dateFrom} ~ {result.range.dateTo} · 会话 {result.member.managedSessionTitle ?? '未配置托管会话'}
        </p>
      ) : null}

      {loading ? <p className="mobile-muted">正在加载对话清单...</p> : null}

      {result ? (
        result.topics.length > 0 ? (
          <div className="mobile-stack">
            {result.topics.map((topic) => (
              <button key={topic.topicId} type="button" className="mobile-list-button" onClick={() => onOpenTopic(topic.topicId)}>
                <div>
                  <strong>{topic.title}</strong>
                  <p>{topic.preview ?? '暂无预览内容'}</p>
                </div>
                <div className="mobile-list-meta">
                  <span>消息 {topic.messageCount}</span>
                  <span>{formatTime(topic.lastMessageAt ?? topic.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mobile-card">
            <p className="mobile-muted">该成员在当前时间范围内没有对话记录。</p>
          </div>
        )
      ) : null}
    </div>
  );
}

function MobileTopicDetailPage({
  actorId,
  projectId,
  topicId,
  onFeedback,
}: {
  actorId: string;
  projectId: string;
  topicId: string | null;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ProjectTopicDetailResult | null>(null);

  useEffect(() => {
    if (!topicId) return;

    const resolvedTopicId = topicId;
    let cancelled = false;

    async function loadTopicDetail() {
      setLoading(true);

      try {
        const result = await api.getProjectTopicDetail(actorId, projectId, resolvedTopicId);
        if (cancelled) return;
        setDetail(result);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTopicDetail();

    return () => {
      cancelled = true;
    };
  }, [actorId, onFeedback, projectId, topicId]);

  return (
    <div className="mobile-page">
      {loading ? <p className="mobile-muted">正在加载对话详情...</p> : null}

      {detail ? (
        <>
          <div className="mobile-card">
            <p className="mobile-eyebrow">Conversation</p>
            <h2>{detail.topic.title}</h2>
            <p className="mobile-muted">{detail.topic.displayName} · {detail.topic.email ?? detail.topic.userId}</p>
            <p className="mobile-muted">创建 {formatTime(detail.topic.createdAt)} · 更新 {formatTime(detail.topic.updatedAt)}</p>
          </div>

          {detail.messages.length > 0 ? (
            <div className="mobile-stack">
              {detail.messages.map((message) => (
                <MessageBubble key={message.id} role={message.role} content={message.content} createdAt={message.createdAt} />
              ))}
            </div>
          ) : (
            <div className="mobile-card">
              <p className="mobile-muted">当前对话下没有可展示的消息内容。</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function MobileDailyPage({
  actorId,
  projectId,
  onOpenDetail,
  onFeedback,
  onTaskChanged,
}: {
  actorId: string;
  projectId: string;
  onOpenDetail: (reportId: string) => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
  onTaskChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<ProjectDailyReportSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<DailySettingsDraft>(createDefaultDailySettingsDraft());
  const [reports, setReports] = useState<ProjectDailyReportListResult | null>(null);
  const [jobs, setJobs] = useState<DailyReportJob[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [runBusinessDate, setRunBusinessDate] = useState('');
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDailyBundle() {
      setLoading(true);

      try {
        const [settingsResult, reportResult, jobsResult] = await Promise.all([
          api.getProjectDailyReportSettings(actorId, projectId),
          api.listProjectDailyReports(actorId, projectId, { page, pageSize: 20 }),
          api.listProjectDailyReportJobs(actorId, projectId),
        ]);

        if (cancelled) return;
        setSettings(settingsResult.settings);
        setSettingsDraft(normalizeSettingsToDraft(settingsResult.settings));
        setReports(reportResult);
        setJobs(jobsResult.jobs);
        const runningJob = jobsResult.jobs.find((job) => job.status === 'pending' || job.status === 'running');
        setActiveJobId(runningJob?.id ?? '');
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDailyBundle();

    return () => {
      cancelled = true;
    };
  }, [actorId, page, projectId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!activeJobId) return;

    let timer: number | undefined;
    let cancelled = false;

    const pull = async () => {
      try {
        const result = await api.getProjectDailyReportJob(actorId, projectId, activeJobId);
        if (cancelled) return;

        setJobs((current) => {
          const next = [...current];
          const index = next.findIndex((job) => job.id === result.job.id);
          if (index >= 0) next[index] = result.job;
          else next.unshift(result.job);
          return next.slice(0, 8);
        });

        if (['pending', 'running'].includes(result.job.status)) {
          timer = window.setTimeout(() => void pull(), 2500);
          return;
        }

        setActiveJobId('');
        onTaskChanged();
        setRefreshKey((current) => current + 1);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      }
    };

    void pull();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeJobId, actorId, onFeedback, onTaskChanged, projectId]);

  async function handleSaveSettings() {
    setSavingSettings(true);

    try {
      const result = await api.updateProjectDailyReportSettings(actorId, projectId, {
        enabled: settingsDraft.enabled,
        timezone: settingsDraft.timezone.trim(),
        businessDayCloseTimeLocal: settingsDraft.businessDayCloseTimeLocal.trim(),
        promptTemplate: settingsDraft.promptTemplate,
        generateWhenNoVisit: settingsDraft.generateWhenNoVisit,
      });
      setSettings(result.settings);
      setSettingsDraft(normalizeSettingsToDraft(result.settings));
      setSettingsOpen(false);
      onFeedback('日报设置已保存', 'success');
      setRefreshKey((current) => current + 1);
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleRunDailyReport() {
    setRunSubmitting(true);

    try {
      const result = await api.runProjectDailyReport(actorId, projectId, runBusinessDate.trim() || undefined);
      if (result.jobId) setActiveJobId(result.jobId);
      setRunBusinessDate('');
      onFeedback(`已提交日报生成任务：${result.businessDate}`, 'success');
      onTaskChanged();
      setRefreshKey((current) => current + 1);
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setRunSubmitting(false);
    }
  }

  const latestReport = reports?.rows[0] ?? null;
  const runningJob = jobs.find((job) => job.status === 'pending' || job.status === 'running') ?? null;

  return (
    <div className="mobile-page">
      <div className="mobile-section-head">
        <div>
          <p className="mobile-eyebrow">Daily Reports</p>
          <h2>项目日报</h2>
        </div>
        <div className="mobile-action-row compact">
          <button className="mobile-button ghost" type="button" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
          <button className="mobile-button ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>
            刷新
          </button>
        </div>
      </div>

      {loading ? <p className="mobile-muted">正在加载日报...</p> : null}

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Generate</p>
            <h3>生成日报</h3>
          </div>
        </div>
        <label className="mobile-field">
          <span>营业日（留空则按当前设置计算）</span>
          <input type="date" value={runBusinessDate} onChange={(event) => setRunBusinessDate(event.target.value)} />
        </label>
        <button className="mobile-button primary" type="button" disabled={runSubmitting || Boolean(runningJob)} onClick={() => void handleRunDailyReport()}>
          {runSubmitting ? '提交中...' : '生成日报'}
        </button>
        {runningJob ? <p className="mobile-muted">当前任务 {runningJob.businessDate} · {getDailyJobStatusLabel(runningJob.status)}</p> : null}
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Latest</p>
            <h3>最新日报</h3>
          </div>
        </div>
        {latestReport ? (
          <button type="button" className="mobile-list-button active" onClick={() => onOpenDetail(latestReport.reportId)}>
            <div>
              <strong>{latestReport.businessDate}</strong>
              <p>来访 {latestReport.visitedCustomerCount} / 活跃对话 {latestReport.activeTopicCount}</p>
            </div>
            <div className="mobile-list-meta">
              <span>{formatTime(latestReport.generatedAt)}</span>
            </div>
          </button>
        ) : (
          <p className="mobile-muted">当前还没有生成日报。</p>
        )}
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">History</p>
            <h3>历史日报</h3>
          </div>
        </div>
        {reports && reports.rows.length > 0 ? (
          <div className="mobile-stack">
            {reports.rows.map((item) => (
              <button key={item.reportId} type="button" className="mobile-list-button" onClick={() => onOpenDetail(item.reportId)}>
                <div>
                  <strong>{item.businessDate}</strong>
                  <p>版本 {item.revision} · 来访 {item.visitedCustomerCount}</p>
                </div>
                <div className="mobile-list-meta">
                  <span>{formatTime(item.generatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="mobile-muted">当前没有日报记录。</p>
        )}

        {reports && reports.pagination.totalPages > 1 ? (
          <div className="mobile-pagination">
            <button className="mobile-button ghost" type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              上一页
            </button>
            <span>第 {reports.pagination.page} / {reports.pagination.totalPages} 页</span>
            <button className="mobile-button ghost" type="button" disabled={page >= reports.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
              下一页
            </button>
          </div>
        ) : null}
      </div>

      <DailySettingsSheet
        open={settingsOpen}
        loading={loading && !settings}
        saving={savingSettings}
        settings={settings}
        draft={settingsDraft}
        onClose={() => setSettingsOpen(false)}
        onChange={(next) => setSettingsDraft((current) => ({ ...current, ...next }))}
        onSave={() => void handleSaveSettings()}
      />
    </div>
  );
}

function MobileDailyDetailPage({
  actorId,
  projectId,
  reportId,
  onOpenTopic,
  onFeedback,
}: {
  actorId: string;
  projectId: string;
  reportId: string | null;
  onOpenTopic: (topicId: string, source?: 'topics' | 'daily') => void;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ProjectDailyReportDetail | null>(null);

  useEffect(() => {
    if (!reportId) return;

    const resolvedReportId = reportId;
    let cancelled = false;

    async function loadDetail() {
      setLoading(true);

      try {
        const result = await api.getProjectDailyReportDetail(actorId, projectId, resolvedReportId);
        if (cancelled) return;
        setDetail(result.report);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [actorId, onFeedback, projectId, reportId]);

  const overview = getDailyOverview(detail);
  const normalizedStats = normalizeDailyStats(detail, overview);
  const managementPairs = buildManagementPairs(overview.managementActions);
  const overviewLead = buildOverviewLead(overview.executiveSummary);
  const displayHeadline = buildMobileDailyHeadline(normalizedStats);

  return (
    <div className="mobile-page">
      {loading ? <p className="mobile-muted">正在加载日报详情...</p> : null}

      {detail ? (
        <>
          <div className="mobile-card">
            <p className="mobile-eyebrow">Overview</p>
            <h2>{displayHeadline}</h2>
            <p>{overviewLead || overview.executiveSummary}</p>
            {overview.keyCustomerGroups.length > 0 ? (
              <div className="mobile-overview-block">
                <strong>最值得关注的客户</strong>
                <div className="mobile-overview-list">
                  {overview.keyCustomerGroups.slice(0, 4).map((item) => (
                    <span key={'overview-key-' + (readString(item, 'topicId') || readString(item, 'title'))}>{readString(item, 'title')}</span>
                  ))}
                </div>
              </div>
            ) : null}
            {managementPairs.length > 0 ? (
              <div className="mobile-overview-block">
                <strong>管理动作</strong>
                <div className="mobile-overview-list">
                  {managementPairs.slice(0, 3).map((item, index) => (
                    <span key={'overview-action-' + item.actionTitle + '-' + index}>{item.actionTitle}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mobile-grid daily-summary-grid">
            <SummaryCard label="今日来访" value={normalizedStats.visitedCount} meta="" stacked />
            <SummaryCard label="首访" value={normalizedStats.firstVisitCount} meta="" stacked />
            <SummaryCard label="复访" value={normalizedStats.revisitCount} meta="" stacked />
            <SummaryCard label={'A/B 类'} value={normalizedStats.highIntentCount} meta={'A类 ' + normalizedStats.aCount + '\n' + 'B类 ' + normalizedStats.bCount} stacked />
            <SummaryCard label="待补信息" value={normalizedStats.missingCount} meta={'独立标签'} stacked />
          </div>

          {overview.keyCustomerGroups.length > 0 ? (
            <div className="mobile-card">
              <p className="mobile-eyebrow">Priority</p>
              <h3>今日重点客户</h3>
              <div className="mobile-stack">
                {overview.keyCustomerGroups.map((item, index) => (
                  <button
                    key={readString(item, 'title') + '-' + index}
                    type="button"
                    className="mobile-list-button mobile-daily-customer-card"
                    onClick={() => onOpenTopic(readString(item, 'topicId'), 'daily')}
                  >
                    <div className="mobile-daily-customer-body">
                      <div className="mobile-customer-head">
                        <div>
                          <strong>{readString(item, 'title')}</strong>
                          <p className="mobile-card-subtitle">销售：{readString(item, 'ownerDisplayName') || '未识别销售员'}</p>
                        </div>
                        <span className={'mobile-chip mobile-intent-chip ' + (getIntentGradeLabel(item) === '待补' ? 'warning' : 'active')}>{getIntentGradeLabel(item)}</span>
                      </div>
                      <p>{readString(item, 'overallSummary')}</p>
                      {getIntentGradeLabel(item) === '待补' && readString(item, 'initialCustomerMessage') ? <p className="mobile-muted">初始描述：{readString(item, 'initialCustomerMessage')}</p> : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {managementPairs.length > 0 ? (
            <div className="mobile-card">
              <p className="mobile-eyebrow">Management</p>
              <h3>管理问题与动作</h3>
              <div className="mobile-stack">
                {managementPairs.slice(0, 5).map((item, index) => (
                  <div key={item.actionTitle + '-' + index} className="mobile-inline-card mobile-management-card">
                    <div className="mobile-management-main">
                      <strong>问题：{item.problem}</strong>
                      <p className="mobile-management-action-title">动作：{item.actionTitle}</p>
                      <p>{item.actionDetail}</p>
                    </div>
                    <div className="mobile-chip-row mobile-management-chips">
                      <span className={'mobile-chip ' + getPriorityClass(item.priority)}>{formatPriorityLabel(item.priority)}</span>
                      {item.topicCount > 0 ? <span className="mobile-chip">{item.topicCount}?</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <details className="mobile-details" open>
            <summary>查看 Markdown 原文</summary>
            <pre className="mobile-pre">{detail.summaryMarkdown}</pre>
          </details>

          <details className="mobile-details">
            <summary>查看结构化 JSON</summary>
            <pre className="mobile-pre">{JSON.stringify(detail.summaryJson, null, 2)}</pre>
          </details>
        </>
      ) : null}
    </div>
  );
}

function MobileMorePage({
  project,
  canManageProject,
  onOpenMembers,
  onOpenProvision,
  onOpenAnalysis,
  onOpenProjects,
  onLogout,
}: {
  project: NormalizedProject;
  canManageProject: boolean;
  onOpenMembers: () => void;
  onOpenProvision: () => void;
  onOpenAnalysis: () => void;
  onOpenProjects: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="mobile-page">
      <div className="mobile-card">
        <p className="mobile-eyebrow">Project</p>
        <h2>{project.name}</h2>
        <p>{project.description || '暂无项目描述'}</p>
        <div className="mobile-chip-row">
          <span className="mobile-chip">管理员 {project.adminCount}</span>
          <span className="mobile-chip">成员 {project.memberCount}</span>
        </div>
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Actions</p>
            <h3>更多操作</h3>
          </div>
        </div>
        <div className="mobile-stack">
          <button className="mobile-list-button" type="button" onClick={onOpenProjects}>
            <div>
              <strong>切换项目</strong>
              <p>在当前账号可访问的项目之间切换</p>
            </div>
          </button>
          {canManageProject ? (
            <>
              <button className="mobile-list-button" type="button" onClick={onOpenMembers}>
                <div>
                  <strong>成员管理</strong>
                  <p>查看成员状态，执行添加、升降级、移除</p>
                </div>
              </button>
              <button className="mobile-list-button" type="button" onClick={onOpenProvision}>
                <div>
                  <strong>助手分配</strong>
                  <p>配置模板助手并发起批量同步</p>
                </div>
              </button>
              <button className="mobile-list-button" type="button" onClick={onOpenAnalysis}>
                <div>
                  <strong>自由盘点</strong>
                  <p>自由输入提示词，提交自由盘点任务并查看结果</p>
                </div>
              </button>
            </>
          ) : null}
          <button className="mobile-list-button danger" type="button" onClick={onLogout}>
            <div>
              <strong>退出登录</strong>
              <p>结束当前移动端后台会话</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppMobile() {
  const [actorInput, setActorInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [actorId, setActorId] = useState('');
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [projects, setProjects] = useState<NormalizedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [currentPage, setCurrentPage] = useState<MobilePage>('overview');
  const [topicFilters, setTopicFilters] = useState<TopicFilterState>(createDefaultTopicFilters());
  const [selectedTopicSelection, setSelectedTopicSelection] = useState<TopicSelection | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedTopicSource, setSelectedTopicSource] = useState<'topics' | 'daily'>('topics');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [feedback, setFeedback] = useState<AppFeedback | null>(null);
  const [taskBanner, setTaskBanner] = useState<BannerState | null>(null);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);

  useEffect(() => {
    const savedActorEmail = window.localStorage.getItem('lobehub-admin-mobile-last-email');
    if (savedActorEmail) {
      setActorInput(savedActorEmail);
    }

    void api.getActorContext()
      .then((result) => {
        setActorInput(result.actor.email ?? savedActorEmail ?? '');
        setActorId(result.actor.id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!feedback) return;

    const timer = window.setTimeout(() => {
      setFeedback(null);
    }, 4000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [feedback]);

  function showFeedback(message: string, tone: FeedbackTone = 'info') {
    setFeedback({ message, tone });
  }

  async function loadAccessBundle(preferredProjectId?: string, resetView = true) {
    if (!actorId) return;

    setLoadingAccess(true);

    try {
      const [contextResult, projectsResult] = await Promise.all([
        api.getActorContext(actorId),
        api.listProjects(actorId),
      ]);

      const normalizedProjects = projectsResult.projects.map(normalizeProject);
      const nextSelectedProjectId = preferredProjectId && normalizedProjects.some((project) => project.id === preferredProjectId)
        ? preferredProjectId
        : getPreferredProjectId(normalizedProjects, contextResult.activeProjectId);

      setActorContext(contextResult);
      setProjects(normalizedProjects);
      setSelectedProjectId(nextSelectedProjectId);
      if (resetView) {
        setCurrentPage('overview');
        setTopicFilters(createDefaultTopicFilters());
        setSelectedTopicSelection(null);
        setSelectedTopicId(null);
        setSelectedTopicSource('topics');
        setSelectedReportId(null);
      }
      showFeedback(`已进入项目工作台：${contextResult.actor.displayName}`, 'success');
    } catch (error) {
      setActorContext(null);
      setProjects([]);
      setSelectedProjectId('');
      showFeedback((error as Error).message, 'danger');
    } finally {
      setLoadingAccess(false);
    }
  }

  useEffect(() => {
    if (!actorId) {
      setActorContext(null);
      setProjects([]);
      setSelectedProjectId('');
      setCurrentPage('overview');
      setTaskBanner(null);
      return;
    }

    void loadAccessBundle(selectedProjectId || undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  useEffect(() => {
    if (actorId && actorInput.trim()) {
      window.localStorage.setItem('lobehub-admin-mobile-last-email', actorInput.trim());
    }
  }, [actorId, actorInput]);

  const currentProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const currentProjectRole = currentProject?.actorRole ?? null;
  const canManageProject = currentProjectRole === 'admin' || currentProjectRole === 'system_admin';
  const canAccessDaily = canManageProject;
  const currentRootTab = getRootTabForPage(currentPage, canAccessDaily);

  useEffect(() => {
    if (!currentProjectRole) return;

    if (!canManageProject && ['members', 'provision', 'analysis', 'daily', 'dailyDetail'].includes(currentPage)) {
      setCurrentPage('overview');
    }
  }, [canManageProject, currentPage, currentProjectRole]);

  useEffect(() => {
    if (!actorId || !currentProject || !canManageProject) {
      setTaskBanner(null);
      return;
    }

    let timer: number | undefined;
    let cancelled = false;

    const loadTaskBanner = async () => {
      try {
        const [reportResult, dailyJobsResult] = await Promise.all([
          api.getProjectReport(actorId, currentProject.id, { page: 1, pageSize: 1 }),
          api.listProjectDailyReportJobs(actorId, currentProject.id),
        ]);

        if (cancelled) return;

        const runningProvisionJob = reportResult.recentJobs.find((job) => ['pending', 'running'].includes(job.status));
        const runningDailyJob = dailyJobsResult.jobs.find((job) => ['pending', 'running'].includes(job.status));

        if (runningProvisionJob) {
          setTaskBanner({
            message: `${getProvisionJobLabel(runningProvisionJob.jobType)}中 · ${runningProvisionJob.successCount + runningProvisionJob.failedCount + runningProvisionJob.skippedCount} / ${runningProvisionJob.totalCount}`,
            tone: 'info',
          });
        } else if (runningDailyJob) {
          setTaskBanner({
            message: `日报生成中 · ${runningDailyJob.businessDate}`,
            tone: 'info',
          });
        } else {
          setTaskBanner(null);
        }

        if (runningProvisionJob || runningDailyJob) {
          timer = window.setTimeout(() => void loadTaskBanner(), 3000);
        }
      } catch {
        if (!cancelled) setTaskBanner(null);
      }
    };

    void loadTaskBanner();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [actorId, canManageProject, currentProject, taskRefreshKey]);

  function navigateRoot(page: MobileRootTab) {
    setCurrentPage(page);

    if (page !== 'topics') {
      setSelectedTopicSelection(null);
      setSelectedTopicId(null);
    }

    if (page !== 'daily') {
      setSelectedReportId(null);
    }
  }

  function handleGoBack() {
    if (currentPage === 'topicDetail') {
      setCurrentPage(selectedTopicSource === 'daily' ? 'dailyDetail' : 'topicList');
      return;
    }

    if (currentPage === 'topicList') {
      setCurrentPage('topics');
      return;
    }

    if (currentPage === 'dailyDetail') {
      setCurrentPage('daily');
      return;
    }

    if (currentPage === 'members' || currentPage === 'provision' || currentPage === 'analysis') {
      setCurrentPage('overview');
    }
  }

  async function handleLogin() {
    const nextActorEmail = actorInput.trim().toLowerCase();

    if (!nextActorEmail) {
      showFeedback('请输入登录邮箱', 'danger');
      return;
    }

    if (!passwordInput) {
      showFeedback('请输入登录密码', 'danger');
      return;
    }

    try {
      const result = await api.login(nextActorEmail, passwordInput);
      setActorId(result.actor.id);
      setActorInput(result.actor.email ?? nextActorEmail);
      setPasswordInput('');
      showFeedback(`已登录：${result.actor.displayName}`, 'success');
    } catch (error) {
      showFeedback((error as Error).message, 'danger');
    }
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch (error) {
      showFeedback((error as Error).message, 'danger');
    }

    setActorId('');
    setActorContext(null);
    setProjects([]);
    setSelectedProjectId('');
    setCurrentPage('overview');
    setPasswordInput('');
    setTaskBanner(null);
    showFeedback('已退出当前后台', 'success');
  }

  async function handleProjectChanged() {
    await loadAccessBundle(selectedProjectId, false);
  }

  function openTopicMember(selection: TopicSelection) {
    setSelectedTopicSelection(selection);
    setSelectedTopicSource('topics');
    setCurrentPage('topicList');
  }

  function openTopicDetail(topicId: string, source: 'topics' | 'daily' = 'topics') {
    setSelectedTopicId(topicId);
    setSelectedTopicSource(source);
    setCurrentPage('topicDetail');
  }

  function openDailyDetail(reportId: string) {
    setSelectedReportId(reportId);
    setCurrentPage('dailyDetail');
  }

  function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    setCurrentPage('overview');
    setTopicFilters(createDefaultTopicFilters());
    setSelectedTopicSelection(null);
    setSelectedTopicId(null);
    setSelectedTopicSource('topics');
    setSelectedReportId(null);
    setTaskRefreshKey((current) => current + 1);
  }

  if (!actorContext && !actorId) {
    return (
      <div className="mobile-shell">
        <MobileTopBar title="移动工作台" canGoBack={false} onGoBack={() => undefined} />
        <main className="mobile-page-shell centered">
          <section className="mobile-login-card">
            <p className="mobile-eyebrow">Entry</p>
            <h2>移动端项目后台</h2>
            <p className="mobile-muted">使用现有后台账号登录，在手机上查看最重要的信息并执行关键操作。</p>
            <label className="mobile-field">
              <span>邮箱</span>
              <input
                value={actorInput}
                onChange={(event) => setActorInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleLogin();
                }}
                placeholder="name@example.com"
              />
            </label>
            <label className="mobile-field">
              <span>密码</span>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleLogin();
                }}
                placeholder="请输入密码"
              />
            </label>
            <button className="mobile-button primary" type="button" onClick={() => void handleLogin()}>
              登录
            </button>
            {feedback ? <div className={`mobile-feedback ${feedback.tone}`}>{feedback.message}</div> : null}
          </section>
        </main>
      </div>
    );
  }

  if (loadingAccess) {
    return (
      <div className="mobile-shell">
        <MobileTopBar title="加载中" canGoBack={false} onGoBack={() => undefined} />
        <main className="mobile-page-shell centered">
          <div className="mobile-card">
            <p className="mobile-muted">正在识别当前角色和项目权限...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!actorContext || projects.length === 0 || !currentProject) {
    return (
      <div className="mobile-shell">
        <MobileTopBar title="暂无项目" canGoBack={false} onGoBack={() => undefined} />
        <main className="mobile-page-shell centered">
          <div className="mobile-card">
            <p className="mobile-eyebrow">No Access</p>
            <h2>当前账号没有可访问项目</h2>
            <p className="mobile-muted">如果这是项目成员或项目管理员账号，请先把它加入项目成员列表；如果这是系统管理员账号，请加入 system_admins。</p>
            <button className="mobile-button ghost" type="button" onClick={() => void handleLogout()}>
              退出登录
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="mobile-shell">
      <MobileTopBar
        title={
          currentPage === 'members' ? '成员管理'
            : currentPage === 'provision' ? '助手分配'
              : currentPage === 'analysis' ? '自由盘点'
                : currentPage === 'topics' ? '对话'
                  : currentPage === 'topicList' ? '对话清单'
                    : currentPage === 'topicDetail' ? '对话详情'
                      : currentPage === 'daily' ? '日报'
                        : currentPage === 'dailyDetail' ? '日报详情'
                          : currentPage === 'more' ? '更多'
                            : '总览'
        }
        projectName={currentProject.name}
        roleLabel={formatRole(currentProjectRole ?? 'member')}
        canGoBack={!['overview', 'topics', 'daily', 'more'].includes(currentPage)}
        onGoBack={handleGoBack}
        onOpenProjects={() => setProjectSwitcherOpen(true)}
      />

      {taskBanner ? <div className={`mobile-banner ${taskBanner.tone}`}>{taskBanner.message}</div> : null}
      {feedback ? <div className={`mobile-feedback ${feedback.tone}`}>{feedback.message}</div> : null}

      <main className="mobile-page-shell">
        {currentPage === 'overview' ? (
          <MobileOverviewPage
            actorId={actorId}
            project={currentProject}
            projectRole={currentProjectRole ?? 'member'}
            onOpenPage={setCurrentPage}
            onOpenDailyDetail={openDailyDetail}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'members' && canManageProject ? (
          <MobileMembersPage
            actorId={actorId}
            projectId={currentProject.id}
            onFeedback={showFeedback}
            onProjectChanged={handleProjectChanged}
          />
        ) : null}

        {currentPage === 'provision' && canManageProject ? (
          <MobileProvisionPage
            actorId={actorId}
            projectId={currentProject.id}
            onFeedback={showFeedback}
            onTaskChanged={() => setTaskRefreshKey((current) => current + 1)}
          />
        ) : null}

        {currentPage === 'analysis' && canManageProject ? (
          <ProjectCustomerAnalysisMobilePage
            actorId={actorId}
            projectId={currentProject.id}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'topics' ? (
          <MobileTopicsPage
            actorId={actorId}
            projectId={currentProject.id}
            projectRole={currentProjectRole ?? 'member'}
            filters={topicFilters}
            setFilters={setTopicFilters}
            onOpenMember={openTopicMember}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'topicList' ? (
          <MobileTopicListPage
            actorId={actorId}
            projectId={currentProject.id}
            selection={selectedTopicSelection}
            filters={topicFilters}
            onOpenTopic={openTopicDetail}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'topicDetail' ? (
          <MobileTopicDetailPage
            actorId={actorId}
            projectId={currentProject.id}
            topicId={selectedTopicId}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'daily' && canAccessDaily ? (
          <MobileDailyPage
            actorId={actorId}
            projectId={currentProject.id}
            onOpenDetail={openDailyDetail}
            onFeedback={showFeedback}
            onTaskChanged={() => setTaskRefreshKey((current) => current + 1)}
          />
        ) : null}

        {currentPage === 'dailyDetail' && canAccessDaily ? (
          <MobileDailyDetailPage
            actorId={actorId}
            projectId={currentProject.id}
            reportId={selectedReportId}
            onOpenTopic={openTopicDetail}
            onFeedback={showFeedback}
          />
        ) : null}

        {currentPage === 'more' ? (
          <MobileMorePage
            project={currentProject}
            canManageProject={canManageProject}
            onOpenMembers={() => setCurrentPage('members')}
            onOpenProvision={() => setCurrentPage('provision')}
            onOpenAnalysis={() => setCurrentPage('analysis')}
            onOpenProjects={() => setProjectSwitcherOpen(true)}
            onLogout={() => void handleLogout()}
          />
        ) : null}
      </main>

      <MobileBottomNav
        currentTab={currentRootTab}
        canAccessDaily={canAccessDaily}
        onSelect={navigateRoot}
      />

      <ProjectSwitcherSheet
        open={projectSwitcherOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onClose={() => setProjectSwitcherOpen(false)}
        onSelect={openProject}
      />
    </div>
  );
}
