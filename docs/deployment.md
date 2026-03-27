# 独立部署说明

## 1. 模块结构

本管理模块分成三部分：

- 数据库层：`sql/`
- 后端服务：`service/`
- 前端页面：`web/`

三者都独立于主 `lobehub` 应用。

## 2. 数据库安装

### 2.1 安装项目管理核心 schema

如果数据库是本地 Docker `postgres`，可以在仓库根目录执行：

```powershell
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1
```

如果数据库是远程 Neon / PostgreSQL，当前更推荐直接执行：

- `lobehub-admin-module/sql/001_project_admin_core.sql`

在 Neon SQL Editor 或远程 `psql` 中执行。

说明：
- `001_project_admin_core.sql` 只用于新环境全量安装。
- 如果数据库已经装过旧版 `lobehub_admin` schema，不建议为了升级而重跑整份 `001`。

### 2.1.1 已部署环境的增量升级

如果数据库已经安装过旧版 `lobehub_admin` schema，后续升级优先执行增量 SQL：

- `lobehub-admin-module/sql/005_check_project_managed_mapping_health.sql`
- `lobehub-admin-module/sql/003_fix_provision_skip_requires_session.sql`
- `lobehub-admin-module/sql/004_repair_project_managed_mappings.sql`
- `lobehub-admin-module/sql/006_daily_reports.sql`
- `lobehub-admin-module/sql/007_daily_report_volcengine_provider.sql`
- `lobehub-admin-module/sql/008_customer_analysis_chat.sql`
- `lobehub-admin-module/sql/009_customer_analysis_jobs.sql`

本地 Docker `postgres` 环境优先使用：

```powershell
.\lobehub-admin-module\scripts\check-project-admin-mappings.ps1
.\lobehub-admin-module\scripts\upgrade-existing-project-admin.ps1
```

其中：
- `005` 用于升级前只读自检，查看映射缺失、悬挂引用、canonical slug 偏差。
- `003` 用于升级 `provision_project_member(...)` 的官方助手判定逻辑。
- `004` 用于一次性修复已有 `project_managed_agents` 映射中的助手/会话指针与 canonical slug。
- `004` 不会凭空推断缺失的项目映射；如果某个成员完全没有 `project_managed_agents` 记录，仍应重新执行一次项目助手配置或刷新。
- `006` 用于补齐日报设置表、日报任务表、日报结果表，以及对应索引与触发器。
- `007` 用于将日报模型 provider 的约束修正为 `volcengine / fallback`。
- `008` 用于补齐自由盘点会话与消息表。
- `009` 用于补齐自由盘点任务表，支持提交任务后后台执行与轮询状态。

如果需要单独执行某一份 SQL，再回退使用：

```powershell
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/003_fix_provision_skip_requires_session.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/004_repair_project_managed_mappings.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/006_daily_reports.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/007_daily_report_volcengine_provider.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/008_customer_analysis_chat.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/009_customer_analysis_jobs.sql"
```

### 2.2 如需关闭旧的全局自动下发

如果环境里原本装过旧的自动下发系统，则需要关闭：

- `public.system_provisioning_config.enabled = false`
- `public.users` 上的 `trg_provision_on_user_insert` 已禁用

如果数据库里根本不存在这些对象：

- `public.system_provisioning_config`
- `trg_provision_on_user_insert`

说明旧系统从未安装，这时应直接跳过 `002_disable_global_auto_provision.sql`。

本地 Docker `postgres` 环境可以执行：

```powershell
.\lobehub-admin-module\scripts\disable-global-auto-provision.ps1
```

远程 Neon / PostgreSQL 环境则直接在 SQL Editor 中执行：

- `lobehub-admin-module/sql/002_disable_global_auto_provision.sql`

## 3. 启动后端服务

目录：

```powershell
cd D:\lobe-hub2\lobehub-admin-module\service
```

准备 `.env`：

```env
PORT=3321
HOST=127.0.0.1
DATABASE_URL=postgresql://lobehub:lobehubpass@127.0.0.1:5432/lobehub
CORS_ORIGIN=http://127.0.0.1:4173,http://localhost:4173
ADMIN_SESSION_COOKIE_NAME=lobehub_admin_session
ADMIN_SESSION_TTL_HOURS=12
ADMIN_SESSION_SECURE_COOKIE=false
ALLOW_LEGACY_ACTOR_HEADER=false
TRUST_PROXY=false

# Daily report generation
DAILY_REPORT_DEFAULT_MODEL_PROVIDER=fallback
# DAILY_REPORT_DEFAULT_MODEL_NAME=doubao-seed-2-0-lite-260215
# VOLCENGINE_API_KEY=your-volcengine-api-key
# VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

启动：

```powershell
npm install
npm run dev
```

后端接口默认地址：

```text
http://127.0.0.1:3321
```

补充说明：
- 服务进程启动时会自动恢复未完成的日报任务。
- 服务进程启动时也会自动恢复未完成的自由盘点任务。
- 服务进程会每 60 秒扫描一次已启用项目的日报到点情况。
- 如果未显式设置 `DAILY_REPORT_DEFAULT_MODEL_PROVIDER`，但配置了 `VOLCENGINE_API_KEY`，当前会默认走 `volcengine`；否则回退为内建摘要器。

## 3.1 当前线上实际运行方式

当前线上已经验证通过的方式不是宿主机直接安装 Node，而是：

- 使用 `node:20` 容器运行管理端后端
- 容器挂载 `/home/admin/lobehub-admin/service`
- 运行时读取 `service/.env`

注意：

- 后端默认自动读取的是 `.env`
- 如果服务器上先上传的是 `.env.production`，需要复制成 `.env`

典型流程：

```bash
cd /home/admin/lobehub-admin/service
cp .env.production .env
docker run --rm -it -v "$PWD":/app -w /app node:20 npm install
docker run --rm -it -v "$PWD":/app -w /app node:20 npm run build
```

正式运行由 Docker compose 网关栈接管，见：

- `deploy/lobehub-gateway/docker-compose.gateway-admin.yml`

## 4. 启动前端页面

目录：

```powershell
cd D:\lobe-hub2\lobehub-admin-module\web
```

准备 `.env`：

```env
VITE_API_BASE_URL=http://127.0.0.1:3321
```

启动：

```powershell
npm install
npm run dev
```

前端地址：

```text
http://127.0.0.1:4173
```

独立数据查看页地址：

```text
http://127.0.0.1:4173/database-viewer.html
```

## 4.1 当前线上实际运行方式

当前线上更推荐：

1. 在本地构建前端
2. 上传 `web/dist` 的静态文件到服务器
3. 由 Docker Nginx 网关托管 `/admin/`

当前已提供生产构建文件：

- `web/.env.production`

默认内容：

```env
VITE_PUBLIC_BASE=/admin/
VITE_API_BASE_URL=/admin-api
```

补充说明：
- 如果没有显式提供 `VITE_PUBLIC_BASE` / `VITE_API_BASE_URL`，当前生产构建也会默认回退到 `/admin/` 与 `/admin-api`
- 构建完成后建议先检查 `web/dist/index.html` 与 `web/dist/database-viewer.html`
  - 静态资源应指向 `/admin/assets/...`
  - 如果仍然是 `/assets/...`，说明这次构建没有按管理端子路径产出，上传后会导致 `/admin/` 白屏或资源 404

构建方式：

```bash
cd lobehub-admin-module/web
npm install
npm run build
```

服务器上的目标目录是：

```text
/home/admin/lobehub-admin/web/
```

## 5. 当前鉴权方式

当前默认使用真实后台登录：
- 复用 `public.users` + `public.accounts`
- 只校验 `provider_id = 'credential'` 的邮箱密码
- 登录成功后由管理端写入独立 cookie 会话

旧的 `x-admin-user-id` 仅保留为可选调试回退，默认关闭，只有显式设置 `ALLOW_LEGACY_ACTOR_HEADER=true` 才会启用。

## 6. 快速启动脚本

在仓库根目录可以直接用：

```powershell
.\lobehub-admin-module\scripts\start-admin-api.ps1
.\lobehub-admin-module\scripts\start-admin-web.ps1
```

如果要一起启动：

```powershell
.\lobehub-admin-module\scripts\start-admin-dev.ps1
```

## 6.1 当前线上整合入口

当前实际线上整合不是系统级 Nginx，而是 Docker Nginx 网关容器。

推荐目录：

```text
/home/admin/lobehub/
/home/admin/lobehub-admin/
/home/admin/lobehub-nginx/
```

对应文件：

- `/home/admin/lobehub-nginx/docker-compose.gateway-admin.yml`
- `/home/admin/lobehub-nginx/conf.d/default.conf`

对应仓库模板：

- `deploy/lobehub-gateway/docker-compose.gateway-admin.yml`
- `deploy/lobehub-gateway/nginx.default.conf`
- `deploy/lobehub-gateway/README.md`

这套方案会统一暴露：

- `/`
- `/admin/`
- `/admin-api/`

## 7. 当前可用能力

- 创建项目
- 删除项目
- 选择项目管理员
- 查看成员列表
- 批量添加成员
- 移除成员
- 选择模板管理员和模板助手
- 发起批量配置任务
- 发起刷新任务
- 查看最近任务状态
- 查看旧的全局自动下发状态
- 过滤内部助手候选，仅展示适合做模板的助手
- 后台邮箱密码登录
- 项目成员运营报表
- 项目经营日报
  - 可配置时区、营业日截点、项目补充要求、空来访时是否生成
  - 可覆盖日报模型 provider / model name
  - 支持手动触发、自动调度、任务查询、日报列表与详情
- 数据查看
  - 首页项目详情页已接入“数据查看”标签
  - 同时提供独立入口页 `database-viewer.html`
  - 系统管理员可查看 `crm` / `lobehub_admin` / `public`
  - 项目管理员仅可查看 `crm`
  - 项目管理员仅读取 `project = 自己所在项目名称` 的数据
  - 若表中没有 `project` 字段，则返回空数据
- 所有前端时间默认按东八区显示

## 8. 当前未完成能力

- 正式登录与权限认证
- 面向 CRM 业务语义的专用报表
- 异步 worker
- Docker 化独立部署
- 生产态静态资源托管
- skill 同名覆盖治理
## 9. 2026-03-21 补充

- 日报模型部署口径已切到 `volcengine`，推荐显式配置：

```env
DAILY_REPORT_DEFAULT_MODEL_PROVIDER=volcengine
DAILY_REPORT_DEFAULT_MODEL_NAME=doubao-seed-2-0-lite-260215
VOLCENGINE_API_KEY=your-volcengine-api-key
VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

- 日报提示词当前固定为两层：
  - 系统提示词：固定、只读、前端可见但不可编辑
  - 项目补充要求：项目级可编辑
- 当前主站 `lobehub` 运行口径应使用修正后的 `/home/admin/lobehub/docker-compose.yml`。
- 当前主站 provider 方向为 `VOLCENGINE_*`，`NEWAPI_*` 不再作为本部署路径下的主站运行配置。
