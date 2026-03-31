# 多项目经营看板与复访口径升级说明

更新时间：2026-03-30

状态：待实施

适用范围：`lobehub-admin-module` 本轮多项目运营能力升级

相关文档：
- `docs/architecture.md`
- `docs/project-status.md`
- `docs/daily-report-intent-upgrade-plan.md`
- `docs/metrics-v1.md`
- `docs/multi-project-execution-checklist.md`

## 1. 背景

当前管理模块已经具备以下能力：

- 项目与成员管理
- 项目模板助手配置与批量刷新
- 项目成员运营报表
- 项目对话统计与下钻查看
- 项目经营日报
- 自由盘点

这套架构支撑 1 到 2 个项目没有明显问题，但当项目数量提升到 5 个左右时，当前方案的主要短板不再是“项目能不能建”，而是“管理口径是否统一、项目是否能放在一起看、客户复访是否能被正确体现”。

当前最核心的现实问题有三类：

1. 缺少项目组合层。
   - 目前更多是单项目工作台。
   - 系统管理员可以看项目列表，但项目管理员仍以单项目为主。
   - 当项目数上升后，缺少“所有项目汇总看板”和“异常项目优先识别”能力。

2. 统计口径不统一。
   - 现有 topic 统计更偏“按 `topic.created_at` 统计新增对话”。
   - 现有日报更偏“按 `message.created_at` 统计当天有消息的对话”。
   - 同一个老 `topic` 今天新增消息时，会进入日报，但未必体现在今日 topic 统计里。

3. 客户语义尚未固化。
   - 当前运营规则已经明确：`一个 topic 只服务一个客户`。
   - 但系统内部仍没有正式的“客户事实层”，更多是把 `topic` 当成客户组来使用。
   - 这会直接影响“首访/复访/补录更新”的经营管理表达。

因此，本次升级的核心目标不是做一套完整 CRM，而是在不推翻现有架构的前提下，补齐：

- 多项目组合管理
- 统一的经营指标口径
- 首访/复访表达
- 日报、项目总览、移动端总览之间的一致性

## 2. 本次升级目标

本次升级的目标如下：

- 支持同时管理约 5 个项目，而不是只能逐个切换查看。
- 新增“所有项目汇总看板”，实现组合层总览。
- 固化“新增对话 / 活跃对话 / 来访客户 / 首访 / 复访 / 活跃成员”口径。
- 让日报、项目总览、移动端总览使用同一套事实来源。
- 在日报中体现首访客户与复访客户，并能解释“本次新增了什么信息”。
- 保留当前 topic 下钻与消息详情查看能力，不破坏已有使用方式。

## 3. 本次升级不覆盖的内容

本次升级明确不做以下事项：

- 不引入完整的正式 CRM 客户实体模型。
- 不将 `public` 主站表做大规模改造。
- 不扩展多模板体系。
- 不扩展更多成员角色，仍保持 `admin / member`。
- 不优先拆独立 worker 进程。
- 不改 topic 明细页“查看全量消息”的现有行为。

## 4. V1 固定决策

本轮升级采用以下固定决策，后续实现、验收、灰度均以此为准。

### 4.1 客户识别口径

- V1 正式采用 `topic = customer`。
- 只要运营规则继续成立，即“一个 `topic` 只服务一个客户”，则首访/复访均按 `topic` 推导。
- 如果后续发现同一个客户会拆成多个 `topic`，再进入下一阶段 CRM 实体化升级。

### 4.2 营业日口径

- 所有经营指标统一按“项目时区 + 营业日截点”切分。
- 不再混用服务器自然日、东八区自然日和项目日报窗口。
- 同一个项目内，项目总览、日报、移动端总览必须使用同一营业日窗口。

### 4.3 来访与复访口径

- 只有消息流中出现新的有效 `user` 消息，才算来访。
- 只有消息流中出现新的有效 `user` 消息，且该 `topic` 首次来访业务日早于今天，才算复访。
- 纯 CRM 表字段变更、人工补录但未进入消息流，V1 不计入来访或复访。

### 4.4 指标层、分析层、明细层分离

- 指标统计层：只读取结构化派生事实。
- 日报分析层：只读取营业日窗口内的有效消息增量。
- 明细查看层：继续查看该 `topic` 的全量可见消息。

### 4.5 消息有效性口径

- 有效消息定义为：非 `tool` 且存在可见内容。
- 来访判断只看有效 `user` 消息。
- 日报正文分析默认读取当天窗口内的有效 `user + assistant` 消息。

### 4.6 组织与权限口径

- 仍保留 `admin / member` 两类项目角色。
- 项目管理员也应看到项目列表与组合看板，而不应只能停留在单项目工作台。
- 系统管理员仍具备全局项目查看能力。
- 项目成员仍只看自己可访问项目，不开放组合层。

## 5. 核心指标定义

本次升级使用以下统一指标定义。

| 指标 | 定义 | 说明 |
| --- | --- | --- |
| `newTopicCount` | 当天新建的 `topic` 数 | 偏“新增对话” |
| `activeTopicCount` | 当天有有效消息的 `topic` 数 | 老 `topic` 今天更新也算 |
| `visitCustomerCount` | 当天有有效 `user` 消息的 `topic` 数 | 经营口径中的“来访客户” |
| `firstVisitCount` | 当天有有效 `user` 消息，且该 `topic` 第一条有效 `user` 消息业务日就是今天 | 首访 |
| `revisitCount` | 当天有有效 `user` 消息，且该 `topic` 第一条有效 `user` 消息业务日早于今天 | 复访 |
| `activeMemberCount` | 当天至少拥有 1 个活跃 `topic` 的成员数 | 成员活跃度 |
| `visibleMessageCount` | 当天所有有效消息数 | 非 `tool`、有可见内容 |
| `userMessageCount` | 当天所有有效 `user` 消息数 | 来访判断基础 |
| `assistantMessageCount` | 当天所有有效 `assistant` 消息数 | 辅助分析 |
| `aIntentCount` | 当天最新有效等级为 `A` 的 `topic` 数 | 高意向 |
| `bIntentCount` | 当天最新有效等级为 `B` 的 `topic` 数 | 高意向 |
| `cIntentCount` | 当天最新有效等级为 `C` 的 `topic` 数 | 中意向 |
| `dIntentCount` | 当天最新有效等级为 `D` 的 `topic` 数 | 低意向 |
| `missingIntentCount` | 当天没有有效意向等级的 `topic` 数 | 待补信息 |

## 6. 关键业务样例

为避免后续实施过程中口径漂移，先固化四类典型样例。

### 6.1 新 topic，今天第一次有客户消息

应当体现为：

- `newTopicCount = 1`
- `activeTopicCount = 1`
- `visitCustomerCount = 1`
- `firstVisitCount = 1`
- `revisitCount = 0`

### 6.2 老 topic，今天新增客户消息

应当体现为：

- `newTopicCount = 0`
- `activeTopicCount = 1`
- `visitCustomerCount = 1`
- `firstVisitCount = 0`
- `revisitCount = 1`

### 6.3 老 topic，今天只有 assistant 总结，没有客户消息

应当体现为：

- `newTopicCount = 0`
- `activeTopicCount = 1`
- `visitCustomerCount = 0`
- `firstVisitCount = 0`
- `revisitCount = 0`

### 6.4 只有 CRM 字段补录，没有进入消息流

V1 应当体现为：

- 不计入来访
- 不计入复访
- 不影响新增对话
- 不影响活跃对话

如业务方坚持此类补录也要算复访，则必须在下一版增加正式“客户互动事件表”，而不能继续只靠 topic/message 推导。

## 7. 架构升级方案

### 7.1 新增事实层

新增一层专门的经营事实层，不再让日报、移动端、项目总览分别扫描原始表并各自定义口径。

V1 建议新增表：

`lobehub_admin.project_topic_daily_facts`

该表按“项目 + 业务日期 + topic”固化每天的经营事实。

建议字段如下：

- `project_id`
- `business_date`
- `topic_id`
- `owner_user_id`
- `managed_session_id`
- `topic_created_at`
- `topic_updated_at`
- `first_user_message_at`
- `last_user_message_at`
- `last_visible_message_at`
- `is_new_topic`
- `is_active_topic`
- `has_visit`
- `is_first_visit`
- `is_revisit`
- `visible_message_count`
- `user_message_count`
- `assistant_message_count`
- `latest_intent_band`
- `latest_intent_grade`
- `latest_intent_at`
- `created_at`
- `updated_at`

主键建议：

- `(project_id, business_date, topic_id)`

建议索引：

- `(project_id, business_date)`
- `(business_date)`
- `(project_id, owner_user_id, business_date)`
- `(project_id, business_date, is_revisit)`

### 7.2 事实层刷新策略

在当前尚未引入独立 worker 的前提下，采用增量型刷新策略：

- 已闭合营业日：
  - 在日报生成时顺带固化当日事实。
  - 一旦日报生成完成，原则上该营业日事实冻结。
- 当前营业日：
  - 读取接口时如发现事实缺失或已过期，则按项目在线重算。
  - 过期阈值建议为 2 分钟。

这样可以避免在 5 个项目规模下立刻引入更重的任务架构，同时保证口径逐步统一。

### 7.3 组合层

新增项目组合层，用于聚合所有项目的经营状态。

该层解决的问题：

- 项目管理员也能在一个页面里看多个项目。
- 能快速识别哪个项目今天来访多、复访多、A/B 多、异常任务多。
- 不需要逐个进入项目详情页才知道优先级。

组合层不负责展示原始消息明细，只负责汇总和跳转。

### 7.4 日报 V2

日报升级目标不是“换一种排版”，而是改成真正服务项目经营管理的结构化日报。

日报 V2 建议做到：

- 指标统一读事实层。
- 正文仍分析营业日窗口内真实消息。
- 客户条目增加 `首访 / 复访` 标签。
- 对复访客户增加“本次新增信息摘要”。
- 顶部数字卡增加：
  - `来访`
  - `首访`
  - `复访`
  - `A/B 高意向`
  - `C/D 中低意向`
  - `待补信息`

### 7.5 单项目概览

在当前成员、模板、日报等 tab 之外，新增“概览”tab，作为项目详情的首屏入口。

该页面主要回答：

- 今天来了多少客户
- 其中多少首访，多少复访
- 新增多少对话，活跃多少对话
- 哪些成员今天有活跃
- 最新日报有没有生成
- 有没有运行中或失败任务

### 7.6 多项目切换体验

当前切换项目更多依赖下拉框，适合项目数少的情况。

升级后建议：

- 项目管理员也拥有项目列表页。
- 记住用户上次打开的项目。
- 项目排序可按“最近访问 / 今日复访 / 异常任务 / A/B 数量”排序。
- 有异常的项目在列表中优先展示。

## 8. 数据库改造任务

本次数据库改造建议拆为单独增量：

### 8.1 新增 SQL

新增：

- `sql/010_project_topic_daily_facts.sql`

该文件负责：

- 建表
- 索引
- 触发器
- 只读视图

### 8.2 新增视图

建议新增只读调试视图：

- `lobehub_admin.project_daily_overview_view`

该视图用于：

- 直接核对项目级每日概览
- 对照日报与项目总览数字
- 灰度时给数据库查看页使用

### 8.3 历史回填

新增回填脚本：

- `scripts/backfill-project-topic-daily-facts.ps1`

V1 回填范围建议：

- 最近 30 天

原因：

- 足够覆盖近 7 日和近 30 日趋势
- 回填成本可控
- 便于灰度验证

## 9. 后端任务拆解

### 9.1 新增事实层服务

新增文件建议：

- `service/src/project-facts.ts`

该模块负责：

- 计算单个项目指定营业日的事实记录
- 刷新单个项目当前营业日事实
- 聚合项目概览
- 聚合组合层总览

### 9.2 日报改造

修改：

- `service/src/daily-reports.ts`
- `service/src/daily-report-model.ts`

改造要求：

- 日报指标不再直接从原始消息现算。
- 日报摘要数字统一读取 `project_topic_daily_facts`。
- 正文分析继续从营业日窗口消息提取。
- `summary_json` 升级为 `schemaVersion = 3`。

新增摘要字段建议：

- `firstVisitGroupCount`
- `revisitGroupCount`
- 客户项 `visitType`
- `previousVisitAt`
- `latestVisitAt`
- `todayUpdateSummary`

### 9.3 新增接口

建议新增以下接口：

- `GET /api/portfolio/summary`
- `GET /api/portfolio/projects`
- `GET /api/projects/:projectId/overview`

可选调试接口：

- `POST /api/projects/:projectId/facts/rebuild?businessDate=YYYY-MM-DD`
- `GET /api/projects/:projectId/facts/check?businessDate=YYYY-MM-DD`

### 9.4 移动端接口收敛

当前移动端 summary 里已经聚合成员、日报、topic 统计。

V1 建议：

- `mobile-summary` 优先复用新的 `project overview` 聚合结果。
- 不再在移动端接口内继续扩展新的独立口径。

### 9.5 保持旧接口稳定

当前已有 topic 统计和 topic 详情接口先不删除。

原则：

- 旧接口尽量保留
- 新能力通过 overview/portfolio 接口增加
- 避免一次性推翻已有页面

## 10. 前端任务拆解

### 10.1 项目组合看板

新增组件建议：

- `web/src/components/ProjectPortfolioPanel.tsx`

该面板负责展示：

- 项目总数
- 今日来访总数
- 今日首访总数
- 今日复访总数
- 今日新增对话总数
- 今日活跃对话总数
- 今日活跃成员总数
- 今日 A/B 总数
- 今日待补信息总数
- 运行中任务数

并提供项目列表或表格视图。

### 10.2 单项目概览

新增组件建议：

- `web/src/components/ProjectOverviewPanel.tsx`

固定卡片建议为：

- 今日来访
- 今日首访
- 今日复访
- 今日新增对话
- 今日活跃对话
- 今日活跃成员
- 今日 A/B
- 今日待补信息

### 10.3 入口流转调整

修改：

- `web/src/App.tsx`

改造方向：

- 项目管理员不再默认只进入单项目工作台。
- 项目管理员与系统管理员都先看到项目列表页。
- 支持从项目列表进入项目详情。
- 本地记住上次打开的项目 ID。

### 10.4 日报面板升级

修改：

- `web/src/components/ProjectDailyReportPanel.tsx`

升级要求：

- 顶部数字卡支持首访/复访
- 客户卡片展示 `首访 / 复访` 标签
- 对复访客户展示“本次新增信息摘要”
- 排序优先级体现经营价值

建议排序：

- A 类复访
- B 类复访
- A 类首访
- B 类首访
- 待补信息复访
- 待补信息首访
- 其余 C/D

### 10.5 成员页增强

在现有成员页基础上增加：

- `lastActiveAt`
- `todayActiveTopicCount`
- `todayVisitCustomerCount`
- `todayRevisitCount`
- `latestIntentBand`

V1 不修改角色体系，只增加运营字段。

### 10.6 移动端同步

修改：

- `web/src/mobile/AppMobile.tsx`

目标：

- 顶部数字口径与 Web 总览一致
- 不单独发明移动端统计规则
- 保持轻量，不做复杂筛选

## 11. 页面结构建议

### 11.1 组合层首页

第一屏：

- 组合汇总卡片

第二屏：

- 项目列表

每个项目展示：

- 项目名
- 角色
- 成员数
- 今日来访
- 今日首访
- 今日复访
- 今日新增对话
- 今日活跃对话
- 今日 A/B
- 最新日报时间
- 运行中任务 / 失败任务

### 11.2 单项目首页

第一屏：

- 项目经营概览卡片

第二屏：

- 今日重点客户 / 待补信息 / 运行中任务 / 最近日报

### 11.3 日报详情页

建议结构：

- 顶部经营数字
- 项目概览摘要
- 今日重点客户
- 今日待补信息客户
- 管理问题与动作
- 对话详情下钻入口

## 12. 实施步骤

建议按以下顺序实施：

### 步骤 1：先确认口径

- 新增并确认 `docs/metrics-v1.md`
- 对 4 个典型样例做口径签字

### 步骤 2：落地事实层 SQL 与回填

- 新增 `010_project_topic_daily_facts.sql`
- 回填近 30 天数据

### 步骤 3：实现事实层服务

- 新增 `project-facts.ts`
- 完成项目日事实计算与聚合逻辑

### 步骤 4：新增组合层与项目概览接口

- 完成 portfolio summary
- 完成 portfolio projects
- 完成 project overview

### 步骤 5：先做 Web 组合看板与单项目概览

- 项目管理员与系统管理员都能先看项目列表
- 项目切换体验完善

### 步骤 6：再做日报 V2

- 首访/复访数字
- 客户条目增强
- 复访摘要

### 步骤 7：同步移动端总览

- 统一数字来源
- 保持轻量表达

### 步骤 8：灰度验证

- 先选 2 个项目
- 验证近 7 天数据
- 人工抽样复核

### 步骤 9：全量放开

- 放开全部约 5 个项目
- 持续观察异常口径

## 13. 建议拆分为 4 个 PR

### PR1：口径与数据库

- `docs/metrics-v1.md`
- `sql/010_project_topic_daily_facts.sql`
- 回填脚本

### PR2：事实层与接口

- `service/src/project-facts.ts`
- 新增 portfolio 与 overview 接口
- 日报数据源切换为事实层

### PR3：Web 组合看板与项目概览

- 项目列表页升级
- 组合层看板
- 单项目概览

### PR4：日报 V2 与移动端同步

- 日报卡片与客户条目升级
- 移动端数字同步

## 14. 验收标准

本次升级完成后，至少满足以下标准：

### 14.1 数字一致性

同一个项目、同一个营业日，以下三处数字必须一致：

- 组合看板里的项目行摘要
- 单项目概览页
- 日报顶部数字

### 14.2 老 topic 今日新增客户消息

必须满足：

- `newTopicCount +0`
- `activeTopicCount +1`
- `visitCustomerCount +1`
- `revisitCount +1`

### 14.3 纯 assistant 活跃不算来访

必须满足：

- 计入活跃对话
- 不计入来访
- 不计入首访或复访

### 14.4 CRM-only 补录不影响经营指标

必须满足：

- 不计入来访
- 不计入复访
- 不计入新增/活跃 topic

### 14.5 日报明细查看不退化

必须满足：

- 仍可从日报进入 topic 明细
- 仍可查看该 topic 全量可见消息

### 14.6 多项目管理效率提升

必须满足：

- 项目管理员可在一个页面内比较多个项目
- 不需要逐个进入项目详情页才知道优先级

## 15. 风险与应对

### 15.1 `topic != customer` 风险

风险：

- 如果实际业务中一个客户被拆成多个 topic，首访/复访就会失真。

应对：

- V1 明确把该问题视为运营使用规范约束。
- 若灰度中发现问题普遍存在，再进入 V2 CRM 客户实体化升级。

### 15.2 CRM 补录不进入消息流

风险：

- 业务上认为“补录更新”也是复访，但系统当前感知不到。

应对：

- V1 先不支持。
- 如成为强需求，后续新增“客户互动事件表”。

### 15.3 日报正文与数字割裂

风险：

- 指标来自事实层，正文来自原始消息，若处理不当会产生“数字对了、摘要偏了”的体验。

应对：

- 指标只读事实层。
- 正文只分析当天窗口消息，不写超出口径的结论。

### 15.4 任务仍在服务进程内

风险：

- 项目数增加后，后台任务稳定性压力上升。

应对：

- V1 先控制项目规模与事实刷新频率。
- 如日事实刷新和日报任务增长明显，再进入独立 worker 化。

## 16. 发布与灰度计划

建议采用以下发布顺序：

### 16.1 开发环境自测

- 验证近 30 天回填结果
- 验证 4 个关键场景

### 16.2 小范围灰度

- 先选 2 个项目
- 验证近 7 天数字
- 对照日报与项目概览

### 16.3 全量发布

- 放开全部项目
- 观察 3 天

### 16.4 持续观察

重点观察：

- 老 topic 今日更新是否稳定计入复访
- A/B/待补信息数量是否与人工判断基本一致
- 是否频繁出现“一个客户多个 topic”导致的统计分裂

## 17. 计划涉及的主要文件

本次升级预计会涉及以下文件或新增以下文件：

### 文档

- `docs/metrics-v1.md`
- `docs/multi-project-upgrade-plan.md`

### SQL 与脚本

- `sql/010_project_topic_daily_facts.sql`
- `scripts/backfill-project-topic-daily-facts.ps1`

### 后端

- `service/src/project-facts.ts`
- `service/src/daily-reports.ts`
- `service/src/daily-report-model.ts`
- `service/src/routes/mobile.ts`
- 新增组合层路由文件

### 前端

- `web/src/App.tsx`
- `web/src/types.ts`
- `web/src/components/ProjectPortfolioPanel.tsx`
- `web/src/components/ProjectOverviewPanel.tsx`
- `web/src/components/ProjectDailyReportPanel.tsx`
- `web/src/mobile/AppMobile.tsx`

## 18. 最终结论

本次升级不应理解为“再加几个图表”，而应理解为：

- 从单项目工作台，升级为多项目经营管理工作台
- 从 topic 查询能力，升级为项目经营事实能力
- 从简单日报，升级为包含首访/复访语义的经营日报

V1 的最佳路径是：

- 先固化口径
- 再补事实层
- 再做组合看板
- 最后升级日报与移动端

这样可以在不推翻现有架构的前提下，稳定支持约 5 个项目的管理与经营分析。
