import { useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type {
  ProjectMember,
  ProjectReportFilters,
  ProjectReportJob,
  ProjectReportResult,
  ProjectReportRow,
} from '../types';

type ProjectReportPanelProps = {
  actorId: string;
  projectId: string;
  projectMembers: ProjectMember[];
  onFeedback: (message: string) => void;
};

type ReportFilterState = {
  keyword: string;
  userId: string;
  role: 'all' | 'admin' | 'member';
  managedStatus: 'all' | 'provisioned' | 'failed' | 'skipped' | 'unconfigured';
  dateField: 'joinedAt' | 'provisionedAt' | 'managedSessionUpdatedAt';
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

function createDefaultFilters(): ReportFilterState {
  return {
    keyword: '',
    userId: '',
    role: 'all',
    managedStatus: 'all',
    dateField: 'joinedAt',
    dateFrom: '',
    dateTo: '',
    page: 1,
    pageSize: 10,
  };
}

const managedStatusLabels: Record<ProjectReportRow['managedStatus'], string> = {
  provisioned: '已配置',
  failed: '失败',
  skipped: '已跳过',
  unconfigured: '未配置',
};

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function formatRole(role: ProjectReportRow['role']) {
  return role === 'admin' ? '管理员' : '成员';
}

function formatJobType(jobType: ProjectReportJob['jobType']) {
  return jobType === 'configure' ? '配置助手' : '刷新助手';
}

function formatDateField(dateField: ReportFilterState['dateField']) {
  switch (dateField) {
    case 'provisionedAt':
      return '托管配置时间';
    case 'managedSessionUpdatedAt':
      return '托管会话更新时间';
    case 'joinedAt':
    default:
      return '加入项目时间';
  }
}

function formatJobStatus(status?: string | null) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'partial':
      return '部分成功';
    case 'running':
      return '进行中';
    case 'pending':
      return '等待中';
    default:
      return status ?? '-';
  }
}

function getManagedStatusClass(status: ProjectReportRow['managedStatus']) {
  if (status === 'provisioned') return 'managed';
  if (status === 'failed') return 'failed';
  if (status === 'skipped') return 'warning';
  return '';
}

function formatManagedStatus(row: Pick<ProjectReportRow, 'role' | 'managedStatus'>) {
  if (row.role === 'admin') return '管理员';
  return managedStatusLabels[row.managedStatus];
}

function formatManagedStatusHint(row: Pick<ProjectReportRow, 'role' | 'managedStatus' | 'managedMessage'>) {
  if (row.role === 'admin') {
    return '管理员不参与批量助手配置';
  }

  if (row.managedMessage) {
    return row.managedMessage;
  }

  if (row.managedStatus === 'unconfigured') {
    return '尚未执行成员助手配置任务';
  }

  if (row.managedStatus === 'skipped') {
    return '最近一次任务跳过了该成员';
  }

  return null;
}

function getJobBadgeClass(status: string) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'partial') return 'warning';
  if (status === 'running' || status === 'pending') return 'muted';
  return '';
}

function normalizeFilters(filters: ReportFilterState): ProjectReportFilters {
  const normalized: ProjectReportFilters = {
    role: filters.role,
    managedStatus: filters.managedStatus,
    dateField: filters.dateField,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  if (filters.keyword.trim()) normalized.keyword = filters.keyword.trim();
  if (filters.userId) normalized.userId = filters.userId;
  if (filters.dateFrom) normalized.dateFrom = filters.dateFrom;
  if (filters.dateTo) normalized.dateTo = filters.dateTo;

  return normalized;
}

function getActiveFilterLabels(filters: ReportFilterState, members: ProjectMember[]) {
  const labels: string[] = [];

  if (filters.keyword.trim()) {
    labels.push(`关键词：${filters.keyword.trim()}`);
  }

  if (filters.userId) {
    const member = members.find((item) => item.userId === filters.userId);
    labels.push(`成员：${member?.displayName ?? filters.userId}`);
  }

  if (filters.role !== 'all') {
    labels.push(`角色：${filters.role === 'admin' ? '管理员' : '成员'}`);
  }

  if (filters.managedStatus !== 'all') {
    const label = filters.managedStatus === 'unconfigured'
      ? '未配置'
      : managedStatusLabels[filters.managedStatus];
    labels.push(`托管状态：${label}`);
  }

  if (filters.dateFrom || filters.dateTo) {
    labels.push(
      `${formatDateField(filters.dateField)}：${filters.dateFrom || '不限'} ~ ${filters.dateTo || '不限'}`,
    );
  }

  if (filters.pageSize !== 10) {
    labels.push(`每页：${filters.pageSize} 条`);
  }

  return labels;
}

export function ProjectReportPanel({
  actorId,
  projectId,
  projectMembers,
  onFeedback,
}: ProjectReportPanelProps) {
  const [draftFilters, setDraftFilters] = useState<ReportFilterState>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<ReportFilterState>(() => createDefaultFilters());
  const [report, setReport] = useState<ProjectReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setReport(null);
    setError('');
  }, [projectId]);

  useEffect(() => {
    if (!actorId || !projectId) return;

    let cancelled = false;

    async function loadReport() {
      setLoading(true);
      setError('');

      try {
        const result = await api.getProjectReport(actorId, projectId, normalizeFilters(appliedFilters));

        if (cancelled) return;
        setReport(result);
      } catch (loadError) {
        if (cancelled) return;
        const message = (loadError as Error).message;
        setError(message);
        onFeedback(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, appliedFilters, refreshKey, onFeedback]);

  const memberOptions = [...projectMembers].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'zh-CN'),
  );

  const total = report?.pagination.total ?? 0;
  const totalPages = report?.pagination.totalPages ?? 1;
  const currentPage = report?.pagination.page ?? 1;
  const pageSize = report?.pagination.pageSize ?? appliedFilters.pageSize;
  const visibleStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleEnd = total === 0 ? 0 : visibleStart + (report?.rows.length ?? 0) - 1;
  const memberCoverage = report && report.summary.memberCount > 0
    ? Math.round((report.summary.managedMemberCount / report.summary.memberCount) * 100)
    : 0;
  const activeFilterLabels = getActiveFilterLabels(appliedFilters, memberOptions);

  function updateDraftFilter<K extends keyof ReportFilterState>(key: K, value: ReportFilterState[K]) {
    setDraftFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyFilters() {
    if (draftFilters.dateFrom && draftFilters.dateTo && draftFilters.dateFrom > draftFilters.dateTo) {
      const message = '开始日期不能晚于结束日期';
      setError(message);
      onFeedback(message);
      return;
    }

    setError('');
    setAppliedFilters({
      ...draftFilters,
      page: 1,
    });
  }

  function resetFilters() {
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setError('');
  }

  function refreshReport() {
    if (loading) return;
    setRefreshKey((value) => value + 1);
  }

  function changePage(nextPage: number) {
    const boundedPage = Math.max(1, Math.min(nextPage, totalPages));

    if (boundedPage === currentPage) return;

    setAppliedFilters((current) => ({
      ...current,
      page: boundedPage,
    }));
  }

  function changePageSize(value: string) {
    const nextPageSize = Number(value);

    if (!Number.isFinite(nextPageSize)) return;

    setDraftFilters((current) => ({
      ...current,
      pageSize: nextPageSize,
    }));

    setAppliedFilters((current) => ({
      ...current,
      pageSize: nextPageSize,
      page: 1,
    }));
  }

  function handleKeywordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyFilters();
    }
  }

  async function exportReport() {
    if (loading) return;

    try {
      const blob = await api.exportProjectReport(actorId, projectId, normalizeFilters(appliedFilters));
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `project-${projectId}-member-activity.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      onFeedback('报表已导出');
    } catch (exportError) {
      const message = (exportError as Error).message;
      setError(message);
      onFeedback(message);
    }
  }

  return (
    <div className="report-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Report Filters</p>
            <h3>成员运营报表</h3>
          </div>
          <span className="muted">按项目成员范围查询、分页和导出</span>
        </div>

        <div className="report-filter-grid">
          <label className="field">
            <span>成员检索</span>
            <input
              value={draftFilters.keyword}
              onChange={(event) => updateDraftFilter('keyword', event.target.value)}
              onKeyDown={handleKeywordKeyDown}
              placeholder="姓名 / 邮箱 / user_id"
            />
          </label>

          <label className="field">
            <span>指定成员</span>
            <select value={draftFilters.userId} onChange={(event) => updateDraftFilter('userId', event.target.value)}>
              <option value="">全部成员</option>
              {memberOptions.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName} ({member.email ?? member.userId})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>角色</span>
            <select value={draftFilters.role} onChange={(event) => updateDraftFilter('role', event.target.value as ReportFilterState['role'])}>
              <option value="all">全部角色</option>
              <option value="admin">管理员</option>
              <option value="member">成员</option>
            </select>
          </label>

          <label className="field">
            <span>托管状态</span>
            <select
              value={draftFilters.managedStatus}
              onChange={(event) => updateDraftFilter('managedStatus', event.target.value as ReportFilterState['managedStatus'])}
            >
              <option value="all">全部状态</option>
              <option value="provisioned">已配置</option>
              <option value="failed">失败</option>
              <option value="skipped">已跳过</option>
              <option value="unconfigured">未配置</option>
            </select>
          </label>

          <label className="field">
            <span>时间维度</span>
            <select
              value={draftFilters.dateField}
              onChange={(event) => updateDraftFilter('dateField', event.target.value as ReportFilterState['dateField'])}
            >
              <option value="joinedAt">加入项目时间</option>
              <option value="provisionedAt">托管配置时间</option>
              <option value="managedSessionUpdatedAt">托管会话更新时间</option>
            </select>
          </label>

          <label className="field">
            <span>开始日期</span>
            <input type="date" value={draftFilters.dateFrom} onChange={(event) => updateDraftFilter('dateFrom', event.target.value)} />
          </label>

          <label className="field">
            <span>结束日期</span>
            <input type="date" value={draftFilters.dateTo} onChange={(event) => updateDraftFilter('dateTo', event.target.value)} />
          </label>

          <label className="field">
            <span>每页条数</span>
            <select value={String(appliedFilters.pageSize)} onChange={(event) => changePageSize(event.target.value)}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>

        <div className="report-toolbar">
          <button className="primary" disabled={loading} onClick={applyFilters}>
            查询报表
          </button>
          <button className="secondary" disabled={loading} onClick={resetFilters}>
            重置条件
          </button>
          <button className="ghost" disabled={loading} onClick={refreshReport}>
            刷新
          </button>
          <button className="secondary" disabled={loading || total === 0} onClick={() => void exportReport()}>
            导出 CSV
          </button>
        </div>

        {activeFilterLabels.length > 0 ? (
          <div className="report-pill-row">
            {activeFilterLabels.map((label) => (
              <span key={label} className="report-pill active">
                {label}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">当前使用默认筛选条件，覆盖全部项目成员。</p>
        )}
      </section>

      {error ? <p className="danger-text">{error}</p> : null}
      {loading && !report ? <p className="muted">正在加载报表...</p> : null}
      {loading && report ? <p className="muted">正在刷新报表数据...</p> : null}

      {report ? (
        <>
          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Overview</p>
                <h3>统计概览</h3>
              </div>
              <span className="muted">当前命中 {report.pagination.total} 条成员记录，显示 {visibleStart}-{visibleEnd}</span>
            </div>

            <div className="stats-grid report-stats-grid">
              <article className="stat-card">
                <span className="stat-label">筛选命中成员</span>
                <strong className="stat-value">{report.summary.totalMembers}</strong>
                <small className="stat-meta">管理员 {report.summary.adminCount} / 成员 {report.summary.memberCount}</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">已配置项目助手</span>
                <strong className="stat-value">{report.summary.managedMemberCount}</strong>
                <small className="stat-meta">成员覆盖率 {memberCoverage}% / 失败 {report.summary.failedManagedCount} / 跳过 {report.summary.skippedManagedCount}</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">待配置成员</span>
                <strong className="stat-value">{report.summary.unconfiguredCount}</strong>
                <small className="stat-meta">纳入配置成员 {report.summary.memberCount}</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">托管会话</span>
                <strong className="stat-value">{report.summary.managedSessionCount}</strong>
                <small className="stat-meta">默认助手写入 {report.summary.defaultAgentCount} / 用户助手总数 {report.summary.assistantCount}</small>
              </article>
            </div>

            <div className="report-pill-row">
              <span className="report-pill">管理员 {report.summary.adminCount}</span>
              <span className="report-pill">成员 {report.summary.memberCount}</span>
              <span className="report-pill">覆盖率 {memberCoverage}%</span>
              <span className="report-pill">待配置 {report.summary.unconfiguredCount}</span>
              <span className="report-pill">失败 {report.summary.failedManagedCount}</span>
              <span className="report-pill">跳过 {report.summary.skippedManagedCount}</span>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Jobs</p>
                <h3>最近任务</h3>
              </div>
              <span className="muted">最近 6 次批量任务</span>
            </div>

            {report.recentJobs.length > 0 ? (
              <div className="report-job-grid">
                {report.recentJobs.map((job) => (
                  <article key={job.id} className="report-job-card">
                    <div className="report-job-head">
                      <strong>{formatJobType(job.jobType)}</strong>
                      <span className={`report-badge ${getJobBadgeClass(job.status)}`}>{formatJobStatus(job.status)}</span>
                    </div>
                    <p className="muted">
                      总数 {job.totalCount} / 成功 {job.successCount} / 失败 {job.failedCount} / 跳过 {job.skippedCount}
                    </p>
                    <p className="muted">发起人：{job.createdByName ?? '-'}</p>
                    <p className="muted">完成时间：{formatTime(job.finishedAt ?? job.startedAt)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">暂无任务记录</p>
            )}
          </section>

          <section className="section section-wide">
            <div className="section-head">
              <div>
                <p className="eyebrow">Members</p>
                <h3>成员明细</h3>
              </div>
              <span className="muted">第 {currentPage} / {totalPages} 页，当前显示 {visibleStart}-{visibleEnd} / {total}</span>
            </div>

            {report.rows.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table className="member-table report-table">
                    <thead>
                      <tr>
                        <th>成员</th>
                        <th>角色</th>
                        <th>托管状态</th>
                        <th>托管助手</th>
                        <th>托管会话</th>
                        <th>用户资产</th>
                        <th>时间</th>
                        <th>最近任务</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => {
                        const managedStatusClass = row.role === 'member' ? getManagedStatusClass(row.managedStatus) : '';

                        return (
                          <tr key={row.userId}>
                            <td className="member-name-cell">
                              <strong>{row.displayName}</strong>
                              <span className="member-subtext">{row.email ?? '-'}</span>
                              <span className="member-subtext">{row.userId}</span>
                            </td>
                            <td>
                              <span className={`role-pill${row.role === 'admin' ? ' admin' : ''}`}>
                                {formatRole(row.role)}
                              </span>
                            </td>
                            <td>
                              <div className={`member-status${managedStatusClass ? ` ${managedStatusClass}` : ''}`}>
                                {formatManagedStatus(row)}
                              </div>
                              <span className="member-subtext">{formatManagedStatusHint(row) ?? '-'}</span>
                            </td>
                            <td>
                              <strong>{row.managedAssistantTitle ?? '-'}</strong>
                              <span className="member-subtext">
                                {row.role === 'member'
                                  ? (row.isDefaultAgent ? '已写入默认助手' : '未写入默认助手')
                                  : '管理员不写入默认助手'}
                              </span>
                              {row.managedAssistantId ? <span className="member-subtext">{row.managedAssistantId}</span> : null}
                            </td>
                            <td>
                              <strong>{row.managedSessionTitle ?? '-'}</strong>
                              <span className="member-subtext">{row.managedSessionId ?? '-'}</span>
                            </td>
                            <td>
                              <span className="member-subtext">助手 {row.assistantCount}</span>
                              <span className="member-subtext">会话 {row.sessionCount}</span>
                              <span className="member-subtext">助手更新：{formatTime(row.latestAssistantUpdatedAt)}</span>
                            </td>
                            <td>
                              <span className="member-subtext">加入：{formatTime(row.joinedAt)}</span>
                              <span className="member-subtext">配置：{formatTime(row.provisionedAt)}</span>
                              <span className="member-subtext">会话更新：{formatTime(row.managedSessionUpdatedAt ?? row.latestSessionUpdatedAt)}</span>
                            </td>
                            <td>
                              <span className="member-subtext">状态：{formatJobStatus(row.lastJobStatus)}</span>
                              <span className="member-subtext">完成：{formatTime(row.lastJobFinishedAt)}</span>
                              <span className="member-subtext">任务：{row.lastJobId ?? '-'}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="report-pagination">
                  <span className="muted">当前第 {currentPage} 页，共 {totalPages} 页</span>
                  <div className="button-row">
                    <button className="ghost" disabled={currentPage <= 1} onClick={() => changePage(1)}>
                      首页
                    </button>
                    <button className="ghost" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}>
                      上一页
                    </button>
                    <button className="ghost" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)}>
                      下一页
                    </button>
                    <button className="ghost" disabled={currentPage >= totalPages} onClick={() => changePage(totalPages)}>
                      末页
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-card">
                <p>当前筛选条件下没有成员记录。</p>
                <p>可以尝试清空用户、状态或时间条件后重新查询。</p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
