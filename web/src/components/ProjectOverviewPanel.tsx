import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type { ProjectOverviewResult } from '../types';

type ProjectOverviewPanelProps = {
  actorId: string;
  projectId: string;
  onFeedback: (message: string) => void;
};

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function OverviewStatCard({ label, value, meta }: { label: string; value: string | number; meta: string }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <small className="stat-meta">{meta}</small>
    </article>
  );
}

export function ProjectOverviewPanel({
  actorId,
  projectId,
  onFeedback,
}: ProjectOverviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<ProjectOverviewResult['overview'] | null>(null);
  const [businessDate, setBusinessDate] = useState(getTodayDateString());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const result = await api.getProjectOverview(actorId, projectId, businessDate);
        if (!cancelled) setOverview(result.overview);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, projectId, businessDate, refreshKey, onFeedback]);

  return (
    <div className="report-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Overview</p>
            <h3>项目经营概览</h3>
          </div>
          <div className="button-row">
            <span className="muted">{loading ? '正在刷新...' : `业务日 ${overview?.project.businessDate ?? '-'}`}</span>
            <label className="field portfolio-date-field">
              <span>业务日</span>
              <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
            </label>
            <button className="secondary" onClick={() => setBusinessDate(getTodayDateString())}>回到今日</button>
            <button className="ghost" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
          </div>
        </div>

        {overview ? (
          <>
            <div className="daily-report-summary-card">
              <p className="eyebrow">Window</p>
              <h4>{overview.project.projectName}</h4>
              <p>{overview.project.description || '暂无项目描述'}</p>
              <div className="report-pill-row">
                <span className="report-pill active">窗口 {formatTime(overview.project.windowStartAt)} ~ {formatTime(overview.project.windowEndAt)}</span>
                <span className="report-pill">时区 {overview.project.timezone}</span>
                <span className="report-pill">营业日截止 {overview.project.closeTimeLocal}</span>
                <span className="report-pill">{overview.project.isPartial ? '当前为当日实时窗口' : '当前为完整营业日窗口'}</span>
              </div>
            </div>

            <div className="portfolio-stats-grid">
              <OverviewStatCard label="今日来访" value={overview.stats.visitCustomerCount} meta={`首访 ${overview.stats.firstVisitCount} / 复访 ${overview.stats.revisitCount}`} />
              <OverviewStatCard label="首访" value={overview.stats.firstVisitCount} meta="" />
              <OverviewStatCard label="复访" value={overview.stats.revisitCount} meta="" />
              <OverviewStatCard label="高意向" value={overview.stats.highIntentCount} meta={`A ${overview.stats.aIntentCount} / B ${overview.stats.bIntentCount}`} />
              <OverviewStatCard label="中低意向" value={overview.stats.cIntentCount + overview.stats.dIntentCount} meta={`C ${overview.stats.cIntentCount} / D ${overview.stats.dIntentCount}`} />
              <OverviewStatCard label="待补信息" value={overview.stats.missingIntentCount} meta="独立标签，不等于 C/D" />
            </div>

            <div className="report-pill-row">
              <span className="report-pill">新增对话 {overview.stats.newTopicCount}</span>
              <span className="report-pill">活跃对话 {overview.stats.activeTopicCount}</span>
              <span className="report-pill">活跃成员 {overview.stats.activeMemberCount}</span>
              <span className="report-pill">总成员 {overview.members.totalMembers}</span>
              <span className="report-pill">客户消息 {overview.stats.userMessageCount}</span>
              <span className="report-pill">助手消息 {overview.stats.assistantMessageCount}</span>
            </div>

            <div className="detail-grid">
              <article className="section">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Attention Topics</p>
                    <h3>今日重点客户组</h3>
                  </div>
                </div>
                {overview.attentionTopics.length > 0 ? (
                  <div className="portfolio-list">
                    {overview.attentionTopics.map((item) => (
                      <article key={item.topicId} className="portfolio-list-card">
                        <strong>{item.title}</strong>
                        <p>{item.ownerDisplayName} · {item.ownerEmail ?? item.ownerUserId}</p>
                        <div className="report-pill-row">
                          <span className="report-pill active">{item.latestIntentGrade ?? item.latestIntentBand ?? '待补信息'}</span>
                          <span className="report-pill">{item.visitType === 'first' ? '首访' : item.visitType === 'revisit' ? '复访' : '待识别'}</span>
                          <span className="report-pill">消息 {item.visibleMessageCount}</span>
                        </div>
                        <p className="muted">上次来访 {formatTime(item.previousVisitAt)} · 本次活跃 {formatTime(item.lastActiveAt)}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前窗口内暂无重点客户组。</p>
                )}
              </article>

              <article className="section">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Attention Members</p>
                    <h3>今日活跃成员</h3>
                  </div>
                </div>
                {overview.attentionMembers.length > 0 ? (
                  <div className="portfolio-list">
                    {overview.attentionMembers.map((item) => (
                      <article key={item.userId} className="portfolio-list-card">
                        <strong>{item.displayName}</strong>
                        <p>{item.email ?? item.userId}</p>
                        <div className="report-pill-row">
                          <span className="report-pill active">活跃 {item.activeTopicCount}</span>
                          <span className="report-pill">来访 {item.visitCustomerCount}</span>
                          <span className="report-pill">复访 {item.revisitCount}</span>
                        </div>
                        <p className="muted">最近活跃 {formatTime(item.lastActiveAt)}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前窗口内暂无活跃成员。</p>
                )}
              </article>
            </div>

            <div className="detail-grid">
              <article className="section">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Trend</p>
                    <h3>近 7 日趋势</h3>
                  </div>
                </div>
                {overview.trend.length > 0 ? (
                  <div className="portfolio-list">
                    {overview.trend.map((item) => (
                      <article key={item.businessDate} className="portfolio-list-card">
                        <strong>{item.businessDate}</strong>
                        <p>来访 {item.visitCustomerCount} · 首访 {item.firstVisitCount} · 复访 {item.revisitCount}</p>
                        <p className="muted">新增 {item.newTopicCount} · 活跃 {item.activeTopicCount} · A/B {item.highIntentCount} · 待补 {item.missingIntentCount}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前还没有趋势数据。</p>
                )}
              </article>

              <article className="section">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Daily</p>
                    <h3>日报与任务</h3>
                  </div>
                </div>
                <div className="portfolio-list">
                  <article className="portfolio-list-card">
                    <strong>最新日报</strong>
                    {overview.latestReport ? (
                      <>
                        <p>{overview.latestReport.businessDate} · 版本 {overview.latestReport.revision}</p>
                        <p className="muted">来访 {overview.latestReport.visitedCustomerCount} · 对话 {overview.latestReport.activeTopicCount} · {formatTime(overview.latestReport.generatedAt)}</p>
                      </>
                    ) : (
                      <p className="muted">当前还没有生成日报。</p>
                    )}
                  </article>
                  <article className="portfolio-list-card">
                    <strong>运行中任务</strong>
                    {overview.runningJob ? (
                      <>
                        <p>{overview.runningJob.businessDate} · {overview.runningJob.status}</p>
                        <p className="muted">开始于 {formatTime(overview.runningJob.startedAt ?? overview.runningJob.createdAt)}</p>
                      </>
                    ) : (
                      <p className="muted">当前没有运行中的日报任务。</p>
                    )}
                  </article>
                </div>
              </article>
            </div>
          </>
        ) : (
          <div className="empty-card">
            <p>{loading ? '正在加载项目概览...' : '当前还没有概览数据。'}</p>
          </div>
        )}
      </section>
    </div>
  );
}
