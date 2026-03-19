# LobeHub Admin Module

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
- 项目对话统计与下钻查看
- 数据查看页面

目录说明：
- `docs/architecture.md`：管理模块总体设计
- `docs/project-status.md`：当前实现状态、关键事项与后续计划
- `docs/deployment.md`：独立部署与联调方式
- `docs/roadmap.md`：阶段拆解与开发顺序
- `sql/001_project_admin_core.sql`：核心表与函数
- `sql/002_disable_global_auto_provision.sql`：可选关闭全局自动下发
- `scripts/apply-project-admin-core.ps1`：安装核心 schema
- `scripts/disable-global-auto-provision.ps1`：关闭旧的全局自动下发
- `scripts/start-admin-api.ps1`：启动独立后端
- `scripts/start-admin-web.ps1`：启动独立前端
- `scripts/start-admin-dev.ps1`：同时启动前后端
- `service/`：独立后端服务
- `web/`：独立前端管理端
- `../deploy/lobehub-gateway/`：当前线上实际使用的 Docker Nginx 网关方案

建议实施顺序：
1. 如环境中存在旧的全局自动下发对象，再执行 `002_disable_global_auto_provision.sql`
2. 执行 `001_project_admin_core.sql`
3. 启动独立管理端 API
4. 启动独立管理端 UI

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
