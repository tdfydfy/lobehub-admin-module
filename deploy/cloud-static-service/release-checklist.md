# 上线检查清单

## 前端

- 已设置 `VITE_PUBLIC_BASE=/admin/`
- 已设置 `VITE_API_BASE_URL=/admin-api`
- 已执行 `npm run build`
- 已确认 `web/dist/index.html` 与 `web/dist/database-viewer.html` 中引用的是 `/admin/assets/...`
- 已确认 `web/dist/index.html` 可从 `/admin/` 打开
- 已确认 `web/dist/database-viewer.html` 可从 `/admin/database-viewer.html` 打开

## 后端

- 已设置 `HOST=0.0.0.0`
- 已设置正确的 `DATABASE_URL`
- 已根据当前入口策略设置 `ADMIN_SESSION_SECURE_COOKIE`
  - 仅 HTTPS 域名：`true`
  - HTTPS 域名 + HTTP IP 兜底：`false`
- 已设置 `TRUST_PROXY=true`
- 已设置 `CORS_ORIGIN=https://daiworld.com,https://www.daiworld.com,http://112.74.94.150,http://39.108.106.95`
- 已执行 `npm run build`

## Nginx

- 已增加 `/admin/` 静态目录路由
- 已增加 `/admin-api/` 反向代理路由
- 已按网关策略配置 `/admin-api/` 的 `proxy_read_timeout` / `proxy_send_timeout`
  - 推荐保留宽松超时作为兼容兜底；当前“自由盘点”和“日报手动触发”已任务化，正常会快速返回任务 ID
- 已透传：
  - `Host`
  - `X-Real-IP`
  - `X-Forwarded-For`
  - `X-Forwarded-Proto`

## 验证

- `/admin/` 首页可以打开
- 登录后 cookie 正常写入
- `https://daiworld.com/admin/` 可访问
- `https://www.daiworld.com/admin/` 可访问
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
