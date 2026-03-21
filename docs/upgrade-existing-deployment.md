# 已部署环境升级指引

本文面向“服务器上已经跑着旧版管理端”的场景。

当前目标是升级到：
- `https://daiworld.com`
- `https://www.daiworld.com`

同时继续保留：
- `http://112.74.94.150`
- `http://39.108.106.95`

作为兜底入口。

## 1. 本次升级要一起带上的内容

建议本次一起同步：
- 成员登录与自有 Topic 查看
- 模板管理员 / 模板助手归属校验修复
- `/api/projects/:projectId/agents` 的 `rt_fetch used out-of-bounds` 规避
- 项目经营日报能力
  - 日报设置、日报任务、日报结果表结构
  - 日报手动生成、自动调度、列表与详情
  - `volcengine` 作为当前推荐日报模型 provider
- 双域名 HTTPS 支持
- HTTP IP 兜底入口保留
- SPA HTML `no-cache` 网关头

## 2. 升级前备份

至少备份：

```bash
cp /home/admin/lobehub-admin/service/.env /home/admin/lobehub-admin/service/.env.bak.$(date +%F-%H%M%S)
cp /home/admin/lobehub-nginx/conf.d/default.conf /home/admin/lobehub-nginx/conf.d/default.conf.bak.$(date +%F-%H%M%S)
cp /home/admin/lobehub-nginx/docker-compose.gateway-admin.yml /home/admin/lobehub-nginx/docker-compose.gateway-admin.yml.bak.$(date +%F-%H%M%S)
```

## 3. 本地更新并重新构建

```powershell
cd D:\lobe-hub2\lobehub-admin-module\service
npm install
npm run build

cd D:\lobe-hub2\lobehub-admin-module\web
npm install
npm run build
```

## 3.1 已部署数据库的增量 SQL

如果服务器数据库已经装过旧版 `lobehub_admin` schema，这次不要重跑整份 `001_project_admin_core.sql`，而是按顺序执行：

```powershell
cd D:\lobe-hub2
.\lobehub-admin-module\scripts\check-project-admin-mappings.ps1
.\lobehub-admin-module\scripts\upgrade-existing-project-admin.ps1
```

用途：
- `005_check_project_managed_mapping_health.sql`
  - 升级前只读自检
  - 查看哪些成员完全没有官方映射
  - 查看哪些映射缺少助手 ID、会话 ID、canonical slug 或存在悬挂引用
- `003_fix_provision_skip_requires_session.sql`
  - 升级 `provision_project_member(...)`
  - 官方助手现在只按 `(project_id, user_id)` 识别
  - 只有官方助手和官方会话都存在时才允许直接 `skipped`
- `004_repair_project_managed_mappings.sql`
  - 一次性修复已有 `project_managed_agents` 映射中的助手/会话 ID
  - 规范官方助手和官方会话的 canonical slug
  - 补齐 `agents_to_sessions` 关联
- `006_daily_reports.sql`
  - 增加日报设置表、日报任务表、日报结果表
  - 补齐相关索引与 `updated_at` 触发器
- `007_daily_report_volcengine_provider.sql`
  - 将日报模型 provider 约束扩展为 `volcengine / fallback`

限制：
- `004` 只修复已经存在的项目映射。
- 如果某个成员完全没有 `project_managed_agents` 记录，仍需在项目页重新执行一次“为成员配置助手”或“刷新成员助手”。

如果需要拆开执行，再使用：

```powershell
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/003_fix_provision_skip_requires_session.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/004_repair_project_managed_mappings.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/006_daily_reports.sql"
.\lobehub-admin-module\scripts\apply-project-admin-core.ps1 -SqlFile "lobehub-admin-module/sql/007_daily_report_volcengine_provider.sql"
```

## 4. 上传需要更新的文件

### 4.1 后端

同步到：

```text
/home/admin/lobehub-admin/service/
```

至少同步：
- `service/dist/`
- `service/src/`
- `service/package.json`
- `service/package-lock.json`

### 4.2 前端

覆盖上传：

```text
/home/admin/lobehub-admin/web/
```

来源是新的 `web/dist/`。

### 4.3 网关

这次升级如果要同时支持：
- `https://daiworld.com`
- `https://www.daiworld.com`
- 旧 IP HTTP 兜底

则必须同步新的 Nginx 配置。

建议参考：

- [deploy/cloud-static-service/nginx.admin.https.daiworld.com.conf.example](/D:/lobe-hub2/lobehub-admin-module/deploy/cloud-static-service/nginx.admin.https.daiworld.com.conf.example)

把等价配置覆盖到：

```text
/home/admin/lobehub-nginx/conf.d/default.conf
```

## 5. 线上 `.env` 要改什么

服务器上已有：

```text
/home/admin/lobehub-admin/service/.env
```

这次请重点改成：

```env
HOST=0.0.0.0
CORS_ORIGIN=https://daiworld.com,https://www.daiworld.com,http://112.74.94.150,http://39.108.106.95
ADMIN_SESSION_SECURE_COOKIE=false
TRUST_PROXY=true
DAILY_REPORT_DEFAULT_MODEL_PROVIDER=volcengine
DAILY_REPORT_DEFAULT_MODEL_NAME=doubao-seed-2-0-lite-260215
VOLCENGINE_API_KEY=your-volcengine-api-key
VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

日报补充说明：
- 当前推荐显式设置 `DAILY_REPORT_DEFAULT_MODEL_PROVIDER=volcengine`。
- 如未显式设置 provider，但存在 `VOLCENGINE_API_KEY`，日报会默认走 `volcengine`。
- 日报提示词当前固定为两层：系统提示词 + 项目补充要求。
- 服务重启后会自动恢复未完成日报任务，并继续每 60 秒执行一次到点扫描。

### 为什么这里还是 `false`

因为你要求保留旧 IP 登录兜底。

只要还保留：
- `http://112.74.94.150/admin/`
- `http://39.108.106.95/admin/`

就不能把 cookie 改成 `Secure=true`，否则 IP HTTP 入口登录会失效。

如果将来完全停止 IP 登录入口，再改成：

```env
ADMIN_SESSION_SECURE_COOKIE=true
```

并把 `CORS_ORIGIN` 收紧到两个 HTTPS 域名。

## 6. 服务器端重装依赖并构建后端

```bash
cd /home/admin/lobehub-admin/service
docker run --rm -it -v "$PWD":/app -w /app node:20 npm install
docker run --rm -it -v "$PWD":/app -w /app node:20 npm run build
```

## 7. 重启服务

```bash
cd /home/admin/lobehub-nginx
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service nginx-gateway
```

## 8. 升级后验证

### HTTPS 域名

检查：
- `https://daiworld.com/admin/`
- `https://www.daiworld.com/admin/`
- `https://daiworld.com/admin-api/health`
- `https://www.daiworld.com/admin-api/health`

### HTTP IP 兜底

检查：
- `http://112.74.94.150/admin/`
- `http://39.108.106.95/admin/`

### 功能项

重点验证：
- 两个域名都能登录
- IP 兜底入口仍能登录
- 模板管理员切换后，模板助手列表会刷新
- 选错模板助手时，保存模板返回明确业务错误
- 成员能登录并查看自己的 Topic
- `/api/projects/:projectId/agents` 不再报 `rt_fetch used out-of-bounds`
- 执行“为成员配置助手”或“刷新成员助手”时，请求会快速返回任务 ID，而不是长时间阻塞
- 同一项目同一成员不会重复新增官方助手，只会更新既有官方助手/官方会话
- “日报”标签页能正常加载设置、任务和日报列表
- 手动生成日报后，任务能转成 `completed`，并能在列表里看到新日报
- 日报详情能查看正文、结构化 JSON、模型 provider / model name

## 9. 升级特别提醒

### 9.1 这次是双域名 + IP 混合阶段

所以当前建议：
- 域名入口走 HTTPS
- IP 入口继续保留 HTTP
- Cookie 暂时不要切 `Secure=true`

### 9.2 如果前端更新后还是旧页面

请确认：
- 已同步新的 `default.conf`
- 已重启 `nginx-gateway`

因为这次网关配置包含 SPA HTML 的 `no-cache` 头修复。

### 9.3 日报模型配置方向

当前两台已验证服务器上的主站 `lobehub`，都应运行修正后的：
- `/home/admin/lobehub/docker-compose.yml`

当前主站 provider 方向是：
- `VOLCENGINE_*`

因此本次升级路径下：
- `NEWAPI_*` 不再作为主站实际运行配置
- 管理端日报模型也应优先对齐 `volcengine`

## 10. 回滚方式

如果升级后发现异常：

1. 恢复备份的 `.env`
2. 恢复备份的 `default.conf`
3. 恢复旧版 `service/` 与 `web/`
4. 再执行：

```bash
cd /home/admin/lobehub-nginx
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service nginx-gateway
```
