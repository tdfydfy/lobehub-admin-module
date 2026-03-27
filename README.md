# LobeHub Admin Module

## Update 2026-03-27

- 新增“自由盘点”能力：
  - 管理端项目详情页新增“自由盘点”标签，移动端在“总览 / 更多”里提供轻量入口
  - 支持项目管理员新建自由盘点会话、输入自由提示词、按时间窗口读取托管会话对话并生成分析结论
  - 提交后改为后台任务执行，前端轮询任务状态并在会话中回写结果，不再依赖长时间同步请求
  - 后端新增 `/api/projects/:projectId/customer-analysis/...` 路由，并在服务启动时自动恢复未完成任务
- 数据库与升级脚本已补齐自由盘点结构：
  - 新增 `sql/008_customer_analysis_chat.sql`
  - 新增 `sql/009_customer_analysis_jobs.sql`
  - `scripts/upgrade-existing-project-admin.ps1` 当前会顺带执行 `003 / 004 / 006 / 007 / 008 / 009`
- 前端生产构建兜底策略已补齐：
  - 默认生产 `base` 回退为 `/admin/`
  - 默认生产 API 地址回退为 `/admin-api`
  - `web/.env.production` 已纳入仓库，避免漏配后生成错误的 `/assets/...` 路径

## Update 2026-03-24

- 日报意向与重点客户口径补齐：
  - 日报侧不再重复发明高意向标准，优先复用 `lobehub` 对话里已有的客户判断结果
  - 重点客户列表保持“重点客户”定位，不再机械拆成单独的“待补信息客户列表”
  - 统计口径收敛为：
    - 中高意向 = `A + B`
    - 中低意向 = `C + D`
    - 总来访 = `A + B + C + D + 待补信息`
- 移动端日报详情页已重排：
  - `Overview` 区改为摘要 + 分行列举“最值得关注的客户 / 管理动作”
  - 数字卡片固定为四块：`今日来访 / 中高意向 / 中低意向 / 待补信息`
  - 重点客户卡片改为右上角意向标签、标题下销售员，并对标题和正文都增加截断保护，避免撑破布局
  - “管理关注点 / 建议动作”已合并为“管理问题与动作”
- 移动端入口行为调整：
  - 总览页里的“最新日报”卡片可直接进入日报详情
  - 从日报里的客户详情返回时，会回到“日报详情”而不是“对话页”
- 日报明细查看约束明确：
  - 运营口径按“一个 `topic` 只服务一个客户”
  - 日报点进客户明细时，默认展示该 `topic` 的全量消息；如果一个 `topic` 混入多个客户，视为上游使用规范问题
- 线上状态：
  - `ali-temp` 已更新并验证日报移动端改动
  - `ali-2c2g` 待同步本次版本

## Update 2026-03-21

- 新增“项目经营日报”能力：
  - 统计口径按营业日窗口内的真实消息时间
  - 主视角改为“客户来访组 / 项目经营管理”，不再按销售个人表现输出
  - 支持日报列表、日报详情、手动生成、自动调度
- 数据库与升级脚本已补齐日报相关增量：
  - 新环境的 `sql/001_project_admin_core.sql` 已包含日报表、索引与触发器
  - 已部署旧环境新增 `sql/006_daily_reports.sql` 与 `sql/007_daily_report_volcengine_provider.sql`
  - `scripts/upgrade-existing-project-admin.ps1` 当前会顺带执行 `003 / 004 / 006 / 007 / 008 / 009`
- 日报正文已切到火山 `volcengine` 模型：
  - 使用 `https://ark.cn-beijing.volces.com/api/v3/responses`
  - 当前默认模型为 `doubao-seed-2-0-lite-260215`
  - 如模型调用失败，仍会回退到内建规则摘要
- 服务端已新增日报模型环境变量：
  - `DAILY_REPORT_DEFAULT_MODEL_PROVIDER`
  - `DAILY_REPORT_DEFAULT_MODEL_NAME`
  - `VOLCENGINE_API_KEY`
  - `VOLCENGINE_BASE_URL`
- 日报提示词结构已收敛为两层：
  - 系统提示词：固定、只读、前端展示但不可编辑
  - 项目补充要求：项目级可编辑
  - 已移除额外第三层“正文生成任务提示”
- 部署口径已统一：
  - `ali-temp`
  - `ali-2c2g`
  - 两台服务器主站 `lobehub` 当前都应以修正后的 `/home/admin/lobehub/docker-compose.yml` 运行
  - 当前口径为 `VOLCENGINE_*` 生效，`NEWAPI_*` 不再作为主站运行配置

## Update 2026-03-20

- 修复“对话统计 -> Topic 详情”消息展示口径：
  - 不再展示大量空的中间 assistant/system 占位消息
  - 仍然排除 `tool`
  - Topic 详情按 `topic_id` 聚合可见消息，兼容 assistant 最终结论消息 `session_id = null` 的落库情况
  - Topic 列表里的 `messageCount` / `preview` 同步改为只统计和展示可见消息
- 修复成员管理页的项目助手信息展示：
  - 恢复“最近更新”时间字段
  - 清理重复文案，只保留一份助手名称和更新时间
  - 成员表中点击助手名称可展开查看助手详情
- 新增成员助手详情展开能力：
  - 可查看提示词 `system_role`
  - 可查看开场白、开场问题
  - 可查看模型/provider、对话配置、模型参数
  - 可查看当前助手启用的技能清单，以及未匹配到本地 skill 记录的插件标识
- 已完成线上验证：
  - `ali-temp`
  - `ali-2c2g`

## Update 2026-03-19

- 已移除旧的“注册后自动赋予助手”状态查询与页面提示。
- 批量配置/刷新已改为“API 快速返回 + 服务进程后台执行”。
- 批量配置/刷新已增加项目级并发保护：
  - 同一项目已有 `pending/running` 任务时，后端拒绝再次创建
  - 前端在任务运行中会禁用批量操作按钮
- 批量任务现在会在创建时固化成员快照，不再执行时重新扫描当前成员列表。
- 已明确“官方助手”唯一规则：
  - 每个 `(project_id, user_id)` 只维护 1 个官方助手和 1 个官方会话
  - 官方身份只看 `project_managed_agents` 映射，不看助手标题
- Topic 统计页已收敛为用户视角：
  - Topic 列表“消息数”只统计可见消息
  - Topic 详情只展示用户真正可见的消息
- 已新增增量 SQL：
  - `sql/003_fix_provision_skip_requires_session.sql`
  - `sql/004_repair_project_managed_mappings.sql`

## Update 2026-03-17

- 成员登录与自有 Topic 查看第一阶段已落地。
- 已补充真实场景的线上部署文档与生产环境示例文件。
- 已补充 `daiworld.com` / `www.daiworld.com` HTTPS 支持与旧 IP 兜底升级指引。
- 新增文档：
  - `docs/member-topic-phase1.md`
  - `docs/online-deployment-steps.md`
  - `docs/template-agent-ownership-fix.md`
  - `docs/upgrade-existing-deployment.md`
- 新增环境文件：
  - `service/.env.production.example`
- 推荐阅读顺序：
  1. `docs/member-topic-phase1.md`
  2. `docs/online-deployment-steps.md`
  3. `docs/upgrade-existing-deployment.md`
  4. `service/.env.production.example`
  5. `docs/deployment.md`

独立于 `lobehub` 主应用部署的管理模块。

目标：
- 不修改主应用源码
- 直接复用现有 PostgreSQL 数据
- 提供项目、成员、模板、批量助手配置的管理能力
- 后续再接独立管理端 API 与页面

当前阶段已落地内容：
- 架构说明
- 状态总览文档
- 开发拆解
- 数据库核心 schema
- 项目级助手配置 SQL
- 关闭全局自动下发脚本
- PowerShell 安装脚本
- 独立后端服务
- 独立前端管理端
- 基于现有账号体系的后台登录
- 项目成员运营报表
- 项目经营日报
- 项目对话统计与下钻查看
- 数据查看页面

目录说明：
- `docs/architecture.md`：管理模块总体设计
- `docs/project-status.md`：当前实现状态、关键事项与后续计划
- `docs/deployment.md`：独立部署与联调方式
- `docs/roadmap.md`：阶段拆解与开发顺序
- `sql/001_project_admin_core.sql`：核心表与函数
- `sql/002_disable_global_auto_provision.sql`：可选关闭全局自动下发
- `sql/003_fix_provision_skip_requires_session.sql`：已部署环境的函数增量升级
- `sql/004_repair_project_managed_mappings.sql`：一次性修复已有官方助手映射
- `sql/005_check_project_managed_mapping_health.sql`：升级前只读自检
- `sql/006_daily_reports.sql`：已部署环境补齐日报设置、任务、结果表
- `sql/007_daily_report_volcengine_provider.sql`：将日报模型 provider 覆盖口径扩展为 `volcengine / fallback`
- `sql/008_customer_analysis_chat.sql`：已部署环境补齐自由盘点会话与消息表
- `sql/009_customer_analysis_jobs.sql`：已部署环境补齐自由盘点任务表，支持后台执行与轮询状态
- `scripts/apply-project-admin-core.ps1`：安装核心 schema
- `scripts/check-project-admin-mappings.ps1`：执行升级前映射健康检查
- `scripts/upgrade-existing-project-admin.ps1`：执行已部署环境的增量升级
- `scripts/disable-global-auto-provision.ps1`：关闭旧的全局自动下发
- `scripts/start-admin-api.ps1`：启动独立后端
- `scripts/start-admin-web.ps1`：启动独立前端
- `scripts/start-admin-dev.ps1`：同时启动前后端
- `service/`：独立后端服务
- `web/`：独立前端管理端
- `../deploy/lobehub-gateway/`：当前线上实际使用的 Docker Nginx 网关方案

建议实施顺序：
1. 如环境中存在旧的全局自动下发对象，再执行 `002_disable_global_auto_provision.sql`
2. 新环境执行 `001_project_admin_core.sql`
3. 已部署旧环境按需执行：
   - 先执行 `scripts/check-project-admin-mappings.ps1`
   - 再执行 `scripts/upgrade-existing-project-admin.ps1`
   - 当前升级脚本会自动串行执行 `003 / 004 / 006 / 007 / 008 / 009`
4. 启动独立管理端 API
5. 启动独立管理端 UI

说明：
- `001` 是全量初始化脚本，适合新库。
- `003` 是增量升级脚本，适合已经安装过旧版 `lobehub_admin` schema 的数据库。
- `004` 是一次性修复脚本，只修复 `project_managed_agents` 中已经存在的官方助手/会话映射；如果某个项目成员完全没有映射记录，仍应重新执行一次“赋予助手”或“刷新助手”。
- `006` 是日报能力的结构补齐脚本，适合已经装过旧版 schema、但数据库里尚无日报表结构的环境。
- `007` 是日报 provider 约束修正脚本，用于将日报模型配置明确收敛到 `volcengine / fallback`。

当前实际线上整合方案：

- `lobehub` 主站继续独立部署，保留 topic-title 镜像 patch
- 管理端后端运行在 `node:20` Docker 容器中
- 管理端前端在本地构建为 `web/dist`
- Docker Nginx 网关统一暴露：
  - `/`
  - `/admin/`
  - `/admin-api/`
- 主站与管理端共用同一个 Neon 数据库

当前推荐先阅读：

- [deployment.md](/D:/lobe-hub2/lobehub-admin-module/docs/deployment.md)
- [README.md](/D:/lobe-hub2/deploy/lobehub-gateway/README.md)

当前已经支持：
- 后台登录
  - 复用 `public.users` + `public.accounts`
  - 按现有 `credential` 密码哈希校验
  - 登录成功后写入管理端独立会话 cookie
- 项目创建、删除、成员管理
- 模板助手选择与保存
- 批量配置/刷新任务与任务结果查看
- 项目成员运营报表
- 项目经营日报
  - 支持项目级日报设置、营业日截点、项目补充要求、模型覆盖
  - 支持手动生成、自动调度、任务轮询、列表查询、详情查看
  - 支持查看结构化 JSON 与 Markdown 原文
- 项目自由盘点
  - 支持新建自由盘点会话并保留历史消息
  - 支持按“今日 / 近 7 天 / 近 30 天 / 自定义区间”聚合托管对话
  - 支持管理员输入自由提示词，提交后台任务并将分析结论写回会话
  - Web 端提供完整工作台，移动端提供精简入口与任务查看
- 项目对话统计
  - 统计口径为项目托管会话内创建的 `topic`
  - 支持当日、近三天、近七天、一个月、指定日期范围
  - 支持从成员下钻到对话清单，再下钻到对话详情
- 数据查看
  - 系统管理员可查看 `crm` / `lobehub_admin` / `public`
  - 项目管理员可查看 `crm`
  - 项目管理员仅能看到 `project = 自己所在项目名称` 的数据
- 前端时间默认按东八区显示

当前不包含：
- 独立登录系统
- 面向真实 CRM 业务语义的专用报表
- 后台任务 worker

这些会在下一阶段继续补齐。
