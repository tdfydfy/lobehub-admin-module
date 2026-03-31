# 多项目升级执行清单

更新时间：2026-03-30

状态：待实施

用途：将《多项目经营看板与复访口径升级说明》拆解为可执行任务单

关联文档：
- `docs/multi-project-upgrade-plan.md`
- `docs/metrics-v1.md`

## 1. 使用说明

本清单按实施顺序拆为 4 个 PR。

执行要求：

- 先确认 `docs/metrics-v1.md`
- 再进入 SQL 与事实层实现
- 再做组合看板与项目概览
- 最后升级日报 V2 与移动端同步

不建议跳阶段实施。

## 2. 总体阶段

- PR1：口径文档 + SQL + 回填脚本
- PR2：事实层服务 + 聚合接口
- PR3：Web 组合看板 + 单项目概览
- PR4：日报 V2 + 移动端同步

## 3. PR1：口径、SQL、回填

### 3.1 目标

- 固化 V1 指标口径
- 新增项目 topic 日事实表
- 具备近 30 天历史回填能力

### 3.2 交付物

- `docs/metrics-v1.md`
- `sql/010_project_topic_daily_facts.sql`
- `scripts/backfill-project-topic-daily-facts.ps1`

### 3.3 文件级任务

- [ ] 新增 `docs/metrics-v1.md`
- [ ] 新增 `sql/010_project_topic_daily_facts.sql`
- [ ] 在 SQL 中创建 `lobehub_admin.project_topic_daily_facts`
- [ ] 在 SQL 中增加必要索引
- [ ] 在 SQL 中增加只读调试视图
- [ ] 新增回填脚本 `scripts/backfill-project-topic-daily-facts.ps1`
- [ ] 回填脚本支持：
  - [ ] 指定项目
  - [ ] 指定起止日期
  - [ ] 默认回填近 30 天
- [ ] 补充脚本使用说明

### 3.4 验收

- [ ] 新表可创建
- [ ] 回填脚本可在测试环境执行
- [ ] 任意选 1 个项目、1 个业务日，可查到事实记录
- [ ] 与 4 个典型样例口径不冲突

## 4. PR2：事实层与接口

### 4.1 目标

- 引入统一事实层服务
- 新增组合层接口与项目概览接口
- 让日报、概览可以读同一套结构化数据

### 4.2 交付物

- `service/src/project-facts.ts`
- 组合层接口
- 项目概览接口
- 日报数据源部分收口

### 4.3 文件级任务

- [ ] 新增 `service/src/project-facts.ts`
- [ ] 实现“按项目 + 业务日”计算 topic 日事实
- [ ] 实现“刷新当前营业日事实”
- [ ] 实现“聚合项目概览”
- [ ] 实现“聚合组合层总览”
- [ ] 新增组合层路由文件
- [ ] 新增 `GET /api/portfolio/summary`
- [ ] 新增 `GET /api/portfolio/projects`
- [ ] 新增 `GET /api/projects/:projectId/overview`
- [ ] 可选新增调试接口：
  - [ ] `POST /api/projects/:projectId/facts/rebuild`
  - [ ] `GET /api/projects/:projectId/facts/check`
- [ ] 修改 `service/src/daily-reports.ts`
- [ ] 日报顶部统计优先读取事实层
- [ ] 保持原始 topic 明细下钻逻辑不变
- [ ] 修改 `service/src/routes/mobile.ts`
- [ ] `mobile-summary` 改为复用 overview 聚合结果

### 4.4 返回字段检查

- [ ] `portfolio/summary` 含组合汇总数字
- [ ] `portfolio/projects` 含每项目摘要
- [ ] `project overview` 含：
  - [ ] 今日来访
  - [ ] 今日首访
  - [ ] 今日复访
  - [ ] 今日新增对话
  - [ ] 今日活跃对话
  - [ ] 今日活跃成员
  - [ ] 今日 A/B
  - [ ] 今日待补信息
  - [ ] 最新日报
  - [ ] 运行中任务

### 4.5 验收

- [ ] 同一项目、同一业务日，overview 与 facts 聚合结果一致
- [ ] 组合层项目摘要与单项目 overview 一致
- [ ] 老 topic 今日新增 `user` 消息时，`revisitCount` 正确
- [ ] 老 topic 今日只有 assistant 消息时，不误记为来访

## 5. PR3：Web 组合看板与单项目概览

### 5.1 目标

- 给系统管理员和项目管理员提供项目列表与组合看板
- 给单项目详情页新增概览入口
- 优化项目切换体验

### 5.2 交付物

- `web/src/components/ProjectPortfolioPanel.tsx`
- `web/src/components/ProjectOverviewPanel.tsx`
- `web/src/App.tsx` 入口流转升级

### 5.3 文件级任务

- [ ] 新增 `web/src/components/ProjectPortfolioPanel.tsx`
- [ ] 展示组合层卡片
- [ ] 展示项目列表或项目表格
- [ ] 支持按异常优先级排序
- [ ] 新增 `web/src/components/ProjectOverviewPanel.tsx`
- [ ] 展示单项目经营概览卡片
- [ ] 修改 `web/src/App.tsx`
- [ ] 项目管理员进入后先看项目列表
- [ ] 系统管理员保留全局项目管理能力
- [ ] 增加上次项目 ID 记忆
- [ ] 优化项目切换器显示内容
- [ ] 修改 `web/src/types.ts`
- [ ] 增加组合层和 overview 的类型定义

### 5.4 页面检查

- [ ] 组合层首页展示：
  - [ ] 项目总数
  - [ ] 今日来访
  - [ ] 今日首访
  - [ ] 今日复访
  - [ ] 今日新增对话
  - [ ] 今日活跃对话
  - [ ] 今日活跃成员
  - [ ] 今日 A/B
  - [ ] 今日待补信息
  - [ ] 运行中任务
- [ ] 项目列表行展示：
  - [ ] 项目名
  - [ ] 成员数
  - [ ] 今日来访
  - [ ] 今日首访
  - [ ] 今日复访
  - [ ] 今日新增对话
  - [ ] 今日活跃对话
  - [ ] 今日 A/B
  - [ ] 最新日报时间
  - [ ] 任务状态
- [ ] 单项目概览卡展示：
  - [ ] 今日来访
  - [ ] 今日首访
  - [ ] 今日复访
  - [ ] 今日新增对话
  - [ ] 今日活跃对话
  - [ ] 今日活跃成员
  - [ ] 今日 A/B
  - [ ] 今日待补信息

### 5.5 验收

- [ ] 项目管理员可在一个页面比较多个项目
- [ ] 不必逐个进入项目详情页判断优先级
- [ ] 切换项目后概览数据正常刷新
- [ ] 退出重进后能记住最近项目

## 6. PR4：日报 V2 与移动端同步

### 6.1 目标

- 让日报正式支持首访/复访口径
- 强化客户条目经营表达
- 保证移动端总览数字和 Web 一致

### 6.2 交付物

- 日报 `schemaVersion = 3`
- Web 日报面板升级
- 移动端总览数字同步

### 6.3 文件级任务

- [ ] 修改 `service/src/daily-report-model.ts`
- [ ] `summary_json` 升级到 `schemaVersion = 3`
- [ ] 新增字段：
  - [ ] `firstVisitGroupCount`
  - [ ] `revisitGroupCount`
  - [ ] `visitType`
  - [ ] `previousVisitAt`
  - [ ] `latestVisitAt`
  - [ ] `todayUpdateSummary`
- [ ] 修改 `service/src/daily-reports.ts`
- [ ] 日报持久化写入新增统计字段
- [ ] 修改 `web/src/components/ProjectDailyReportPanel.tsx`
- [ ] 顶部数字卡支持首访/复访
- [ ] 客户卡片增加 `首访 / 复访` 标签
- [ ] 客户卡片增加“本次新增信息摘要”
- [ ] 重点客户排序按经营优先级调整
- [ ] 修改 `web/src/mobile/AppMobile.tsx`
- [ ] 顶部数字与 Web 总览一致
- [ ] 移动端不额外发明新口径

### 6.4 排序规则检查

- [ ] A 类复访优先
- [ ] B 类复访优先
- [ ] A 类首访优先
- [ ] B 类首访优先
- [ ] 待补信息复访优先于待补信息首访
- [ ] C/D 默认后置

### 6.5 验收

- [ ] 日报顶部数字与项目概览一致
- [ ] 复访客户展示正确标签
- [ ] 老 topic 今日新增客户消息时能出现在复访列表
- [ ] 点进客户明细仍能看到 topic 全量可见消息
- [ ] 移动端和 Web 数字一致

## 7. 联调检查清单

- [ ] 选择 2 个项目做灰度
- [ ] 核对最近 7 天项目概览数字
- [ ] 核对日报顶部数字
- [ ] 核对组合看板项目摘要
- [ ] 核对至少 20 个 topic 样本

重点样本：

- [ ] 新 topic 首访
- [ ] 老 topic 今日复访
- [ ] 老 topic 今日仅 assistant 活跃
- [ ] 无等级 topic 进入待补信息
- [ ] 同一营业日多次等级变化取最新有效值

## 8. 发布顺序

- [ ] 先合入 PR1
- [ ] 再合入 PR2
- [ ] 再合入 PR3
- [ ] 最后合入 PR4

灰度顺序：

- [ ] 测试环境
- [ ] 2 个项目灰度
- [ ] 全部项目放开

## 9. 上线后观察项

- [ ] 复访数量是否明显偏高或偏低
- [ ] 老 topic 今日更新是否稳定进入复访
- [ ] 项目概览与日报数字是否出现偏差
- [ ] 是否频繁出现“一个客户多个 topic”导致的分裂
- [ ] 事实层刷新是否带来明显接口耗时上升

## 10. 暂不实施项

- [ ] 多模板体系
- [ ] 新角色体系
- [ ] 完整 CRM 客户实体
- [ ] 独立 worker
- [ ] CRM-only 补录复访统计

## 11. 完成定义

当以下条件全部满足时，可视为本轮升级完成：

- [ ] 组合看板上线
- [ ] 单项目概览上线
- [ ] 日报 V2 上线
- [ ] 移动端数字同步
- [ ] 近 7 天灰度数据人工复核通过
- [ ] 项目管理员可稳定管理约 5 个项目
