# LobeHub Admin Module

`lobehub-admin-module` 是一个面向 `LobeHub` 的独立外挂管理后台与项目运营模块。它尽量复用现有 PostgreSQL / Neon 数据、账号体系与消息链路，通过独立的 `service`、`web`、`sql` 和 `scripts` 落地能力，降低对主站源码的侵入。

当前仓库已经覆盖项目管理、项目文档与知识插件、经营日报、自由盘点、CRM 客户小结同步、移动端工作台等能力，适合继续沿着“外挂增强”模式扩展业务功能。

## 项目定位

- 不直接侵入主站核心源码，优先通过外挂服务、数据库扩展和独立前端实现。
- 复用主站现有数据表与账号体系，例如 `public.users`、`public.agents`、`public.sessions`、`public.topics`、`public.messages`。
- 管理端通常部署在 `/admin/`，管理 API 通常部署在 `/admin-api/`。
- 项目级数据统一沉淀到 `lobehub_admin` 与 `crm` 相关表结构中。

## 核心能力

- 项目、成员、模板助手的创建、绑定与批量配置
- 项目经营日报、经营事实层、项目概览与组合看板
- 自由盘点 / 客户分析会话与后台任务执行
- 项目文档、全局知识文档与统一知识插件路由
- CRM 客户阶段性小结结构化落库与消息状态回写
- 移动端管理工作台与日报 / 盘点轻量入口

## 架构与目录

```text
.
├─ service/   Fastify + TypeScript 后端
├─ web/       React + Vite 前端
├─ sql/       初始化与增量升级 SQL
├─ scripts/   PowerShell 安装、升级、开发辅助脚本
├─ docs/      架构、部署、专题方案与发布说明
└─ deploy/    线上部署相关示例文件
```

## 环境要求

- Node.js 20+
- npm 10+
- PostgreSQL 14+ 或 Neon
- Windows PowerShell 5+（如需直接使用仓库内脚本）

## 快速开始

### 1. 初始化数据库

新环境优先执行完整初始化：

```powershell
.\scripts\apply-project-admin-core.ps1
```

如果不是本地 Docker `postgres`，也可以直接执行 [`sql/001_project_admin_core.sql`](sql/001_project_admin_core.sql)。

已部署旧环境建议按下面顺序升级：

```powershell
.\scripts\check-project-admin-mappings.ps1
.\scripts\upgrade-existing-project-admin.ps1
.\scripts\apply-project-admin-core.ps1 -SqlFile "sql/013_single_project_binding.sql"
.\scripts\apply-project-admin-core.ps1 -SqlFile "sql/014_crm_customer_summary_sync.sql"
```

说明：

- `upgrade-existing-project-admin.ps1` 当前会串行执行 `003 / 004 / 006 / 007 / 008 / 009 / 010 / 011 / 012`
- `013_single_project_binding.sql` 用于“单账号单项目绑定”约束
- `014_crm_customer_summary_sync.sql` 用于 CRM 客户小结同步能力
- 如果旧环境安装过全局自动下发逻辑，再按需执行 [`sql/002_disable_global_auto_provision.sql`](sql/002_disable_global_auto_provision.sql)

### 2. 启动后端

先参考 [`service/.env.example`](service/.env.example) 或 [`service/.env.production.example`](service/.env.production.example) 准备 `service/.env`，然后执行：

```powershell
cd service
npm install
npm run dev
```

本地默认地址：

- API: `http://127.0.0.1:3321`
- 健康检查: `http://127.0.0.1:3321/health`

后端启动后会自动恢复或开启以下后台流程：

- 批量配置任务恢复
- 日报任务恢复与定时调度
- 自由盘点任务恢复
- CRM 客户小结同步调度

### 3. 启动前端

本地开发默认会直接请求 `http://127.0.0.1:3321`，无需额外配置 API 地址：

```powershell
cd web
npm install
npm run dev
```

本地默认地址：

- 管理端：`http://127.0.0.1:4173/`
- 移动端：`http://127.0.0.1:4173/mobile/`

生产构建默认读取 [`web/.env.production`](web/.env.production)：

```env
VITE_PUBLIC_BASE=/admin/
VITE_API_BASE_URL=/admin-api
```

构建命令：

```powershell
cd web
npm run build
```

## 关键环境变量

- `DATABASE_URL`
  管理模块复用主站 PostgreSQL / Neon 数据库的连接串。
- `CORS_ORIGIN`
  管理端可访问来源列表。
- `ADMIN_SESSION_COOKIE_NAME`
  管理后台独立会话 cookie 名称。
- `ADMIN_SESSION_TTL_HOURS`
  管理后台会话有效时长。
- `ADMIN_SESSION_SECURE_COOKIE`
  如仍保留 HTTP IP 兜底访问，通常需要保持 `false`。
- `TRUST_PROXY`
  生产环境经由 Nginx / 反向代理时通常设为 `true`。
- `PROJECT_DOCS_INTERNAL_TOKEN`
  项目文档相关内部接口鉴权。
- `PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL`
  统一知识插件回调或公开访问基地址。
- `PROJECT_DOCS_PLUGIN_SECRET`
  统一知识插件签名密钥。
- `CRM_SUMMARY_SYNC_ENABLED`
  是否启用 CRM 客户小结同步。
- `CRM_SUMMARY_SYNC_INTERVAL_MS`
  同步扫描间隔。
- `CRM_SUMMARY_SYNC_BATCH_SIZE`
  单批处理消息数。
- `CRM_SUMMARY_SYNC_QUIET_PERIOD_MS`
  消息静默等待时长，避免流式输出未完成就入库。
- `CRM_SUMMARY_SYNC_INITIAL_LOOKBACK_MINUTES`
  初次启动回看时间窗口。
- `DAILY_REPORT_DEFAULT_MODEL_PROVIDER`
  日报与相关分析任务默认模型提供商。
- `DAILY_REPORT_DEFAULT_MODEL_NAME`
  日报与相关分析任务默认模型名。
- `VOLCENGINE_API_KEY`
  火山引擎模型密钥。
- `VOLCENGINE_BASE_URL`
  火山引擎响应式接口基地址。

## 常用脚本

- `service`
  - `npm run dev`
  - `npm run build`
  - `npm run start`
  - `npm run backfill:facts`
- `web`
  - `npm run dev`
  - `npm run build`
  - `npm run preview`
- `scripts/start-admin-dev.ps1`
  同时拉起后端和前端开发环境。
- `scripts/upgrade-existing-project-admin.ps1`
  对旧环境执行常用增量升级。

## 生产部署说明

当前生产部署建议继续采用“独立后端 + 静态前端 + Nginx 网关”的方式：

- 管理后端目录通常为 `/home/admin/lobehub-admin/service/`
- 前端构建产物通常部署到 `/home/admin/lobehub-admin/web/`
- 外部网关负责把 `/admin/` 指向静态前端，把 `/admin-api/` 反代到后端服务

详细步骤请看：

- [部署说明](docs/deployment.md)
- [线上部署步骤](docs/online-deployment-steps.md)
- [现网升级说明](docs/upgrade-existing-deployment.md)

## 文档索引

- [架构说明](docs/architecture.md)
- [项目状态总览](docs/project-status.md)
- [CRM 小结同步方案](docs/crm-summary-sync-rollout.md)
- [客户盘点统一规则](docs/customer-discuss-rules-unified.md)
- [2026-04-03 CRM 字段扩展发布说明](docs/release-2026-04-03-crm-summary-sync-field-expansion.md)
- [2026-04-03 管理端顶部与生产同步说明](docs/release-2026-04-03-admin-topbar-and-production-sync.md)

## 更新日志

历史更新已从 README 拆出，见 [CHANGELOG.md](CHANGELOG.md)。

## Current Infra

- 正式域名仅保留 `https://daiworld.top`
- 管理端入口：`https://daiworld.top/admin/`
- 管理端健康检查：`https://daiworld.top/admin-api/health`
- 当前主部署主机：`ali-2c2g -> root@112.74.94.150`
- 当前补充服务器：`hk-16 -> root@154.94.233.60`
- 仓库内旧域名、废弃 IP 与旧主机别名示例均已移除

## SSH Aliases

当前本地 `~/.ssh/config` 推荐保留：

```sshconfig
Host ali-2c2g
  HostName 112.74.94.150
  User root
  Port 22
  IdentityFile C:/Users/mydfy/.ssh/id_ed25519
  IdentitiesOnly yes

Host hk-16
  HostName 154.94.233.60
  User root
  Port 22
  IdentityFile C:/Users/mydfy/.ssh/id_ed25519
  IdentitiesOnly yes
```
