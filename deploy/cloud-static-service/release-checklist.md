# 上线检查清单

## 前端

- 已设置 `VITE_PUBLIC_BASE=/admin/`
- 已设置 `VITE_API_BASE_URL=/admin-api`
- 已执行 `npm run build`
- 已确认 `web/dist/index.html` 可从 `/admin/` 打开
- 已确认 `web/dist/database-viewer.html` 可从 `/admin/database-viewer.html` 打开

## 后端

- 已设置 `HOST=0.0.0.0`
- 已设置正确的 `DATABASE_URL`
- 已设置 `ADMIN_SESSION_SECURE_COOKIE=true`
- 已设置 `TRUST_PROXY=true`
- 已执行 `npm run build`

## Nginx

- 已增加 `/admin/` 静态目录路由
- 已增加 `/admin-api/` 反向代理路由
- 已透传：
  - `Host`
  - `X-Real-IP`
  - `X-Forwarded-For`
  - `X-Forwarded-Proto`

## 验证

- `/admin/` 首页可以打开
- 登录后 cookie 正常写入
- 项目列表能加载
- 成员管理能正常增删改
- 报表和对话统计能正常查询
- `/admin/database-viewer.html` 可打开并可登录

## Docker Gateway Variant

如果当前环境没有系统级 Nginx，而是使用 Docker 网关：

- 已上传 `deploy/lobehub-gateway/docker-compose.gateway-admin.yml`
- 已上传 `deploy/lobehub-gateway/nginx.default.conf`
- `nginx_container` 与 `lobehub-admin-service` 已加入 `lobehub_default`
- `/home/admin/lobehub-admin/web/` 已挂载到网关容器
