# 线上部署具体步骤

本文按当前目标场景编写：

- 正式域名：
  - `https://daiworld.com`
  - `https://www.daiworld.com`
- 继续保留旧 IP 兜底入口：
  - `http://112.74.94.150`
  - `http://39.108.106.95`
- 管理端前端：
  - `/admin/`
- 管理端后端：
  - `/admin-api/`

当前推荐访问方式：
- 正式入口：
  - `https://daiworld.com/admin/`
  - `https://www.daiworld.com/admin/`
- API 健康检查：
  - `https://daiworld.com/admin-api/health`
  - `https://www.daiworld.com/admin-api/health`
- IP 兜底入口：
  - `http://112.74.94.150/admin/`
  - `http://39.108.106.95/admin/`

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
  管理端后端
- `/home/admin/lobehub-admin/web/`
  管理端前端静态文件
- `/home/admin/lobehub-nginx/`
  网关 compose 与 Nginx 配置
- `/home/admin/homepage/`
  站点根路径首页静态文件

## 2. 数据库准备

在目标 PostgreSQL / Neon 执行：

1. [001_project_admin_core.sql](/D:/lobe-hub2/lobehub-admin-module/sql/001_project_admin_core.sql)
2. 如存在旧自动下发逻辑，再执行 [002_disable_global_auto_provision.sql](/D:/lobe-hub2/lobehub-admin-module/sql/002_disable_global_auto_provision.sql)

## 3. 本地构建

### 3.1 构建后端

```powershell
cd D:\lobe-hub2\lobehub-admin-module\service
npm install
npm run build
```

### 3.2 构建前端

前端生产环境继续使用：

文件： [web/.env.production](/D:/lobe-hub2/lobehub-admin-module/web/.env.production)

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

## 4. 上传文件

### 4.1 后端

上传到：

```text
/home/admin/lobehub-admin/service/
```

### 4.2 前端

将 [web/dist](/D:/lobe-hub2/lobehub-admin-module/web/dist) 内容上传到：

```text
/home/admin/lobehub-admin/web/
```

### 4.3 网关

当前建议使用 HTTPS 双域名 + HTTP IP 兜底的 Nginx 示例文件：

- [deploy/cloud-static-service/nginx.admin.https.daiworld.com.conf.example](/D:/lobe-hub2/lobehub-admin-module/deploy/cloud-static-service/nginx.admin.https.daiworld.com.conf.example)

如果你仍沿用 Docker 网关目录部署，则把等价配置同步到：

```text
/home/admin/lobehub-nginx/conf.d/default.conf
```

## 5. 后端环境变量

服务器端创建：

```text
/home/admin/lobehub-admin/service/.env
```

直接参考：

- [service/.env.production.example](/D:/lobe-hub2/lobehub-admin-module/service/.env.production.example)

当前目标场景建议值：

```env
PORT=3321
HOST=0.0.0.0
DATABASE_URL=postgresql://username:password@host/database?sslmode=require&channel_binding=require
CORS_ORIGIN=https://daiworld.com,https://www.daiworld.com,http://112.74.94.150,http://39.108.106.95
ADMIN_SESSION_COOKIE_NAME=lobehub_admin_session
ADMIN_SESSION_TTL_HOURS=12
ADMIN_SESSION_SECURE_COOKIE=false
ALLOW_LEGACY_ACTOR_HEADER=false
TRUST_PROXY=true
```

### 为什么这里仍然是 `ADMIN_SESSION_SECURE_COOKIE=false`

因为你明确要求保留旧 IP 入口兜底。

如果还要支持：

- `http://112.74.94.150/admin/`
- `http://39.108.106.95/admin/`

那么登录 cookie 不能强制设成 `Secure=true`，否则通过 HTTP IP 访问时 cookie 不会写入，登录会直接失效。

结论：
- 如果要“HTTPS 域名 + HTTP IP 兜底”同时可用，当前必须保持 `false`
- 只有在你彻底下线旧 IP 登录入口之后，才能改成 `true`

## 6. Nginx / HTTPS 关键点

当前建议的网关策略是：

1. `daiworld.com` 与 `www.daiworld.com` 的 HTTP 请求统一 301 到 HTTPS
2. 两个域名的 HTTPS 请求正常提供 `/`、`/admin/`、`/admin-api/`
3. 对公网 IP 的 HTTP 请求继续保留原能力，作为兜底入口

证书建议：
- `daiworld.com`
- `www.daiworld.com`

证书文件路径在示例中使用：

```text
/etc/letsencrypt/live/daiworld.com/fullchain.pem
/etc/letsencrypt/live/daiworld.com/privkey.pem
```

如你的证书路径不同，按实际服务器路径替换即可。

## 7. 服务器端重新安装依赖并构建后端

```bash
cd /home/admin/lobehub-admin/service
docker run --rm -it -v "$PWD":/app -w /app node:20 npm install
docker run --rm -it -v "$PWD":/app -w /app node:20 npm run build
```

## 8. 启动或重启服务

```bash
cd /home/admin/lobehub-nginx
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service nginx-gateway
```

## 9. 验证

### HTTPS 域名入口

```text
https://daiworld.com/admin/
https://www.daiworld.com/admin/
https://daiworld.com/admin-api/health
https://www.daiworld.com/admin-api/health
```

### HTTP IP 兜底入口

```text
http://112.74.94.150/admin/
http://39.108.106.95/admin/
```

### 需要重点确认

- 两个 HTTPS 域名都能打开管理端
- 两个 HTTPS 域名都能正常登录
- 旧 IP 入口仍能正常登录
- `/admin/` 静态资源加载正常
- `/admin-api/health` 返回成功

## 10. 当前阶段的建议

如果你后续确认不再需要旧 IP 登录兜底，再做这一步：

```env
ADMIN_SESSION_SECURE_COOKIE=true
```

同时把 `CORS_ORIGIN` 收紧为：

```env
CORS_ORIGIN=https://daiworld.com,https://www.daiworld.com
```

## 11. 已部署环境升级

如果服务器上已经部署过旧版管理端，请直接参考：

- [upgrade-existing-deployment.md](/D:/lobe-hub2/lobehub-admin-module/docs/upgrade-existing-deployment.md)
