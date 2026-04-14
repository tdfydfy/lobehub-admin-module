import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type { SystemMetricsResult } from '../types';

type SystemMetricsPanelProps = {
  actorId: string;
  onOpenProject: (projectId: string) => void;
  onFeedback: (message: string) => void;
};

type MetricCardProps = {
  label: string;
  value: number;
  meta: string;
  fractionDigits?: number;
};

type TrendMetricKey = 'visitCustomerCount' | 'newTopicCount' | 'visibleMessageCount';
type TrendPoint = SystemMetricsResult['trend'][number];
type TrendSeriesConfig = {
  key: TrendMetricKey;
  label: string;
  stroke: string;
  surface: string;
};

const TREND_SERIES: TrendSeriesConfig[] = [
  {
    key: 'visitCustomerCount',
    label: '来访客户',
    stroke: '#a33f23',
    surface: 'rgba(163, 63, 35, 0.12)',
  },
  {
    key: 'newTopicCount',
    label: '新增对话',
    stroke: '#d18a2f',
    surface: 'rgba(209, 138, 47, 0.14)',
  },
  {
    key: 'visibleMessageCount',
    label: '有效消息',
    stroke: '#466657',
    surface: 'rgba(70, 102, 87, 0.14)',
  },
];

const TREND_CHART_WIDTH = 960;
const TREND_CHART_HEIGHT = 320;
const TREND_PADDING = {
  top: 20,
  right: 20,
  bottom: 44,
  left: 56,
};
const GRID_RATES = [1, 0.75, 0.5, 0.25, 0];

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function formatNumber(value?: number | null) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0);
}

function formatMetricValue(value?: number | null, fractionDigits = 0) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value ?? 0);
}

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function formatShortDate(value: string) {
  return value.slice(5).replace('-', '/');
}

function calculateAverageConversationTurns(messageCount?: number | null, topicCount?: number | null) {
  if (!topicCount || topicCount <= 0) return 0;
  return (messageCount ?? 0) / topicCount;
}

function MetricCard({ label, value, meta, fractionDigits = 0 }: MetricCardProps) {
  return (
    <article className="stat-card system-metric-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{formatMetricValue(value, fractionDigits)}</strong>
      <small className="stat-meta">{meta}</small>
    </article>
  );
}

function setLastDays(days: number, dateTo: string) {
  return {
    dateFrom: addDays(dateTo, -(days - 1)),
    dateTo,
  };
}

function getTrendTickIndexes(length: number, maxTicks = 6) {
  if (length <= 0) return [];
  if (length <= maxTicks) {
    return Array.from({ length }, (_, index) => index);
  }

  const indexes = new Set<number>([0, length - 1]);

  for (let index = 1; index < maxTicks - 1; index += 1) {
    indexes.add(Math.round((index * (length - 1)) / (maxTicks - 1)));
  }

  return [...indexes].sort((left, right) => left - right);
}

function getTrendSummary(points: TrendPoint[], key: TrendMetricKey) {
  let total = 0;
  let peakValue = 0;
  let peakDate = '';

  for (const point of points) {
    const value = point[key];
    total += value;

    if (!peakDate || value > peakValue) {
      peakValue = value;
      peakDate = point.businessDate;
    }
  }

  return {
    total,
    peakValue,
    peakDate,
  };
}

export function SystemMetricsPanel({
  actorId,
  onOpenProject,
  onFeedback,
}: SystemMetricsPanelProps) {
  const today = getTodayDateString();
  const [asOfDate, setAsOfDate] = useState(today);
  const [dateFrom, setDateFrom] = useState(addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const [metrics, setMetrics] = useState<SystemMetricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const result = await api.getSystemMetrics(actorId, { asOfDate, dateFrom, dateTo });
        if (!cancelled) setMetrics(result);
      } catch (error) {
        if (!cancelled) onFeedback((error as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actorId, asOfDate, dateFrom, dateTo, refreshKey, onFeedback]);

  const snapshot = metrics?.snapshot;
  const range = metrics?.range;
  const trend = metrics?.trend ?? [];
  const snapshotAverageConversationTurns = calculateAverageConversationTurns(
    snapshot?.cumulativeVisibleMessageCount,
    snapshot?.cumulativeTopicCount,
  );
  const rangeAverageConversationTurns = calculateAverageConversationTurns(
    range?.visibleMessageCount,
    range?.activeTopicCount,
  );
  const trendMaxValue = Math.max(
    1,
    ...trend.flatMap((item) => TREND_SERIES.map((series) => item[series.key])),
  );
  const plotWidth = TREND_CHART_WIDTH - TREND_PADDING.left - TREND_PADDING.right;
  const plotHeight = TREND_CHART_HEIGHT - TREND_PADDING.top - TREND_PADDING.bottom;
  const showTrendPoints = trend.length <= 31;
  const tickIndexes = getTrendTickIndexes(trend.length);
  const trendSeries = TREND_SERIES.map((series) => {
    const points = trend.map((item, index) => {
      const x = trend.length === 1
        ? TREND_PADDING.left + plotWidth / 2
        : TREND_PADDING.left + (plotWidth * index) / (trend.length - 1);
      const y = TREND_PADDING.top + plotHeight - (item[series.key] / trendMaxValue) * plotHeight;

      return {
        businessDate: item.businessDate,
        value: item[series.key],
        x,
        y,
      };
    });

    return {
      ...series,
      summary: getTrendSummary(trend, series.key),
      path: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
      points,
    };
  });

  function applyPreset(days: number) {
    const next = setLastDays(days, today);
    setAsOfDate(today);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
  }

  return (
    <div className="system-metrics-page">
      <section className="section">
        <div className="section-head system-metrics-head">
          <div>
            <p className="eyebrow">System Metrics</p>
            <h2>平台统计</h2>
            <p className="muted">累计按节点日期查看，区间按业务日期和创建时间统计。</p>
          </div>
          <div className="button-row">
            <span className="muted">{loading ? '正在刷新平台统计...' : `范围 ${dateFrom} ~ ${dateTo}`}</span>
            <button className="secondary" onClick={() => applyPreset(1)}>今日</button>
            <button className="secondary" onClick={() => applyPreset(7)}>近 7 天</button>
            <button className="secondary" onClick={() => applyPreset(30)}>近 30 天</button>
            <button className="ghost" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button>
          </div>
        </div>

        <div className="report-filter-grid system-metrics-filter-grid">
          <label className="field">
            <span>节点日期</span>
            <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} />
          </label>
          <label className="field">
            <span>区间开始</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>区间结束</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
        </div>

        <div className="daily-report-summary-card system-metrics-hero">
          <div>
            <p className="eyebrow">Snapshot</p>
            <h3>截止 {metrics?.filters.asOfDate ?? asOfDate} 的平台累计</h3>
            <p>
              项目 {formatNumber(snapshot?.projectCount)} 个，成员绑定 {formatNumber(snapshot?.totalMemberBindingCount)} 个，
              托管会话 {formatNumber(snapshot?.managedSessionCount)} 个。
            </p>
          </div>
          <div className="report-pill-row">
            <span className="report-pill active">时区 {metrics?.filters.timezone ?? 'Asia/Shanghai'}</span>
            <span className="report-pill">日报 {formatNumber(snapshot?.dailyReportCount)}</span>
            <span className="report-pill">自由盘点 {formatNumber(snapshot?.customerAnalysisJobCount)}</span>
          </div>
        </div>

        <div className="system-metric-section-title">
          <div>
            <p className="eyebrow">Total Snapshot</p>
            <h3>平台规模</h3>
          </div>
        </div>
        <div className="system-metrics-stats-grid">
          <MetricCard label="项目总数" value={snapshot?.projectCount ?? 0} meta="截止节点日期仍在系统内的项目" />
          <MetricCard label="成员绑定" value={snapshot?.totalMemberBindingCount ?? 0} meta={`管理员 ${formatNumber(snapshot?.adminBindingCount)} / 成员 ${formatNumber(snapshot?.memberBindingCount)}`} />
          <MetricCard label="已托管成员" value={snapshot?.managedMemberCount ?? 0} meta={`助手 ${formatNumber(snapshot?.managedAssistantCount)} / 会话 ${formatNumber(snapshot?.managedSessionCount)}`} />
          <MetricCard label="累计话题" value={snapshot?.cumulativeTopicCount ?? 0} meta="项目托管会话内的 topic" />
          <MetricCard label="累计消息" value={snapshot?.cumulativeVisibleMessageCount ?? 0} meta={`用户 ${formatNumber(snapshot?.cumulativeUserMessageCount)} / 助手 ${formatNumber(snapshot?.cumulativeAssistantMessageCount)}`} />
          <MetricCard label="平均对话次数" value={snapshotAverageConversationTurns} fractionDigits={1} meta={`累计消息 / 累计话题，约 ${formatMetricValue(snapshotAverageConversationTurns / 2, 1)} 轮来回`} />
          <MetricCard label="日报累计" value={snapshot?.dailyReportCount ?? 0} meta={`历史版本 ${formatNumber(snapshot?.dailyReportRevisionCount)}`} />
          <MetricCard label="自由盘点会话" value={snapshot?.customerAnalysisSessionCount ?? 0} meta="盘点对话会话数" />
          <MetricCard label="自由盘点任务" value={snapshot?.customerAnalysisJobCount ?? 0} meta={`成功 ${formatNumber(snapshot?.customerAnalysisCompletedJobCount)} / 失败 ${formatNumber(snapshot?.customerAnalysisFailedJobCount)}`} />
        </div>

        <div className="system-metric-section-title">
          <div>
            <p className="eyebrow">Range Metrics</p>
            <h3>区间新增与活跃</h3>
          </div>
        </div>
        <div className="system-metrics-stats-grid">
          <MetricCard label="新增项目" value={range?.newProjectCount ?? 0} meta={`新增管理员绑定 ${formatNumber(range?.newAdminBindingCount)}`} />
          <MetricCard label="新增成员" value={range?.newMemberBindingCount ?? 0} meta={`新增托管 ${formatNumber(range?.newManagedMemberCount)}`} />
          <MetricCard label="新增对话" value={range?.newTopicCount ?? 0} meta="区间内新建 topic" />
          <MetricCard label="活跃对话" value={range?.activeTopicCount ?? 0} meta={`按日合计 ${formatNumber(range?.activeTopicDayCount)}`} />
          <MetricCard label="来访客户" value={range?.visitCustomerCount ?? 0} meta={`首访 ${formatNumber(range?.firstVisitCount)} / 复访 ${formatNumber(range?.revisitCount)}`} />
          <MetricCard label="活跃成员" value={range?.activeMemberCount ?? 0} meta="区间内有有效消息的成员" />
          <MetricCard label="有效消息" value={range?.visibleMessageCount ?? 0} meta={`用户 ${formatNumber(range?.userMessageCount)} / 助手 ${formatNumber(range?.assistantMessageCount)}`} />
          <MetricCard label="平均对话次数" value={rangeAverageConversationTurns} fractionDigits={1} meta={`有效消息 / 活跃话题，约 ${formatMetricValue(rangeAverageConversationTurns / 2, 1)} 轮来回`} />
          <MetricCard label="内容产出" value={(range?.dailyReportCount ?? 0) + (range?.customerAnalysisJobCount ?? 0)} meta={`日报 ${formatNumber(range?.dailyReportCount)} / 盘点 ${formatNumber(range?.customerAnalysisJobCount)}`} />
        </div>

        <article className="section system-trend-section">
          <div className="section-head system-trend-head">
            <div>
              <p className="eyebrow">Trend</p>
              <h3>区间趋势</h3>
              <p className="muted">横向折线图对比来访客户、新增对话、有效消息。</p>
            </div>
            {trend.length > 0 ? (
              <div className="system-trend-legend">
                {trendSeries.map((series) => (
                  <article
                    key={series.key}
                    className="system-trend-legend-item"
                    style={{ background: series.surface }}
                  >
                    <span
                      className="system-trend-legend-swatch"
                      style={{ backgroundColor: series.stroke }}
                    />
                    <div>
                      <strong>{series.label}</strong>
                      <span className="member-subtext">
                        合计 {formatNumber(series.summary.total)} / 峰值 {formatNumber(series.summary.peakValue)}
                        {series.summary.peakDate ? ` · ${formatShortDate(series.summary.peakDate)}` : ''}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
          {trend.length > 0 ? (
            <div className="system-trend-chart-shell">
              <div className="system-trend-chart">
                <svg
                  viewBox={`0 0 ${TREND_CHART_WIDTH} ${TREND_CHART_HEIGHT}`}
                  role="img"
                  aria-label="平台区间趋势折线图"
                >
                  {GRID_RATES.map((rate) => {
                    const y = TREND_PADDING.top + plotHeight - plotHeight * rate;
                    const label = Math.round(trendMaxValue * rate);

                    return (
                      <g key={rate}>
                        <line
                          x1={TREND_PADDING.left}
                          y1={y}
                          x2={TREND_CHART_WIDTH - TREND_PADDING.right}
                          y2={y}
                          stroke="rgba(52, 35, 20, 0.12)"
                          strokeDasharray="5 7"
                        />
                        <text
                          x={TREND_PADDING.left - 10}
                          y={y + 4}
                          fill="rgba(109, 91, 77, 0.9)"
                          fontSize="12"
                          textAnchor="end"
                        >
                          {formatNumber(label)}
                        </text>
                      </g>
                    );
                  })}

                  <line
                    x1={TREND_PADDING.left}
                    y1={TREND_PADDING.top + plotHeight}
                    x2={TREND_CHART_WIDTH - TREND_PADDING.right}
                    y2={TREND_PADDING.top + plotHeight}
                    stroke="rgba(52, 35, 20, 0.24)"
                  />

                  {tickIndexes.map((index) => {
                    const point = trendSeries[0]?.points[index];

                    if (!point) return null;

                    return (
                      <g key={trend[index].businessDate}>
                        <line
                          x1={point.x}
                          y1={TREND_PADDING.top + plotHeight}
                          x2={point.x}
                          y2={TREND_PADDING.top + plotHeight + 6}
                          stroke="rgba(52, 35, 20, 0.24)"
                        />
                        <text
                          x={point.x}
                          y={TREND_CHART_HEIGHT - 14}
                          fill="rgba(109, 91, 77, 0.92)"
                          fontSize="12"
                          textAnchor="middle"
                        >
                          {formatShortDate(trend[index].businessDate)}
                        </text>
                      </g>
                    );
                  })}

                  {trendSeries.map((series) => (
                    <g key={series.key}>
                      <path
                        d={series.path}
                        fill="none"
                        stroke={series.stroke}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {showTrendPoints
                        ? series.points.map((point) => (
                          <circle
                            key={`${series.key}-${point.businessDate}`}
                            cx={point.x}
                            cy={point.y}
                            r="4"
                            fill={series.stroke}
                            stroke="rgba(255, 250, 244, 0.96)"
                            strokeWidth="2"
                          >
                            <title>{`${series.label} ${point.businessDate}: ${formatNumber(point.value)}`}</title>
                          </circle>
                        ))
                        : null}
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          ) : (
            <p className="muted">当前区间没有趋势数据。</p>
          )}
        </article>

        <article className="section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Signals</p>
              <h3>经营信号</h3>
            </div>
          </div>
          <div className="system-signal-grid">
            <article className="portfolio-list-card">
              <strong>意向分布</strong>
              <p>A/B {formatNumber(range?.highIntentCount)}，C/D {formatNumber((range?.cIntentCount ?? 0) + (range?.dIntentCount ?? 0))}，待补 {formatNumber(range?.missingIntentCount)}</p>
              <p className="muted">区间意向按日事实累加，适合观察经营热度，不作为客户唯一状态快照。</p>
            </article>
            <article className="portfolio-list-card">
              <strong>任务健康</strong>
              <p>日报失败 {formatNumber(range?.dailyReportFailedJobCount)}，盘点失败 {formatNumber(range?.customerAnalysisFailedJobCount)}</p>
              <p className="muted">失败数按任务创建或业务日期落在当前区间统计。</p>
            </article>
            <article className="portfolio-list-card">
              <strong>客户回访</strong>
              <p>复访 {formatNumber(range?.revisitCount)}，首访 {formatNumber(range?.firstVisitCount)}，来访按日合计 {formatNumber(range?.visitCustomerDayCount)}</p>
              <p className="muted">去重来访用于区间规模，按日合计用于工作量。</p>
            </article>
          </div>
        </article>

        {metrics?.projects.length ? (
          <div className="table-wrap">
            <table className="member-table portfolio-table system-metrics-table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>成员</th>
                  <th>托管</th>
                  <th>新增对话</th>
                  <th>活跃对话</th>
                  <th>来访</th>
                  <th>首访</th>
                  <th>复访</th>
                  <th>消息</th>
                  <th>日报</th>
                  <th>自由盘点</th>
                  <th>任务</th>
                </tr>
              </thead>
              <tbody>
                {metrics.projects.map((row) => (
                  <tr key={row.projectId}>
                    <td className="portfolio-project-cell">
                      <button className="table-link-button portfolio-open-button" type="button" onClick={() => onOpenProject(row.projectId)}>
                        {row.projectName}
                      </button>
                      <span className="member-subtext">{row.description || '暂无项目描述'}</span>
                      <span className="member-subtext">创建 {formatTime(row.createdAt)}</span>
                    </td>
                    <td>
                      <strong>{formatNumber(row.adminCount + row.memberCount)}</strong>
                      <span className="member-subtext">管理员 {formatNumber(row.adminCount)}</span>
                      <span className="member-subtext">成员 {formatNumber(row.memberCount)}</span>
                    </td>
                    <td>{formatNumber(row.managedMemberCount)}</td>
                    <td>{formatNumber(row.newTopicCount)}</td>
                    <td>
                      <strong>{formatNumber(row.activeTopicCount)}</strong>
                      <span className="member-subtext">成员 {formatNumber(row.activeMemberCount)}</span>
                    </td>
                    <td>{formatNumber(row.visitCustomerCount)}</td>
                    <td>{formatNumber(row.firstVisitCount)}</td>
                    <td>{formatNumber(row.revisitCount)}</td>
                    <td>
                      <strong>{formatNumber(row.visibleMessageCount)}</strong>
                      <span className="member-subtext">用户 {formatNumber(row.userMessageCount)}</span>
                      <span className="member-subtext">助手 {formatNumber(row.assistantMessageCount)}</span>
                    </td>
                    <td>
                      <strong>{formatNumber(row.dailyReportCount)}</strong>
                      <span className="member-subtext">失败 {formatNumber(row.dailyReportFailedJobCount)}</span>
                    </td>
                    <td>
                      <strong>{formatNumber(row.customerAnalysisJobCount)}</strong>
                      <span className="member-subtext">会话 {formatNumber(row.customerAnalysisSessionCount)}</span>
                      <span className="member-subtext">失败 {formatNumber(row.customerAnalysisFailedJobCount)}</span>
                    </td>
                    <td>
                      <strong>{formatNumber(row.runningTaskCount)}</strong>
                      <span className="member-subtext">失败 {formatNumber(row.failedTaskCount)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-card">
            <p>{loading ? '正在加载项目明细...' : '当前没有可展示的项目统计。'}</p>
          </div>
        )}
      </section>
    </div>
  );
}
