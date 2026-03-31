import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type { PortfolioProjectRow, PortfolioSummary } from '../types';

type ProjectPortfolioPanelProps = {
  actorId: string;
  selectedProjectId: string;
  onOpenProject: (projectId: string) => void;
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

function PortfolioStatCard({ label, value, meta }: { label: string; value: string | number; meta: string }) {
  return (
    <article className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <small className="stat-meta">{meta}</small>
    </article>
  );
}

export function ProjectPortfolioPanel({
  actorId,
  selectedProjectId,
  onOpenProject,
  onFeedback,
}: ProjectPortfolioPanelProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [rows, setRows] = useState<PortfolioProjectRow[]>([]);
  const [businessDate, setBusinessDate] = useState(getTodayDateString());
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const [summaryResult, projectsResult] = await Promise.all([
          api.getPortfolioSummary(actorId, businessDate),
          api.getPortfolioProjects(actorId, businessDate),
        ]);

        if (cancelled) return;
        setSummary(summaryResult.summary);
        setRows(projectsResult.rows);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, businessDate, refreshKey, onFeedback]);

  return (
    <section className="section">
      <div className="section-head">
        <div>
          <p className="eyebrow">Portfolio</p>
          <h2>项目组合看板</h2>
        </div>
        <div className="button-row">
          <span className="muted">{loading ? '正在刷新组合数据...' : `共 ${rows.length} 个项目`}</span>
          <label className="field portfolio-date-field">
            <span>业务日</span>
            <input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} />
          </label>
          <button className="secondary" onClick={() => setBusinessDate(getTodayDateString())}>回到今日</button>
          <button className="ghost" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
        </div>
      </div>

      <div className="portfolio-stats-grid">
        <PortfolioStatCard label="项目数" value={summary?.projectCount ?? 0} meta="当前组合范围" />
        <PortfolioStatCard label="今日来访" value={summary?.visitCustomerCount ?? 0} meta={`首访 ${summary?.firstVisitCount ?? 0} / 复访 ${summary?.revisitCount ?? 0}`} />
        <PortfolioStatCard label="首访" value={summary?.firstVisitCount ?? 0} meta="" />
        <PortfolioStatCard label="复访" value={summary?.revisitCount ?? 0} meta="" />
        <PortfolioStatCard label="高意向" value={summary?.highIntentCount ?? 0} meta="A / B 类客户" />
        <PortfolioStatCard label="中低意向" value={summary?.lowMediumIntentCount ?? 0} meta={`C ${summary?.cIntentCount ?? 0} / D ${summary?.dIntentCount ?? 0}`} />
        <PortfolioStatCard label="待补信息" value={summary?.missingIntentCount ?? 0} meta="独立标签，不等于 C/D" />
      </div>

      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="member-table portfolio-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>成员</th>
                <th>来访</th>
                <th>首访</th>
                <th>复访</th>
                <th>A/B</th>
                <th>C/D</th>
                <th>待补</th>
                <th>辅助</th>
                <th>最新日报</th>
                <th>任务</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId} className={selectedProjectId === row.projectId ? 'portfolio-row-selected' : ''}>
                  <td className="portfolio-project-cell">
                    <button className="table-link-button portfolio-open-button" type="button" onClick={() => onOpenProject(row.projectId)}>
                      {row.projectName}
                    </button>
                    <span className="member-subtext">{row.description || '暂无项目描述'}</span>
                    <span className="member-subtext">{row.actorRole === 'system_admin' ? '系统管理员视角' : '项目管理员视角'}</span>
                  </td>
                  <td>
                    <strong>{row.memberCount}</strong>
                    <span className="member-subtext">已配置 {row.managedMemberCount}</span>
                  </td>
                  <td>{row.visitCustomerCount}</td>
                  <td>{row.firstVisitCount}</td>
                  <td>{row.revisitCount}</td>
                  <td>{row.highIntentCount}</td>
                  <td>{row.lowMediumIntentCount}</td>
                  <td>{row.missingIntentCount}</td>
                  <td>
                    <strong>新增 {row.newTopicCount}</strong>
                    <span className="member-subtext">活跃 {row.activeTopicCount}</span>
                    <span className="member-subtext">成员 {row.activeMemberCount}</span>
                  </td>
                  <td>
                    <strong>{row.latestReportBusinessDate ?? '暂无'}</strong>
                    <span className="member-subtext">{formatTime(row.latestReportGeneratedAt)}</span>
                  </td>
                  <td>
                    <strong>{row.runningJobCount}</strong>
                    <span className="member-subtext">失败 {row.failedJobCount}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-card">
          <p>当前没有可展示的项目组合数据。</p>
        </div>
      )}
    </section>
  );
}
