import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type {
  ProjectTopicDetailResult,
  ProjectTopicListResult,
  ProjectTopicStatsFilters,
  ProjectTopicStatsRangePreset,
  ProjectTopicStatsResult,
  ProjectTopicStatsRow,
} from '../types';

type ProjectTopicStatsPanelProps = {
  actorId: string;
  projectId: string;
  onFeedback: (message: string) => void;
};

type TopicStatsFilterState = {
  rangePreset: ProjectTopicStatsRangePreset;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

const rangePresetOptions: Array<{ value: ProjectTopicStatsRangePreset; label: string }> = [
  { value: 'today', label: '当日' },
  { value: 'last3days', label: '近三天' },
  { value: 'last7days', label: '近七天' },
  { value: 'last30days', label: '一个月' },
  { value: 'custom', label: '指定范围' },
];

function createDefaultFilters(): TopicStatsFilterState {
  return {
    rangePreset: 'today',
    dateFrom: '',
    dateTo: '',
    page: 1,
    pageSize: 20,
  };
}

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function formatRole(role: 'admin' | 'member') {
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

function normalizeFilters(filters: TopicStatsFilterState): ProjectTopicStatsFilters {
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

function getRangePresetLabel(rangePreset: ProjectTopicStatsRangePreset) {
  return rangePresetOptions.find((option) => option.value === rangePreset)?.label ?? rangePreset;
}

export function ProjectTopicStatsPanel({
  actorId,
  projectId,
  onFeedback,
}: ProjectTopicStatsPanelProps) {
  const [draftFilters, setDraftFilters] = useState<TopicStatsFilterState>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<TopicStatsFilterState>(() => createDefaultFilters());
  const [report, setReport] = useState<ProjectTopicStatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [selectedMember, setSelectedMember] = useState<ProjectTopicStatsRow | null>(null);
  const [memberTopics, setMemberTopics] = useState<ProjectTopicListResult | null>(null);
  const [memberTopicsLoading, setMemberTopicsLoading] = useState(false);
  const [memberTopicsError, setMemberTopicsError] = useState('');

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topicDetail, setTopicDetail] = useState<ProjectTopicDetailResult | null>(null);
  const [topicDetailLoading, setTopicDetailLoading] = useState(false);
  const [topicDetailError, setTopicDetailError] = useState('');

  useEffect(() => {
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setReport(null);
    setError('');
    setSelectedMember(null);
    setMemberTopics(null);
    setMemberTopicsError('');
    setSelectedTopicId(null);
    setTopicDetail(null);
    setTopicDetailError('');
  }, [projectId]);

  useEffect(() => {
    if (!actorId || !projectId) return;

    let cancelled = false;

    async function loadTopicStats() {
      setLoading(true);
      setError('');

      try {
        const result = await api.getProjectTopicStats(actorId, projectId, normalizeFilters(appliedFilters));

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

    void loadTopicStats();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, appliedFilters, refreshKey, onFeedback]);

  useEffect(() => {
    if (!selectedMember) {
      setMemberTopics(null);
      setMemberTopicsError('');
      return;
    }

    const memberUserId = selectedMember.userId;
    let cancelled = false;

    async function loadMemberTopics() {
      setMemberTopicsLoading(true);
      setMemberTopicsError('');
      setSelectedTopicId(null);
      setTopicDetail(null);
      setTopicDetailError('');

      try {
        const result = await api.getProjectUserTopics(
          actorId,
          projectId,
          memberUserId,
          normalizeFilters(appliedFilters),
        );

        if (cancelled) return;
        setMemberTopics(result);
      } catch (loadError) {
        if (cancelled) return;
        const message = (loadError as Error).message;
        setMemberTopicsError(message);
        onFeedback(message);
      } finally {
        if (!cancelled) {
          setMemberTopicsLoading(false);
        }
      }
    }

    void loadMemberTopics();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, appliedFilters, selectedMember, onFeedback]);

  useEffect(() => {
    if (!selectedTopicId) {
      setTopicDetail(null);
      setTopicDetailError('');
      return;
    }

    const topicId = selectedTopicId;
    let cancelled = false;

    async function loadTopicDetail() {
      setTopicDetailLoading(true);
      setTopicDetailError('');

      try {
        const result = await api.getProjectTopicDetail(actorId, projectId, topicId);

        if (cancelled) return;
        setTopicDetail(result);
      } catch (loadError) {
        if (cancelled) return;
        const message = (loadError as Error).message;
        setTopicDetailError(message);
        onFeedback(message);
      } finally {
        if (!cancelled) {
          setTopicDetailLoading(false);
        }
      }
    }

    void loadTopicDetail();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, selectedTopicId, onFeedback]);

  const total = report?.pagination.total ?? 0;
  const totalPages = report?.pagination.totalPages ?? 1;
  const currentPage = report?.pagination.page ?? 1;
  const pageSize = report?.pagination.pageSize ?? appliedFilters.pageSize;
  const visibleStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleEnd = total === 0 ? 0 : visibleStart + (report?.rows.length ?? 0) - 1;
  const activeRate = report && report.summary.totalMembers > 0
    ? Math.round((report.summary.activeMemberCount / report.summary.totalMembers) * 100)
    : 0;
  const averageTopics = report && report.summary.totalMembers > 0
    ? (report.summary.totalTopics / report.summary.totalMembers).toFixed(1)
    : '0.0';

  function updateDraftFilter<K extends keyof TopicStatsFilterState>(key: K, value: TopicStatsFilterState[K]) {
    setDraftFilters((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyFilters() {
    if (draftFilters.rangePreset === 'custom') {
      if (!draftFilters.dateFrom || !draftFilters.dateTo) {
        const message = '指定日期范围时，开始日期和结束日期都必须填写。';
        setError(message);
        onFeedback(message);
        return;
      }

      if (draftFilters.dateFrom > draftFilters.dateTo) {
        const message = '开始日期不能晚于结束日期。';
        setError(message);
        onFeedback(message);
        return;
      }
    }

    setError('');
    setAppliedFilters({
      ...draftFilters,
      page: 1,
    });
    closeMemberTopicsModal();
  }

  function resetFilters() {
    const nextFilters = createDefaultFilters();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setError('');
    closeMemberTopicsModal();
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

  function updateRangePreset(rangePreset: ProjectTopicStatsRangePreset) {
    setDraftFilters((current) => ({
      ...current,
      rangePreset,
      dateFrom: rangePreset === 'custom' ? current.dateFrom : '',
      dateTo: rangePreset === 'custom' ? current.dateTo : '',
    }));
  }

  function openMemberTopics(row: ProjectTopicStatsRow) {
    setSelectedMember(row);
  }

  function closeMemberTopicsModal() {
    setSelectedMember(null);
    setMemberTopics(null);
    setMemberTopicsError('');
    closeTopicDetailModal();
  }

  function openTopicDetail(topicId: string) {
    setSelectedTopicId(topicId);
  }

  function closeTopicDetailModal() {
    setSelectedTopicId(null);
    setTopicDetail(null);
    setTopicDetailError('');
  }

  return (
    <div className="report-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Topic Stats</p>
            <h3>对话统计</h3>
          </div>
          <span className="muted">仅统计项目托管会话内创建的 topic 数量</span>
        </div>

        <div className="report-pill-row">
          {rangePresetOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`report-pill-button${draftFilters.rangePreset === option.value ? ' active' : ''}`}
              onClick={() => updateRangePreset(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {draftFilters.rangePreset === 'custom' ? (
          <div className="report-filter-grid topic-filter-grid">
            <label className="field">
              <span>开始日期</span>
              <input
                type="date"
                value={draftFilters.dateFrom}
                onChange={(event) => updateDraftFilter('dateFrom', event.target.value)}
              />
            </label>

            <label className="field">
              <span>结束日期</span>
              <input
                type="date"
                value={draftFilters.dateTo}
                onChange={(event) => updateDraftFilter('dateTo', event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <div className="report-toolbar">
          <button className="primary" disabled={loading} onClick={applyFilters}>
            查询统计
          </button>
          <button className="secondary" disabled={loading} onClick={resetFilters}>
            重置条件
          </button>
          <button className="ghost" disabled={loading} onClick={refreshReport}>
            刷新
          </button>

          <label className="field topic-page-size-field">
            <span>每页条数</span>
            <select value={String(pageSize)} onChange={(event) => changePageSize(event.target.value)}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </label>
        </div>

        {report ? (
          <div className="report-pill-row">
            <span className="report-pill active">
              时间范围：{getRangePresetLabel(report.range.rangePreset)} / {report.range.dateFrom} ~ {report.range.dateTo}
            </span>
            <span className="report-pill">命中成员 {report.pagination.total}</span>
            <span className="report-pill">活跃占比 {activeRate}%</span>
          </div>
        ) : (
          <p className="muted">默认显示当日范围内的项目托管会话 topic 统计。</p>
        )}
      </section>

      {error ? <p className="danger-text">{error}</p> : null}
      {loading && !report ? <p className="muted">正在加载对话统计...</p> : null}
      {loading && report ? <p className="muted">正在刷新对话统计数据...</p> : null}

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
                <span className="stat-label">项目人员</span>
                <strong className="stat-value">{report.summary.totalMembers}</strong>
                <small className="stat-meta">管理员 {report.summary.adminCount} / 成员 {report.summary.memberCount}</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">活跃人员</span>
                <strong className="stat-value">{report.summary.activeMemberCount}</strong>
                <small className="stat-meta">无对话 {report.summary.inactiveMemberCount} / 活跃占比 {activeRate}%</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">Topic 总数</span>
                <strong className="stat-value">{report.summary.totalTopics}</strong>
                <small className="stat-meta">人均 {averageTopics} / 已配置托管会话 {report.summary.managedSessionCount}</small>
              </article>

              <article className="stat-card">
                <span className="stat-label">最近对话</span>
                <strong className="stat-value topic-stat-time">{formatTime(report.summary.lastTopicAt)}</strong>
                <small className="stat-meta">最早记录 {formatTime(report.summary.firstTopicAt)}</small>
              </article>
            </div>
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
                        <th>托管会话</th>
                        <th>Topic 数量</th>
                        <th>首次对话</th>
                        <th>最近对话</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr key={row.userId}>
                          <td className="member-name-cell">
                            <button className="table-link-button" onClick={() => openMemberTopics(row)}>
                              {row.displayName}
                            </button>
                            <span className="member-subtext">{row.email ?? '-'}</span>
                            <span className="member-subtext">{row.userId}</span>
                          </td>
                          <td>
                            <span className={`role-pill${row.role === 'admin' ? ' admin' : ''}`}>
                              {formatRole(row.role)}
                            </span>
                          </td>
                          <td>
                            <strong>{row.managedSessionTitle ?? '未配置托管会话'}</strong>
                            <span className="member-subtext">{row.managedSessionId ?? '-'}</span>
                            <span className="member-subtext">加入项目：{formatTime(row.joinedAt)}</span>
                          </td>
                          <td>
                            {row.topicCount > 0 ? (
                              <button className="table-link-button" onClick={() => openMemberTopics(row)}>
                                {row.topicCount}
                              </button>
                            ) : (
                              <strong>{row.topicCount}</strong>
                            )}
                            <span className="member-subtext">{row.topicCount > 0 ? '点击数量或成员查看清单' : '时间范围内无对话'}</span>
                          </td>
                          <td>{formatTime(row.firstTopicAt)}</td>
                          <td>{formatTime(row.lastTopicAt)}</td>
                        </tr>
                      ))}
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
                <p>当前时间范围内没有成员对话记录。</p>
                <p>可以切换时间范围后重新查询。</p>
              </div>
            )}
          </section>
        </>
      ) : null}

      {selectedMember ? (
        <div className="raw-modal-backdrop" onClick={closeMemberTopicsModal}>
          <div className="raw-modal topic-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Topics</p>
                <h3>{selectedMember.displayName} 的对话清单</h3>
              </div>
              <button className="ghost" onClick={closeMemberTopicsModal}>
                关闭
              </button>
            </div>

            {memberTopics ? (
              <>
                <div className="report-pill-row">
                  <span className="report-pill active">
                    范围：{getRangePresetLabel(memberTopics.range.rangePreset)} / {memberTopics.range.dateFrom} ~ {memberTopics.range.dateTo}
                  </span>
                  <span className="report-pill">Topic {memberTopics.topics.length}</span>
                  <span className="report-pill">托管会话 {memberTopics.member.managedSessionTitle ?? '未配置'}</span>
                </div>

                <p className="muted topic-modal-meta">
                  {memberTopics.member.email ?? memberTopics.member.userId} · {formatRole(memberTopics.member.role)} · 加入时间 {formatTime(memberTopics.member.joinedAt)}
                </p>
              </>
            ) : null}

            {memberTopicsError ? <p className="danger-text">{memberTopicsError}</p> : null}
            {memberTopicsLoading ? <p className="muted">正在加载对话清单...</p> : null}

            {!memberTopicsLoading && memberTopics ? (
              memberTopics.topics.length > 0 ? (
                <div className="topic-list">
                  {memberTopics.topics.map((topic) => (
                    <button
                      key={topic.topicId}
                      className="topic-list-item"
                      onClick={() => openTopicDetail(topic.topicId)}
                    >
                      <div className="topic-list-head">
                        <strong>{topic.title}</strong>
                        <span className="report-badge muted">消息 {topic.messageCount}</span>
                      </div>
                      <p className="topic-list-preview">{topic.preview ?? '无预览内容'}</p>
                      <div className="topic-list-meta">
                        <span>创建：{formatTime(topic.createdAt)}</span>
                        <span>更新：{formatTime(topic.updatedAt)}</span>
                        <span>最后消息：{formatTime(topic.lastMessageAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-card">
                  <p>当前用户在这个时间范围内没有对话记录。</p>
                  <p>如果用户是管理员或还未配置托管会话，这里会为空。</p>
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedTopicId ? (
        <div className="raw-modal-backdrop topic-detail-backdrop" onClick={closeTopicDetailModal}>
          <div className="raw-modal topic-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Conversation</p>
                <h3>{topicDetail?.topic.title ?? '对话详情'}</h3>
              </div>
              <button className="ghost" onClick={closeTopicDetailModal}>
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
                  创建：{formatTime(topicDetail.topic.createdAt)} · 更新：{formatTime(topicDetail.topic.updatedAt)} · 消息数 {topicDetail.messages.length}
                </p>
              </>
            ) : null}

            {topicDetailError ? <p className="danger-text">{topicDetailError}</p> : null}
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
                      <pre className="raw-modal-content topic-message-content">{message.content ?? '[empty]'}</pre>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-card">
                  <p>当前对话下没有消息内容。</p>
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
