import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type {
  CustomerAnalysisRangePreset,
  ProjectCustomerAnalysisJob,
  ProjectCustomerAnalysisMessage,
  ProjectCustomerAnalysisSession,
  ProjectCustomerAnalysisSessionDetail,
} from '../types';

type ProjectCustomerAnalysisPanelProps = {
  actorId: string;
  projectId: string;
  onFeedback: (message: string) => void;
};

type PromptPreset = {
  label: string;
  prompt: string;
  rangePreset: CustomerAnalysisRangePreset;
};

const promptPresets: PromptPreset[] = [
  {
    label: '近 7 天高意向',
    prompt: '盘点近 7 天高意向的客户，按优先级排序，并说明判断依据和建议跟进动作。',
    rangePreset: 'last7days',
  },
  {
    label: '近期成交机会',
    prompt: '列出近期最可能成交的客户，说明他们为什么可能成交、还差什么条件、管理层要提供什么支持。',
    rangePreset: 'last7days',
  },
  {
    label: '月度热门话题',
    prompt: '分析本月客户关注最多的话题是什么，为什么会成为高频关注点，并说明涉及哪些客户组。',
    rangePreset: 'last30days',
  },
  {
    label: '管理卡点',
    prompt: '分析当前最需要管理层出手解决的卡点是什么，分别影响哪些客户组，建议给出哪些动作或道具。',
    rangePreset: 'last30days',
  },
];

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function buildRangeLabel(
  rangePreset: CustomerAnalysisRangePreset | null,
  dateFrom?: string | null,
  dateTo?: string | null,
) {
  if (!rangePreset) return '未指定区间';

  switch (rangePreset) {
    case 'today':
      return dateFrom ? `今日 (${dateFrom})` : '今日';
    case 'last7days':
      return dateFrom && dateTo ? `近 7 天 (${dateFrom} ~ ${dateTo})` : '近 7 天';
    case 'last30days':
      return dateFrom && dateTo ? `近 30 天 (${dateFrom} ~ ${dateTo})` : '近 30 天';
    case 'custom':
    default:
      return dateFrom && dateTo ? `自定义 (${dateFrom} ~ ${dateTo})` : '自定义区间';
  }
}

function getMessageMeta(message: ProjectCustomerAnalysisMessage) {
  const parts = [buildRangeLabel(message.rangePreset, message.dateFrom, message.dateTo)];

  if (message.role === 'assistant' && message.modelName) {
    parts.push(`${message.modelProvider ?? 'model'} / ${message.modelName}`);
  }

  return parts.filter(Boolean).join(' · ');
}

function getGuideText() {
  return [
    '系统会自动读取项目托管会话里的对话记录，并结合当前输入的自由盘点提示词做管理分析。',
    '输出原则：',
    '1. 只基于已提供的对话记录判断，不编造客户情况。',
    '2. 优先给结论，再补充证据和建议动作。',
    '3. 涉及客户名单时，尽量标明销售员、对话标题和判断原因。',
    '4. 如果信息不足，会直接说明缺口。',
  ].join('\n');
}

function upsertSession(
  sessions: ProjectCustomerAnalysisSession[],
  session: ProjectCustomerAnalysisSession,
) {
  return [session, ...sessions.filter((item) => item.id !== session.id)];
}

function isActiveJob(job: ProjectCustomerAnalysisJob | null | undefined) {
  return Boolean(job && (job.status === 'pending' || job.status === 'running'));
}

function getJobStatusLabel(status: ProjectCustomerAnalysisJob['status']) {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'running':
      return '生成中';
    case 'pending':
      return '排队中';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function formatElapsedSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function getElapsedSeconds(job: ProjectCustomerAnalysisJob, nowMs: number) {
  const startedAt = Date.parse(job.startedAt ?? job.createdAt);

  if (!Number.isFinite(startedAt)) {
    return 0;
  }

  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

export function ProjectCustomerAnalysisPanel({
  actorId,
  projectId,
  onFeedback,
}: ProjectCustomerAnalysisPanelProps) {
  const [sessions, setSessions] = useState<ProjectCustomerAnalysisSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionDetail, setSessionDetail] = useState<ProjectCustomerAnalysisSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [rangePreset, setRangePreset] = useState<CustomerAnalysisRangePreset>('last7days');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeJob, setActiveJob] = useState<ProjectCustomerAnalysisJob | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());

  useEffect(() => {
    setSessions([]);
    setSelectedSessionId('');
    setSessionDetail(null);
    setPrompt('');
    setRangePreset('last7days');
    setDateFrom('');
    setDateTo('');
    setActiveJob(null);
    setTimerNow(Date.now());
  }, [projectId]);

  useEffect(() => {
    if (!actorId || !projectId) return;
    let cancelled = false;

    void (async () => {
      setSessionsLoading(true);
      try {
        const result = await api.listProjectCustomerAnalysisSessions(actorId, projectId);
        if (cancelled) return;
        setSessions(result.sessions);
        setSelectedSessionId((current) => {
          if (current && result.sessions.some((item) => item.id === current)) {
            return current;
          }

          return result.sessions[0]?.id ?? '';
        });
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!actorId || !projectId || !selectedSessionId) {
      setSessionDetail(null);
      setActiveJob(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      setDetailLoading(true);
      try {
        const result = await api.getProjectCustomerAnalysisSession(actorId, projectId, selectedSessionId);
        if (cancelled) return;
        setSessionDetail(result);
        setActiveJob(result.activeJob);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, selectedSessionId, refreshKey, onFeedback]);

  useEffect(() => {
    if (!activeJob || !isActiveJob(activeJob)) return;

    const timer = window.setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    if (!actorId || !projectId || !selectedSessionId || !activeJob || activeJob.sessionId !== selectedSessionId || !isActiveJob(activeJob)) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await api.getProjectCustomerAnalysisJob(actorId, projectId, activeJob.id);
          if (cancelled) return;

          setActiveJob(result.job);

          if (!isActiveJob(result.job)) {
            window.clearInterval(timer);

            if (result.job.status === 'completed') {
              onFeedback('自由盘点已完成');
            } else if (result.job.status === 'failed') {
              onFeedback(result.job.errorMessage || '自由盘点任务失败');
            }

            setRefreshKey((value) => value + 1);
          }
        } catch (error) {
          if (!cancelled) onFeedback((error as Error).message);
          window.clearInterval(timer);
        }
      })();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [actorId, projectId, selectedSessionId, activeJob, onFeedback]);

  const currentSession = useMemo(
    () => sessionDetail?.session ?? sessions.find((item) => item.id === selectedSessionId) ?? null,
    [sessionDetail, sessions, selectedSessionId],
  );

  const currentJob = useMemo(() => {
    if (activeJob && activeJob.sessionId === selectedSessionId) {
      return activeJob;
    }

    return sessionDetail?.activeJob ?? null;
  }, [activeJob, sessionDetail, selectedSessionId]);

  const currentJobElapsed = currentJob ? formatElapsedSeconds(getElapsedSeconds(currentJob, timerNow)) : '';

  async function createSession() {
    if (!actorId || !projectId) return null;

    setCreatingSession(true);
    try {
      const result = await api.createProjectCustomerAnalysisSession(actorId, projectId);
      setSessions((current) => upsertSession(current, result.session));
      setSelectedSessionId(result.session.id);
      setSessionDetail(result);
      setActiveJob(result.activeJob);
      onFeedback('已创建新的自由盘点会话');
      return result;
    } catch (error) {
      onFeedback((error as Error).message);
      return null;
    } finally {
      setCreatingSession(false);
    }
  }

  function validatePromptRange() {
    if (!prompt.trim()) {
      onFeedback('请输入自由盘点提示词');
      return false;
    }

    if (rangePreset === 'custom') {
      if (!dateFrom || !dateTo) {
        onFeedback('自定义区间需要填写开始和结束日期');
        return false;
      }

      if (dateFrom > dateTo) {
        onFeedback('开始日期不能晚于结束日期');
        return false;
      }
    }

    return true;
  }

  async function handleSend() {
    if (!validatePromptRange()) return;

    if (currentJob && isActiveJob(currentJob)) {
      onFeedback('当前会话已有分析任务在运行，请等待完成');
      return;
    }

    let targetSessionId = selectedSessionId;

    if (!targetSessionId) {
      const created = await createSession();
      targetSessionId = created?.session.id ?? '';
    }

    if (!targetSessionId) return;

    setSubmitting(true);
    try {
      const result = await api.sendProjectCustomerAnalysisMessage(actorId, projectId, targetSessionId, {
        prompt: prompt.trim(),
        rangePreset,
        dateFrom: rangePreset === 'custom' ? dateFrom : undefined,
        dateTo: rangePreset === 'custom' ? dateTo : undefined,
      });

      setSessionDetail({
        session: result.session,
        messages: result.messages,
        activeJob: result.activeJob ?? result.job,
      });
      setSessions((current) => upsertSession(current, result.session));
      setSelectedSessionId(result.session.id);
      setActiveJob(result.job);
      setTimerNow(Date.now());
      setPrompt('');
      onFeedback('已提交自由盘点任务');
    } catch (error) {
      onFeedback((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function applyPreset(preset: PromptPreset) {
    setPrompt(preset.prompt);
    setRangePreset(preset.rangePreset);
    if (preset.rangePreset !== 'custom') {
      setDateFrom('');
      setDateTo('');
    }
  }

  return (
    <div className="report-page customer-analysis-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">自由盘点</p>
            <h3>自由盘点</h3>
          </div>
          <div className="button-row">
            <button className="ghost" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
              刷新
            </button>
            <button className="primary" type="button" disabled={creatingSession} onClick={() => void createSession()}>
              {creatingSession ? '创建中...' : '新建会话'}
            </button>
          </div>
        </div>

        <details className="daily-report-settings-panel">
          <summary>查看分析原则</summary>
          <label className="field">
            <span>系统分析说明</span>
            <textarea rows={6} value={getGuideText()} readOnly />
          </label>
        </details>
      </section>

      <section className="section customer-analysis-layout">
        <aside className="customer-analysis-sidebar">
          <div className="section-head">
            <div>
              <p className="eyebrow">Sessions</p>
              <h3>会话列表</h3>
            </div>
            <span className="muted">{sessionsLoading ? '加载中...' : `${sessions.length} 个会话`}</span>
          </div>

          <div className="customer-analysis-session-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`customer-analysis-session-item${selectedSessionId === session.id ? ' active' : ''}`}
                onClick={() => setSelectedSessionId(session.id)}
              >
                <strong>{session.title}</strong>
                <span className="member-subtext">{session.messageCount} 条消息</span>
                <span className="member-subtext">{formatTime(session.lastMessageAt ?? session.createdAt)}</span>
                <p>{session.lastMessagePreview || '尚未开始对话'}</p>
              </button>
            ))}

            {!sessionsLoading && sessions.length === 0 ? (
              <div className="empty-card">
                <p>当前还没有自由盘点会话，点击“新建会话”开始。</p>
              </div>
            ) : null}
          </div>
        </aside>

        <div className="customer-analysis-main">
          <div className="customer-analysis-chat-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Conversation</p>
                <h3>{currentSession?.title ?? '选择或新建一个会话'}</h3>
              </div>
              <span className="muted">
                {currentJob && isActiveJob(currentJob)
                  ? `${getJobStatusLabel(currentJob.status)} · ${currentJobElapsed}`
                  : currentSession
                    ? `最近更新 ${formatTime(currentSession.lastMessageAt ?? currentSession.updatedAt)}`
                    : '管理员可保存分析结论'}
              </span>
            </div>

            {currentJob ? (
              <div className={`customer-analysis-job-card${isActiveJob(currentJob) ? ' active' : ''}`}>
                <div>
                  <strong>{getJobStatusLabel(currentJob.status)}</strong>
                  <p>{buildRangeLabel(currentJob.rangePreset, currentJob.dateFrom, currentJob.dateTo)}</p>
                </div>
                <div className="customer-analysis-job-meta">
                  {isActiveJob(currentJob) ? <span className="report-pill active">已耗时 {currentJobElapsed}</span> : null}
                  {currentJob.modelName ? <span className="report-pill">{currentJob.modelName}</span> : null}
                  {currentJob.errorMessage ? <span className="report-pill danger">{currentJob.errorMessage}</span> : null}
                </div>
              </div>
            ) : null}

            {detailLoading ? <p className="muted">正在加载会话...</p> : null}

            {!detailLoading && sessionDetail && sessionDetail.messages.length > 0 ? (
              <div className="customer-analysis-message-list">
                {sessionDetail.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`customer-analysis-message-card${message.role === 'assistant' ? ' assistant' : ' user'}`}
                  >
                    <div className="customer-analysis-message-head">
                      <strong>{message.role === 'assistant' ? '自由盘点助手' : '管理员'}</strong>
                      <span className="muted">{formatTime(message.createdAt)}</span>
                    </div>
                    <div className="report-pill-row">
                      <span className="report-pill">{getMessageMeta(message)}</span>
                    </div>
                    <pre className="customer-analysis-message-content">{message.content}</pre>
                  </article>
                ))}

                {currentJob && isActiveJob(currentJob) ? (
                  <article className="customer-analysis-message-card assistant pending">
                    <div className="customer-analysis-message-head">
                      <strong>自由盘点助手</strong>
                      <span className="muted">{getJobStatusLabel(currentJob.status)}</span>
                    </div>
                    <div className="report-pill-row">
                      <span className="report-pill active">已耗时 {currentJobElapsed}</span>
                      <span className="report-pill">{buildRangeLabel(currentJob.rangePreset, currentJob.dateFrom, currentJob.dateTo)}</span>
                    </div>
                    <pre className="customer-analysis-message-content">正在生成分析结果，请稍候...</pre>
                  </article>
                ) : null}
              </div>
            ) : null}

            {!detailLoading && !sessionDetail ? (
              <div className="empty-card">
                <p>左侧选择一个会话，或者新建后直接输入自由盘点问题。</p>
              </div>
            ) : null}

            {!detailLoading && sessionDetail && sessionDetail.messages.length === 0 ? (
              <div className="empty-card">
                <p>这个会话还没有消息。你可以用下面的快捷问题，或者直接输入自由盘点提示词。</p>
              </div>
            ) : null}
          </div>

          <div className="customer-analysis-composer-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Composer</p>
                <h3>输入自由盘点提示词</h3>
              </div>
              <span className="muted">
                当前区间：{buildRangeLabel(rangePreset, dateFrom || undefined, dateTo || undefined)}
              </span>
            </div>

            <div className="customer-analysis-preset-row">
              {promptPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="secondary"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="customer-analysis-filter-grid">
              <label className="field">
                <span>分析窗口</span>
                <select
                  value={rangePreset}
                  onChange={(event) => setRangePreset(event.target.value as CustomerAnalysisRangePreset)}
                >
                  <option value="today">今日</option>
                  <option value="last7days">近 7 天</option>
                  <option value="last30days">近 30 天</option>
                  <option value="custom">自定义</option>
                </select>
              </label>

              {rangePreset === 'custom' ? (
                <>
                  <label className="field">
                    <span>开始日期</span>
                    <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                  </label>
                  <label className="field">
                    <span>结束日期</span>
                    <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                  </label>
                </>
              ) : null}
            </div>

            <label className="field">
              <span>管理员口令</span>
              <textarea
                rows={7}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="例如：盘点本周高意向客户，并说明为什么这些客户更可能成交。"
              />
            </label>

            <div className="button-row">
              <button
                className="primary"
                type="button"
                disabled={submitting || isActiveJob(currentJob)}
                onClick={() => void handleSend()}
              >
                {submitting ? '提交中...' : isActiveJob(currentJob) ? `分析中 ${currentJobElapsed}` : '提交分析任务'}
              </button>
              <button className="ghost" type="button" onClick={() => setPrompt('')}>
                清空输入
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
