# 线上部署具体步骤

这份文档按当前真实场景编写，不再使用泛化的 `your-domain.com` 占位方式。

当前真实场景：
- 管理端通过公网 IP 访问，而不是正式域名
- 生产访问 IP：`112.74.94.150`
- 测试访问 IP：`39.108.106.95`
- 管理前端路径：`/admin/`
- 管理后端路径：`/admin-api/`
- LobeHub 主站仍独立走 `3210` 端口

当前真实访问地址：
- 生产管理端首页：`http://112.74.94.150/admin/`
- 生产管理端健康检查：`http://112.74.94.150/admin-api/health`
- 生产 LobeHub 主站：`http://112.74.94.150:3210/`
- 测试管理端首页：`http://39.108.106.95/admin/`
- 测试管理端健康检查：`http://39.108.106.95/admin-api/health`
- 测试 LobeHub 主站：`http://39.108.106.95:3210/`

## 1. 目录结构

服务器推荐目录：

```text
/home/admin/lobehub/
/home/admin/lobehub-admin/
/home/admin/lobehub-nginx/
/home/admin/homepage/
```

目录用途：
- `/home/admin/lobehub/`
  主站目录
- `/home/admin/lobehub-admin/service/`
  管理端后端目录
- `/home/admin/lobehub-admin/web/`
  管理端前端静态文件目录
- `/home/admin/lobehub-nginx/`
  网关 compose 与 Nginx 配置目录
- `/home/admin/homepage/`
  门户首页静态文件目录

## 2. 数据库准备

在目标 PostgreSQL / Neon 执行以下脚本：

1. 核心 schema
   文件： [001_project_admin_core.sql](/D:/lobe-hub2/lobehub-admin-module/sql/001_project_admin_core.sql)

2. 如存在旧自动下发逻辑，再执行关闭脚本
   文件： [002_disable_global_auto_provision.sql](/D:/lobe-hub2/lobehub-admin-module/sql/002_disable_global_auto_provision.sql)

如果是 Neon，直接在 SQL Editor 中执行即可。

## 3. 本地构建

### 3.1 构建后端

```powershell
cd D:\lobe-hub2\lobehub-admin-module\service
npm install
npm run build
```

### 3.2 构建前端

前端生产环境文件已经是当前真实场景需要的值：

文件： [web/.env.production](/D:/lobe-hub2/lobehub-admin-module/web/.env.production)

内容：

```env
VITE_PUBLIC_BASE=/admin/
VITE_API_BASE_URL=/admin-api
```

然后执行：

```powershell
cd D:\lobe-hub2\lobehub-admin-module\web
npm install
npm run build
```

构建产物目录：

```text
web/dist/
```

## 4. 上传文件到服务器

### 4.1 管理端后端

上传整个 `service/` 目录到：

```text
/home/admin/lobehub-admin/service/
```

### 4.2 管理端前端

将本地 [web/dist](/D:/lobe-hub2/lobehub-admin-module/web/dist) 中的文件上传到：

```text
/home/admin/lobehub-admin/web/
```

上传后至少应包含：
- `index.html`
- `database-viewer.html`
- `assets/`

### 4.3 网关文件

将以下文件上传到服务器：

- [docker-compose.gateway-admin.yml](/D:/lobe-hub2/deploy/lobehub-gateway/docker-compose.gateway-admin.yml)
- [default.conf](/D:/lobe-hub2/deploy/lobehub-gateway/default.conf)

目标路径：

```text
/home/admin/lobehub-nginx/docker-compose.gateway-admin.yml
/home/admin/lobehub-nginx/conf.d/default.conf
```

## 5. 后端环境变量

服务器端创建：

```text
/home/admin/lobehub-admin/service/.env
```

直接参考新建的生产示例文件：

文件： [service/.env.production.example](/D:/lobe-hub2/lobehub-admin-module/service/.env.production.example)

当前真实场景建议值：

```env
PORT=3321
HOST=0.0.0.0
DATABASE_URL=postgresql://username:password@host/database?sslmode=require&channel_binding=require
CORS_ORIGIN=http://112.74.94.150,http://39.108.106.95
ADMIN_SESSION_COOKIE_NAME=lobehub_admin_session
ADMIN_SESSION_TTL_HOURS=12
ADMIN_SESSION_SECURE_COOKIE=false
ALLOW_LEGACY_ACTOR_HEADER=false
TRUST_PROXY=true
```

说明：
- `HOST=0.0.0.0`
  因为后端要被同 Docker 网络中的 Nginx 网关访问
- `CORS_ORIGIN`
  当前真实场景是两个公网 IP，所以直接写：
  `http://112.74.94.150,http://39.108.106.95`
- `ADMIN_SESSION_SECURE_COOKIE=false`
  当前真实场景仍然是 HTTP + IP，不是 HTTPS 域名，不能打开 Secure
- `TRUST_PROXY=true`
  当前网关在前，建议保持开启

## 6. 在服务器安装依赖并构建后端

进入目录：

```bash
cd /home/admin/lobehub-admin/service
```

执行：

```bash
docker run --rm -it -v "$PWD":/app -w /app node:20 npm install
docker run --rm -it -v "$PWD":/app -w /app node:20 npm run build
```

## 7. 启动网关与管理端后端

进入目录：

```bash
cd /home/admin/lobehub-nginx
```

启动：

```bash
docker compose -f docker-compose.gateway-admin.yml up -d
```

当前模板会启动：
- `lobehub-admin-service`
- `nginx-gateway`

当前网关模板已包含一项额外修复：
- `/`
- `/index.html`
- `/admin/index.html`
- `/admin/database-viewer.html`

这些 HTML 入口会强制返回 `no-cache` 头，避免服务升级后浏览器继续使用旧的 SPA HTML。

同时：
- `/admin/assets/` 会返回长期缓存头
- 哈希文件可继续安全缓存

## 8. 访问验证

服务器内验证：

```bash
curl http://127.0.0.1/admin-api/health
curl -I http://127.0.0.1/admin/
curl -I http://127.0.0.1/admin/database-viewer.html
```

公网验证：

```text
http://112.74.94.150/admin/
http://112.74.94.150/admin-api/health
http://39.108.106.95/admin/
http://39.108.106.95/admin-api/health
```

主站入口验证：

```text
http://112.74.94.150:3210/
http://39.108.106.95:3210/
```

如果刚更新了前端文件但浏览器仍显示旧界面，先确认服务器上已同步最新的：
- `deploy/lobehub-gateway/default.conf`
- `/home/admin/lobehub-nginx/conf.d/default.conf`

然后重启网关：

```bash
cd /home/admin/lobehub-nginx
docker compose -f docker-compose.gateway-admin.yml up -d
```

## 9. 当前真实场景下的几个关键点

### 9.1 不能把 cookie 设成 Secure

因为当前还没切 HTTPS 域名，还是通过 `http://IP/` 访问，所以：

```env
ADMIN_SESSION_SECURE_COOKIE=false
```

### 9.2 前端不需要写死公网 host

前端生产环境继续使用：

```env
VITE_PUBLIC_BASE=/admin/
VITE_API_BASE_URL=/admin-api
```

这样静态页部署到任意一个公网 IP 后，都能自动走当前站点下的 `/admin-api`。

### 9.3 当前网关不绑定特定域名

当前 [default.conf](/D:/lobe-hub2/deploy/lobehub-gateway/default.conf) 使用：

```nginx
server_name _;
```

这是对的，因为当前真实场景就是按 IP 提供访问。

## 10. 后续如果切 HTTPS 域名

如果后续从 IP 访问切到正式域名，再做以下调整：

1. 将 `CORS_ORIGIN` 改成正式域名
2. 将 `ADMIN_SESSION_SECURE_COOKIE` 改为 `true`
3. 保持前端：
   `VITE_PUBLIC_BASE=/admin/`
   `VITE_API_BASE_URL=/admin-api`
4. 由外层网关或证书服务提供 HTTPS

在当前阶段，不要提前把这几项改成域名版，否则登录 cookie 会直接失效。

## 11. 已部署环境升级

如果服务器上已经部署过旧版管理端，不需要从头重装。

请直接参考：

- [upgrade-existing-deployment.md](/D:/lobe-hub2/lobehub-admin-module/docs/upgrade-existing-deployment.md)

升级时重点注意：
- 同步新的 `service/` 后端代码
- 覆盖新的 `web/dist/`
- 同步新的 `default.conf`
- 重启 `lobehub-admin-service` 与 `nginx-gateway`
