# Admin Service

独立于 `lobehub` 主应用的管理后端服务。

当前作用：
- 提供项目、成员、模板、批量任务 API
- 直接连接现有 PostgreSQL
- 复用 `lobehub_admin` schema 中的函数与表

## 当前鉴权

当前默认使用真实后台登录：
- 复用 `public.users` + `public.accounts`
- 仅校验 `provider_id = 'credential'` 的邮箱密码
- 登录成功后写入管理端独立 `httpOnly` cookie 会话

如需兼容旧调试脚本，可在 `.env` 中显式设置：

```env
ALLOW_LEGACY_ACTOR_HEADER=true
```

此时才会回退接受 `x-admin-user-id`。

## 启动

1. 复制 `.env.example` 为 `.env`
2. 安装依赖
3. 启动服务

```bash
npm install
npm run dev
```

如果前端单独跑在另一个端口，需要设置：

```bash
CORS_ORIGIN=http://127.0.0.1:4173
```

登录会话相关可选配置：

```bash
ADMIN_SESSION_COOKIE_NAME=lobehub_admin_session
ADMIN_SESSION_TTL_HOURS=12
ADMIN_SESSION_SECURE_COOKIE=false
```

如需启用项目文档内部知识接口，额外配置：

```bash
PROJECT_DOCS_INTERNAL_TOKEN=replace-with-a-long-random-string
```

如需启用项目文档共享知识插件，额外配置：

```bash
PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL=https://daiworld.top/admin-api
PROJECT_DOCS_PLUGIN_SECRET=replace-with-a-long-random-string
```

## 已提供接口

- `GET /health`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me/context`
- `GET /api/system/status`
- `GET /api/users?q=`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/members`
- `POST /api/projects/:projectId/members`
- `DELETE /api/projects/:projectId/members/:userId`
- `GET /api/projects/:projectId/agents?adminUserId=...`
- `GET /api/projects/:projectId/template`
- `PUT /api/projects/:projectId/template`
- `GET /api/system/global-documents`
- `POST /api/system/global-documents`
- `GET /api/system/global-documents/:documentId`
- `PUT /api/system/global-documents/:documentId`
- `DELETE /api/system/global-documents/:documentId`
- `GET /api/projects/:projectId/documents`
- `POST /api/projects/:projectId/documents`
- `GET /api/projects/:projectId/documents/:documentId`
- `PUT /api/projects/:projectId/documents/:documentId`
- `DELETE /api/projects/:projectId/documents/:documentId`
- `POST /api/projects/:projectId/provision`
- `POST /api/projects/:projectId/provision/refresh`
- `GET /api/projects/:projectId/jobs/:jobId`
- `GET /api/projects/:projectId/reports/member-activity`
- `GET /api/projects/:projectId/reports/member-activity/export`
- `GET /api/projects/:projectId/reports/topic-stats`
- `GET /api/projects/:projectId/reports/topic-stats/users/:userId/topics`
- `GET /api/projects/:projectId/reports/topic-stats/topics/:topicId`
- `GET /internal/project-docs/context?projectId=...`
- `GET /internal/project-docs/search?projectId=...&query=...`
- `GET /internal/project-docs/read?projectId=...&documentId=...`
- `GET /public/project-knowledge/:projectId/:signature/manifest.json`
- `POST /public/project-knowledge/:projectId/:signature/query`
- `POST /public/project-knowledge/:projectId/:signature/context`
