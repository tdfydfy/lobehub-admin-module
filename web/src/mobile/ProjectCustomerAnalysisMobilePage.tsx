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

type FeedbackTone = 'info' | 'success' | 'danger';

type MobileCustomerAnalysisPageProps = {
  actorId: string;
  projectId: string;
  onFeedback: (message: string, tone?: FeedbackTone) => void;
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

function getMessageMeta(message: ProjectCustomerAnalysisMessage) {
  const parts = [buildRangeLabel(message.rangePreset, message.dateFrom, message.dateTo)];

  if (message.role === 'assistant' && message.modelName) {
    parts.push(`${message.modelProvider ?? 'model'} / ${message.modelName}`);
  }

  return parts.filter(Boolean).join(' · ');
}

function upsertSession(sessions: ProjectCustomerAnalysisSession[], session: ProjectCustomerAnalysisSession) {
  return [session, ...sessions.filter((item) => item.id !== session.id)];
}

export function ProjectCustomerAnalysisMobilePage({
  actorId,
  projectId,
  onFeedback,
}: MobileCustomerAnalysisPageProps) {
  const [sessions, setSessions] = useState<ProjectCustomerAnalysisSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [sessionDetail, setSessionDetail] = useState<ProjectCustomerAnalysisSessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<ProjectCustomerAnalysisJob | null>(null);
  const [prompt, setPrompt] = useState('');
  const [rangePreset, setRangePreset] = useState<CustomerAnalysisRangePreset>('last7days');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [timerNow, setTimerNow] = useState(() => Date.now());

  useEffect(() => {
    setSessions([]);
    setSelectedSessionId('');
    setSessionDetail(null);
    setActiveJob(null);
    setPrompt('');
    setRangePreset('last7days');
    setDateFrom('');
    setDateTo('');
  }, [projectId]);

  useEffect(() => {
    if (!actorId || !projectId) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
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
        if (!cancelled) onFeedback((error as Error).message, 'danger');
      } finally {
        if (!cancelled) setLoading(false);
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
        if (!cancelled) onFeedback((error as Error).message, 'danger');
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
              onFeedback('自由盘点已完成', 'success');
            } else if (result.job.status === 'failed') {
              onFeedback(result.job.errorMessage || '自由盘点任务失败', 'danger');
            }

            setRefreshKey((value) => value + 1);
          }
        } catch (error) {
          if (!cancelled) onFeedback((error as Error).message, 'danger');
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
    setCreatingSession(true);
    try {
      const result = await api.createProjectCustomerAnalysisSession(actorId, projectId);
      setSessions((current) => upsertSession(current, result.session));
      setSelectedSessionId(result.session.id);
      setSessionDetail(result);
      setActiveJob(result.activeJob);
      onFeedback('已创建自由盘点会话', 'success');
      return result;
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
      return null;
    } finally {
      setCreatingSession(false);
    }
  }

  function validatePromptRange() {
    if (!prompt.trim()) {
      onFeedback('请输入自由盘点提示词', 'danger');
      return false;
    }

    if (rangePreset === 'custom') {
      if (!dateFrom || !dateTo) {
        onFeedback('请填写自定义开始和结束日期', 'danger');
        return false;
      }

      if (dateFrom > dateTo) {
        onFeedback('开始日期不能晚于结束日期', 'danger');
        return false;
      }
    }

    return true;
  }

  async function handleSubmit() {
    if (!validatePromptRange()) return;

    if (currentJob && isActiveJob(currentJob)) {
      onFeedback('当前会话已有任务在运行，请等待完成', 'info');
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
      onFeedback('已提交自由盘点任务', 'success');
    } catch (error) {
      onFeedback((error as Error).message, 'danger');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mobile-page">
      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">自由盘点</p>
            <h2>自由盘点</h2>
          </div>
          <button className="mobile-button ghost" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            刷新
          </button>
        </div>
        <p className="mobile-muted">移动端支持自由提示词，但保持轻量展示，便于快速发起和查看结论。</p>
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Composer</p>
            <h3>输入提示词</h3>
          </div>
          <span className="mobile-muted">{buildRangeLabel(rangePreset, dateFrom || undefined, dateTo || undefined)}</span>
        </div>

        <div className="mobile-analysis-preset-row">
          {promptPresets.map((preset) => (
            <button key={preset.label} className="mobile-chip-button" type="button" onClick={() => {
              setPrompt(preset.prompt);
              setRangePreset(preset.rangePreset);
              if (preset.rangePreset !== 'custom') {
                setDateFrom('');
                setDateTo('');
              }
            }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="mobile-analysis-filter-grid">
          <label className="mobile-field">
            <span>分析窗口</span>
            <select value={rangePreset} onChange={(event) => setRangePreset(event.target.value as CustomerAnalysisRangePreset)}>
              <option value="today">今日</option>
              <option value="last7days">近 7 天</option>
              <option value="last30days">近 30 天</option>
              <option value="custom">自定义</option>
            </select>
          </label>

          {rangePreset === 'custom' ? (
            <>
              <label className="mobile-field">
                <span>开始日期</span>
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label className="mobile-field">
                <span>结束日期</span>
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </label>
            </>
          ) : null}
        </div>

        <label className="mobile-field mobile-analysis-input">
          <span>管理提示词</span>
          <textarea
            rows={6}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：盘点本周高意向客户，并说明为什么这些客户更可能成交。"
          />
        </label>

        <div className="mobile-action-row mobile-analysis-actions">
          <button
            className="mobile-button primary"
            type="button"
            disabled={submitting || isActiveJob(currentJob)}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '提交中...' : isActiveJob(currentJob) ? `分析中 ${currentJobElapsed}` : '提交分析任务'}
          </button>
          <button className="mobile-button secondary" type="button" disabled={creatingSession} onClick={() => void createSession()}>
            {creatingSession ? '创建中...' : '新建会话'}
          </button>
        </div>
      </div>

      {currentJob ? (
        <div className="mobile-card">
          <div className="mobile-section-head">
            <div>
              <p className="mobile-eyebrow">Task</p>
              <h3>{getJobStatusLabel(currentJob.status)}</h3>
            </div>
            {isActiveJob(currentJob) ? <span className="mobile-muted">已耗时 {currentJobElapsed}</span> : null}
          </div>
          <div className="mobile-chip-row">
            <span className="mobile-chip active">{buildRangeLabel(currentJob.rangePreset, currentJob.dateFrom, currentJob.dateTo)}</span>
            {currentJob.modelName ? <span className="mobile-chip">{currentJob.modelName}</span> : null}
            {currentJob.errorMessage ? <span className="mobile-chip danger">{currentJob.errorMessage}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Sessions</p>
            <h3>最近会话</h3>
          </div>
          <span className="mobile-muted">{loading ? '加载中...' : `${sessions.length} 个会话`}</span>
        </div>

        {sessions.length > 0 ? (
          <div className="mobile-stack">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`mobile-list-button mobile-analysis-session-item${selectedSessionId === session.id ? ' active' : ''}`}
                onClick={() => setSelectedSessionId(session.id)}
              >
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.lastMessagePreview || '尚未开始对话'}</p>
                </div>
                <div className="mobile-list-meta">
                  <span>{session.messageCount} 条</span>
                  <span>{formatTime(session.lastMessageAt ?? session.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="mobile-muted">当前还没有自由盘点会话。</p>
        )}
      </div>

      <div className="mobile-card">
        <div className="mobile-section-head">
          <div>
            <p className="mobile-eyebrow">Conversation</p>
            <h3>{currentSession?.title ?? '选择一个会话'}</h3>
          </div>
          <span className="mobile-muted">
            {currentSession ? `最近更新 ${formatTime(currentSession.lastMessageAt ?? currentSession.updatedAt)}` : '暂无会话详情'}
          </span>
        </div>

        {detailLoading ? <p className="mobile-muted">正在加载会话...</p> : null}

        {!detailLoading && sessionDetail && sessionDetail.messages.length > 0 ? (
          <div className="mobile-stack">
            {sessionDetail.messages.map((message) => (
              <div key={message.id} className="mobile-inline-card">
                <div className="mobile-stack">
                  <strong>{message.role === 'assistant' ? '自由盘点助手' : '管理员'}</strong>
                  <p className="mobile-muted">{formatTime(message.createdAt)}</p>
                  <div className="mobile-chip-row">
                    <span className="mobile-chip">{getMessageMeta(message)}</span>
                  </div>
                  <pre className="mobile-pre">{message.content}</pre>
                </div>
              </div>
            ))}

            {currentJob && isActiveJob(currentJob) ? (
              <div className="mobile-inline-card">
                <div className="mobile-stack">
                  <strong>自由盘点助手</strong>
                  <p className="mobile-muted">{getJobStatusLabel(currentJob.status)} · 已耗时 {currentJobElapsed}</p>
                  <pre className="mobile-pre">正在生成分析结果，请稍候...</pre>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!detailLoading && !sessionDetail ? <p className="mobile-muted">选择一个会话后查看消息。</p> : null}
        {!detailLoading && sessionDetail && sessionDetail.messages.length === 0 ? <p className="mobile-muted">这个会话还没有消息。</p> : null}
      </div>
    </div>
  );
}
