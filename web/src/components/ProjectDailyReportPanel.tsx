import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type {
  DailyReportJob,
  ProjectDailyReportDetail,
  ProjectDailyReportListFilters,
  ProjectDailyReportListResult,
  ProjectDailyReportSettings,
  ProjectTopicDetailResult,
} from '../types';

type ProjectDailyReportPanelProps = {
  actorId: string;
  projectId: string;
  onFeedback: (message: string) => void;
};

type SettingsDraft = {
  enabled: boolean;
  timezone: string;
  businessDayCloseTimeLocal: string;
  promptTemplate: string;
  generateWhenNoVisit: boolean;
};

type FilterState = {
  businessDateFrom: string;
  businessDateTo: string;
  page: number;
  pageSize: number;
};

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function createDefaultSettingsDraft(): SettingsDraft {
  return {
    enabled: false,
    timezone: 'Asia/Shanghai',
    businessDayCloseTimeLocal: '22:00:00',
    promptTemplate: '',
    generateWhenNoVisit: true,
  };
}

function createDefaultFilters(): FilterState {
  return {
    businessDateFrom: '',
    businessDateTo: '',
    page: 1,
    pageSize: 20,
  };
}

function normalizeSettingsToDraft(settings: ProjectDailyReportSettings): SettingsDraft {
  return {
    enabled: settings.enabled,
    timezone: settings.timezone,
    businessDayCloseTimeLocal: settings.businessDayCloseTimeLocal,
    promptTemplate: settings.promptTemplate,
    generateWhenNoVisit: settings.generateWhenNoVisit,
  };
}

function normalizeListFilters(filters: FilterState): ProjectDailyReportListFilters {
  return {
    businessDateFrom: filters.businessDateFrom || undefined,
    businessDateTo: filters.businessDateTo || undefined,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

function getJobStatusLabel(status: DailyReportJob['status']) {
  switch (status) {
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'running': return '运行中';
    case 'pending': return '等待中';
    case 'cancelled': return '已取消';
    default: return status;
  }
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

function getIntentGradeLabel(item: Record<string, unknown>) {
  const rawGrade = readString(item, 'intentGrade');
  const intentBand = readString(item, 'intentBand');

  if (rawGrade) return rawGrade;
  if (intentBand) return `${intentBand}类`;
  return '信息不足';
}

function getVisitTypeLabel(item: Record<string, unknown>) {
  const visitType = readString(item, 'visitType');
  if (visitType === 'first') return '首访';
  if (visitType === 'revisit') return '复访';
  return '待识别';
}

function renderCustomerCards(
  items: Array<Record<string, unknown>>,
  onOpenTopic: (topicId: string) => void,
  mode: 'key' | 'missing',
) {
  if (items.length === 0) return null;

  return (
    <div className="daily-report-card-list">
      {items.map((item, index) => {
        const topicId = readString(item, 'topicId');
        const title = readString(item, 'title') || `客户 ${index + 1}`;
        const owner = readString(item, 'ownerDisplayName') || '未识别销售员';
        const summary = readString(item, 'overallSummary') || '暂无结论';
        const lastMessageAt = readString(item, 'lastMessageAt');

        return (
          <article key={`${title}-${topicId || index}`} className="daily-report-customer-card">
            <div className="daily-report-customer-head">
              <div>
                <strong>{title}</strong>
                <p>{summary}</p>
              </div>
              {topicId ? (
                <button className="table-link-button" type="button" onClick={() => onOpenTopic(topicId)}>
                  查看对话
                </button>
              ) : null}
            </div>
            <div className="report-pill-row">
              <span className="report-pill active">{getIntentGradeLabel(item)}</span>
              <span className="report-pill">{getVisitTypeLabel(item)}</span>
              <span className="report-pill">销售 {owner}</span>
              {lastMessageAt ? <span className="report-pill">最近活跃 {formatTime(lastMessageAt)}</span> : null}
            </div>
            {readString(item, 'todayUpdateSummary') ? <p className="muted">本次新增信息：{readString(item, 'todayUpdateSummary')}</p> : null}
            {mode === 'missing' && readString(item, 'initialCustomerMessage') ? (
              <p className="muted">初始描述：{readString(item, 'initialCustomerMessage')}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function renderJsonList(items: Array<Record<string, unknown>>, titleKey: string, detailKey: string, extraKey?: string) {
  if (items.length === 0) return null;

  return (
    <div className="daily-report-card-list">
      {items.map((item, index) => (
        <article key={`${readString(item, titleKey)}-${index}`} className="daily-report-note-card">
          <strong>{readString(item, titleKey)}</strong>
          <p>{readString(item, detailKey)}</p>
          {extraKey ? <p className="muted">{readString(item, extraKey)}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function ProjectDailyReportPanel({
  actorId,
  projectId,
  onFeedback,
}: ProjectDailyReportPanelProps) {
  const [settings, setSettings] = useState<ProjectDailyReportSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => createDefaultSettingsDraft());
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [draftFilters, setDraftFilters] = useState<FilterState>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(() => createDefaultFilters());
  const [reportList, setReportList] = useState<ProjectDailyReportListResult | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [reportDetail, setReportDetail] = useState<ProjectDailyReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topicDetail, setTopicDetail] = useState<ProjectTopicDetailResult | null>(null);
  const [topicDetailLoading, setTopicDetailLoading] = useState(false);
  const [jobs, setJobs] = useState<DailyReportJob[]>([]);
  const [activeJobId, setActiveJobId] = useState('');
  const [runBusinessDate, setRunBusinessDate] = useState('');
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setSettings(null);
    setSettingsDraft(createDefaultSettingsDraft());
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setReportList(null);
    setSelectedReportId('');
    setReportDetail(null);
    setSelectedTopicId(null);
    setTopicDetail(null);
    setJobs([]);
    setActiveJobId('');
    setRunBusinessDate('');
  }, [projectId]);

  useEffect(() => {
    if (!actorId || !projectId) return;
    let cancelled = false;

    void (async () => {
      setSettingsLoading(true);
      try {
        const result = await api.getProjectDailyReportSettings(actorId, projectId);
        if (cancelled) return;
        setSettings(result.settings);
        setSettingsDraft(normalizeSettingsToDraft(result.settings));
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!actorId || !projectId) return;
    let cancelled = false;

    void (async () => {
      setReportsLoading(true);
      try {
        const result = await api.listProjectDailyReports(actorId, projectId, normalizeListFilters(appliedFilters));
        if (cancelled) return;
        setReportList(result);

        if (result.rows.length === 0) {
          setSelectedReportId('');
          setReportDetail(null);
          return;
        }

        if (!result.rows.some((row) => row.reportId === selectedReportId)) {
          setSelectedReportId(result.rows[0]?.reportId ?? '');
        }
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setReportsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, appliedFilters, refreshKey, onFeedback, selectedReportId]);

  useEffect(() => {
    if (!actorId || !projectId || !selectedReportId) return;
    let cancelled = false;

    void (async () => {
      setDetailLoading(true);
      try {
        const result = await api.getProjectDailyReportDetail(actorId, projectId, selectedReportId);
        if (!cancelled) setReportDetail(result.report);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, selectedReportId, onFeedback]);

  useEffect(() => {
    if (!actorId || !projectId || !selectedTopicId) return;
    let cancelled = false;

    void (async () => {
      setTopicDetailLoading(true);
      try {
        const result = await api.getProjectTopicDetail(actorId, projectId, selectedTopicId);
        if (!cancelled) setTopicDetail(result);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setTopicDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, selectedTopicId, onFeedback]);

  useEffect(() => {
    if (!actorId || !projectId) return;
    let cancelled = false;

    void (async () => {
      try {
        const result = await api.listProjectDailyReportJobs(actorId, projectId);
        if (!cancelled) setJobs(result.jobs);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!actorId || !projectId || !activeJobId) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
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

          if (['completed', 'failed', 'cancelled'].includes(result.job.status)) {
            window.clearInterval(timer);
            setActiveJobId('');
            setRefreshKey((value) => value + 1);
          }
        } catch (error) {
          if (!cancelled) onFeedback((error as Error).message);
          window.clearInterval(timer);
          setActiveJobId('');
        }
      })();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [actorId, projectId, activeJobId, onFeedback]);

  const summary = useMemo(() => asObject(reportDetail?.summaryJson), [reportDetail]);
  const schemaVersion = readNumber(summary, 'schemaVersion');
  const summaryOverview = asObject(summary?.overview);
  const summaryStats = asObject(summary?.stats);
  const highlights = asObjectArray(summary?.highlights);
  const keyCustomerGroups = asObjectArray(summary?.keyCustomerGroups);
  const missingInfoCustomers = asObjectArray(summary?.missingInfoCustomers);
  const commonConcerns = asObjectArray(summary?.commonConcerns);
  const managementFocus = asObjectArray(summary?.managementFocus);
  const managementActions = asObjectArray(summary?.managementActions);
  const legacyCustomers = asObjectArray(summary?.customers);
  const legacyRisks = asObjectArray(summary?.risks);
  const legacyFollowUps = asObjectArray(summary?.followUps);
  const runningJob = jobs.find((job) => job.status === 'pending' || job.status === 'running') ?? null;
  const compactBodyText = useMemo(() => {
    if (!reportDetail) return '';

    if (schemaVersion >= 2) {
      const parts = [
        readString(summaryOverview, 'executiveSummary'),
        `今天一共来访 ${readNumber(summaryStats, 'visitedGroupCount')} 组，其中首访 ${readNumber(summaryStats, 'firstVisitGroupCount')} 组，复访 ${readNumber(summaryStats, 'revisitGroupCount')} 组，A 类 ${readNumber(summaryStats, 'aIntentGroupCount')} 组，B 类 ${readNumber(summaryStats, 'bIntentGroupCount')} 组，信息不足 ${readNumber(summaryStats, 'missingIntentGroupCount')} 组。`,
      ];
      const topConcerns = commonConcerns.slice(0, 4).map((item) => readString(item, 'label')).filter(Boolean).join('、');
      const focusItems = managementFocus.slice(0, 3).map((item) => readString(item, 'title')).filter(Boolean).join('；');
      const topActions = managementActions.slice(0, 3).map((item) => readString(item, 'title')).filter(Boolean).join('；');
      const keyGroups = keyCustomerGroups.slice(0, 3).map((item) => readString(item, 'title')).filter(Boolean).join('、');
      const missingGroups = missingInfoCustomers.slice(0, 3).map((item) => readString(item, 'title')).filter(Boolean).join('、');

      if (topConcerns) parts.push(`客户最集中关注的问题是：${topConcerns}。`);
      if (keyGroups) parts.push(`当前优先关注的客户组包括：${keyGroups}。`);
      if (missingGroups) parts.push(`当前仍需补充信息的客户包括：${missingGroups}。`);
      if (focusItems) parts.push(`管理上需要重点留意：${focusItems}。`);
      if (topActions) parts.push(`建议优先推动的动作是：${topActions}。`);

      return parts.filter(Boolean).join('\n\n');
    }

    return readString(summaryOverview, 'executiveSummary') || reportDetail.summaryMarkdown;
  }, [reportDetail, schemaVersion, summaryOverview, summaryStats, commonConcerns, managementFocus, managementActions, keyCustomerGroups, missingInfoCustomers]);

  async function saveSettings() {
    if (!actorId || !projectId) return;
    setSettingsSaving(true);
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
      onFeedback('日报设置已保存');
    } catch (error) {
      onFeedback((error as Error).message);
    } finally {
      setSettingsSaving(false);
    }
  }

  async function runDailyReport() {
    if (!actorId || !projectId) return;
    setRunSubmitting(true);
    try {
      const result = await api.runProjectDailyReport(actorId, projectId, runBusinessDate.trim() || undefined);
      if (result.jobId) setActiveJobId(result.jobId);
      setRefreshKey((value) => value + 1);
      onFeedback(`已提交日报生成任务：${result.businessDate}`);
    } catch (error) {
      onFeedback((error as Error).message);
    } finally {
      setRunSubmitting(false);
    }
  }

  function applyFilters() {
    if (draftFilters.businessDateFrom && draftFilters.businessDateTo && draftFilters.businessDateFrom > draftFilters.businessDateTo) {
      onFeedback('开始日期不能晚于结束日期');
      return;
    }

    setAppliedFilters({
      ...draftFilters,
      page: 1,
    });
  }

  function resetFilters() {
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }

  function changePage(nextPage: number) {
    if (!reportList) return;
    const bounded = Math.max(1, Math.min(nextPage, reportList.pagination.totalPages));
    setAppliedFilters((current) => ({ ...current, page: bounded }));
  }

  return (
    <div className="report-page daily-report-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Daily Settings</p>
            <h3>日报设置</h3>
          </div>
          <span className="muted">{settingsLoading ? '正在加载设置...' : `最近更新 ${formatTime(settings?.updatedAt)}`}</span>
        </div>
        <details className="daily-report-settings-panel">
          <summary>查看和修改设置</summary>
          <div className="daily-report-settings-grid">
            <label className="field"><span>启用自动日报</span><select value={settingsDraft.enabled ? 'enabled' : 'disabled'} onChange={(event) => setSettingsDraft((current) => ({ ...current, enabled: event.target.value === 'enabled' }))}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
            <label className="field"><span>时区</span><input value={settingsDraft.timezone} onChange={(event) => setSettingsDraft((current) => ({ ...current, timezone: event.target.value }))} placeholder="Asia/Shanghai" /></label>
            <label className="field"><span>营业日截止时间</span><input value={settingsDraft.businessDayCloseTimeLocal} onChange={(event) => setSettingsDraft((current) => ({ ...current, businessDayCloseTimeLocal: event.target.value }))} placeholder="22:00:00" /></label>
            <label className="field"><span>无来访也生成</span><select value={settingsDraft.generateWhenNoVisit ? 'yes' : 'no'} onChange={(event) => setSettingsDraft((current) => ({ ...current, generateWhenNoVisit: event.target.value === 'yes' }))}><option value="yes">是</option><option value="no">否</option></select></label>
          </div>
          <label className="field">
            <span>系统提示词</span>
            <textarea rows={6} value={settings?.systemPrompt ?? ""} readOnly />
          </label>
          <label className="field">
            <span>项目补充提示词</span>
            <textarea rows={5} value={settingsDraft.promptTemplate} onChange={(event) => setSettingsDraft((current) => ({ ...current, promptTemplate: event.target.value }))} placeholder="例如：请重点输出今日来访组共性顾虑、管理动作建议和需要提供的销售道具。" />
          </label>
          <div className="report-toolbar">
            <button className="primary" disabled={settingsSaving} onClick={() => void saveSettings()}>保存日报设置</button>
          </div>
        </details>
      </section>

      <section className="section">
        <div className="section-head">
          <div><p className="eyebrow">Generate</p><h3>手动生成</h3></div>
          <span className="muted">{runningJob ? `当前任务 ${runningJob.businessDate} / ${getJobStatusLabel(runningJob.status)}` : '可按指定营业日手动生成'}</span>
        </div>
        <div className="daily-report-run-row">
          <label className="field field-grow"><span>营业日</span><input type="date" value={runBusinessDate} onChange={(event) => setRunBusinessDate(event.target.value)} /></label>
          <button className="primary" disabled={runSubmitting || Boolean(runningJob)} onClick={() => void runDailyReport()}>生成日报</button>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div><p className="eyebrow">Reports</p><h3>日报列表</h3></div>
          <span className="muted">{reportList ? `当前 ${reportList.pagination.total} 条` : '按营业日查看已生成日报'}</span>
        </div>

        <div className="daily-report-filter-grid">
          <label className="field"><span>开始日期</span><input type="date" value={draftFilters.businessDateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, businessDateFrom: event.target.value }))} /></label>
          <label className="field"><span>结束日期</span><input type="date" value={draftFilters.businessDateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, businessDateTo: event.target.value }))} /></label>
          <label className="field"><span>每页</span><select value={String(draftFilters.pageSize)} onChange={(event) => setDraftFilters((current) => ({ ...current, pageSize: Number(event.target.value), page: 1 }))}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label>
        </div>

        <div className="report-toolbar">
          <button className="primary" disabled={reportsLoading} onClick={applyFilters}>查询日报</button>
          <button className="secondary" disabled={reportsLoading} onClick={resetFilters}>重置</button>
          <button className="ghost" disabled={reportsLoading} onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
        </div>

        {reportList && reportList.rows.length > 0 ? (
          <>
            <div className="daily-report-side-list">
              {reportList.rows.map((row) => (
                <button
                  key={row.reportId}
                  type="button"
                  className={`daily-report-side-item${selectedReportId === row.reportId ? ' active' : ''}`}
                  onClick={() => setSelectedReportId(row.reportId)}
                >
                  <strong>{row.businessDate}</strong>
                  <span className="member-subtext">版本 {row.revision}</span>
                  <span className="member-subtext">来访 {row.visitedCustomerCount} / 对话 {row.activeTopicCount}</span>
                  <span className="member-subtext">消息 {row.totalMessageCount}</span>
                  <span className="member-subtext">{formatTime(row.generatedAt)}</span>
                </button>
              ))}
            </div>
            <div className="report-pagination">
              <span className="muted">第 {reportList.pagination.page} / {reportList.pagination.totalPages} 页</span>
              <div className="button-row">
                <button className="ghost" disabled={reportList.pagination.page <= 1} onClick={() => changePage(reportList.pagination.page - 1)}>上一页</button>
                <button className="ghost" disabled={reportList.pagination.page >= reportList.pagination.totalPages} onClick={() => changePage(reportList.pagination.page + 1)}>下一页</button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-card"><p>当前条件下暂无已生成日报。</p></div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <div><p className="eyebrow">Detail</p><h3>日报详情</h3></div>
          <span className="muted">{reportDetail ? `${reportDetail.businessDate} / 版本 ${reportDetail.revision}` : '选择一份日报查看详情'}</span>
        </div>

        {!detailLoading && reportDetail ? (
          <>
            <div className="daily-report-detail">
              <div className="stats-grid report-stats-grid">
                <article className="stat-card"><span className="stat-label">{schemaVersion >= 2 ? '来访组数' : '来访客户'}</span><strong className="stat-value">{schemaVersion >= 2 ? readNumber(summaryStats, 'visitedGroupCount') : reportDetail.visitedCustomerCount}</strong><small className="stat-meta">营业日 {reportDetail.businessDate}</small></article>
                <article className="stat-card"><span className="stat-label">{schemaVersion >= 3 ? '首访 / 复访' : schemaVersion >= 2 ? 'A/B 高意向' : '活跃对话'}</span><strong className="stat-value">{schemaVersion >= 3 ? `${readNumber(summaryStats, 'firstVisitGroupCount')} / ${readNumber(summaryStats, 'revisitGroupCount')}` : schemaVersion >= 2 ? readNumber(summaryStats, 'highIntentGroupCount') : reportDetail.activeTopicCount}</strong><small className="stat-meta">{schemaVersion >= 3 ? `A类 ${readNumber(summaryStats, 'aIntentGroupCount')} / B类 ${readNumber(summaryStats, 'bIntentGroupCount')}` : schemaVersion >= 2 ? `A类 ${readNumber(summaryStats, 'aIntentGroupCount')} / B类 ${readNumber(summaryStats, 'bIntentGroupCount')}` : `总消息 ${reportDetail.totalMessageCount}`}</small></article>
                <article className="stat-card"><span className="stat-label">{schemaVersion >= 2 ? '中低意向' : '活跃对话'}</span><strong className="stat-value">{schemaVersion >= 2 ? readNumber(summaryStats, 'cIntentGroupCount') + readNumber(summaryStats, 'dIntentGroupCount') : reportDetail.activeTopicCount}</strong><small className="stat-meta">{schemaVersion >= 2 ? `C类 ${readNumber(summaryStats, 'cIntentGroupCount')} / D类 ${readNumber(summaryStats, 'dIntentGroupCount')}` : `总消息 ${reportDetail.totalMessageCount}`}</small></article>
                <article className="stat-card"><span className="stat-label">{schemaVersion >= 2 ? '待补信息' : '客户消息'}</span><strong className="stat-value">{schemaVersion >= 2 ? readNumber(summaryStats, 'missingIntentGroupCount') : reportDetail.userMessageCount}</strong><small className="stat-meta">{schemaVersion >= 2 ? '独立标签，不等于 C/D' : `助手消息 ${reportDetail.assistantMessageCount}`}</small></article>
              </div>

              <div className="daily-report-summary-card">
                <p className="eyebrow">Overview</p>
                <h4>{readString(summaryOverview, 'headline') || '暂无概览'}</h4>
                <p>{readString(summaryOverview, 'executiveSummary') || '暂无摘要'}</p>
                <div className="report-pill-row">
                  <span className="report-pill active">窗口 {formatTime(reportDetail.windowStartAt)} ~ {formatTime(reportDetail.windowEndAt)}</span>
                  {schemaVersion >= 2 ? <span className="report-pill">A/B {readNumber(summaryStats, 'highIntentGroupCount')}</span> : null}
                  {schemaVersion >= 3 ? <span className="report-pill">首访 {readNumber(summaryStats, 'firstVisitGroupCount')} / 复访 {readNumber(summaryStats, 'revisitGroupCount')}</span> : null}
                  {schemaVersion >= 2 ? <span className="report-pill">信息不足 {readNumber(summaryStats, 'missingIntentGroupCount')}</span> : null}
                  <span className="report-pill">系统提示词版本 {reportDetail.systemPromptVersion}</span>
                </div>
              </div>

              <div className="daily-report-body-card">
                <p className="eyebrow">Body</p>
                <pre className="daily-report-body-text">{compactBodyText}</pre>
              </div>

              <details className="daily-report-structured">
                <summary>查看结构化依据</summary>
                {highlights.length > 0 ? <div className="daily-report-section"><h4>{schemaVersion >= 2 ? '今日重点' : '重点发现'}</h4>{renderJsonList(highlights, 'title', 'detail')}</div> : null}
                {schemaVersion >= 2 && keyCustomerGroups.length > 0 ? <div className="daily-report-section"><h4>今日重点客户</h4>{renderCustomerCards(keyCustomerGroups, (topicId) => setSelectedTopicId(topicId), 'key')}</div> : null}
                {schemaVersion >= 2 && missingInfoCustomers.length > 0 ? <div className="daily-report-section"><h4>待补信息客户</h4>{renderCustomerCards(missingInfoCustomers, (topicId) => setSelectedTopicId(topicId), 'missing')}</div> : null}
                {schemaVersion >= 2 && commonConcerns.length > 0 ? <div className="daily-report-section"><h4>客户整体关注点</h4>{renderJsonList(commonConcerns, 'label', 'detail')}</div> : null}
                {schemaVersion >= 2 && managementFocus.length > 0 ? <div className="daily-report-section"><h4>管理上需要关注的问题</h4>{renderJsonList(managementFocus, 'title', 'detail', 'severity')}</div> : null}
                {schemaVersion >= 2 && managementActions.length > 0 ? <div className="daily-report-section"><h4>建议提供的管理动作或道具</h4>{renderJsonList(managementActions, 'title', 'detail', 'reason')}</div> : null}
                {schemaVersion < 2 && legacyCustomers.length > 0 ? <div className="daily-report-section"><h4>客户摘要</h4>{renderJsonList(legacyCustomers, 'displayName', 'overallSummary', 'nextAction')}</div> : null}
                {schemaVersion < 2 && legacyRisks.length > 0 ? <div className="daily-report-section"><h4>风险提醒</h4>{renderJsonList(legacyRisks, 'title', 'detail', 'recommendation')}</div> : null}
                {schemaVersion < 2 && legacyFollowUps.length > 0 ? <div className="daily-report-section"><h4>建议动作</h4>{renderJsonList(legacyFollowUps, 'action', 'priority')}</div> : null}
              </details>
            </div>

            <details className="daily-report-markdown">
              <summary>查看 Markdown 原文</summary>
              <pre className="raw-modal-content">{reportDetail.summaryMarkdown}</pre>
            </details>
            <details className="daily-report-markdown">
              <summary>查看结构化 JSON</summary>
              <pre className="raw-modal-content">{JSON.stringify(reportDetail.summaryJson, null, 2)}</pre>
            </details>
          </>
        ) : (
          <div className="empty-card"><p>{detailLoading ? '正在加载日报详情...' : '请选择一份日报查看详情。'}</p></div>
        )}
      </section>

      {selectedTopicId ? (
        <div className="raw-modal-backdrop topic-detail-backdrop" onClick={() => { setSelectedTopicId(null); setTopicDetail(null); }}>
          <div className="raw-modal topic-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Conversation</p>
                <h3>{topicDetail?.topic.title ?? '对话详情'}</h3>
              </div>
              <button className="ghost" onClick={() => { setSelectedTopicId(null); setTopicDetail(null); }}>
                关闭
              </button>
            </div>

            {topicDetail ? (
              <>
                <div className="report-pill-row">
                  <span className="report-pill active">{topicDetail.topic.displayName}</span>
                  <span className="report-pill">{topicDetail.topic.email ?? topicDetail.topic.userId}</span>
                  <span className="report-pill">会话 {topicDetail.topic.managedSessionTitle ?? '-'}</span>
                </div>

                <p className="muted topic-modal-meta">
                  创建：{formatTime(topicDetail.topic.createdAt)} / 更新：{formatTime(topicDetail.topic.updatedAt)} / 消息数 {topicDetail.messages.length}
                </p>
              </>
            ) : null}

            {topicDetailLoading ? <p className="muted">正在加载对话详情...</p> : null}

            {!topicDetailLoading && topicDetail ? (
              topicDetail.messages.length > 0 ? (
                <div className="topic-message-list">
                  {topicDetail.messages.map((message) => (
                    <article key={message.id} className="topic-message-card">
                      <div className="topic-message-head">
                        <span className={`topic-role-badge ${message.role}`}>{formatMessageRole(message.role)}</span>
                        <span className="muted">{formatTime(message.createdAt)}</span>
                      </div>
                      <div className="topic-message-content">{message.content ?? '暂无内容'}</div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-card"><p>当前对话下没有可展示的消息内容。</p></div>
              )
            ) : null}
          </div>
        </div>
      ) : null}

    </div>
  );
}
