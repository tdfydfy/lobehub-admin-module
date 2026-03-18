# 已部署环境升级指引

本文用于“已经部署过旧版管理端”的场景。

适用前提：
- 服务器上已经存在 `/home/admin/lobehub-admin/service/`
- 服务器上已经存在 `/home/admin/lobehub-admin/web/`
- 服务器上已经存在 `/home/admin/lobehub-nginx/`
- 当前管理端已经能通过 `/admin/` 和 `/admin-api/` 访问

这份文档解决的是“如何从旧版升级到新版”，不是从零部署。

## 1. 本次升级建议一起带上的内容

本次建议同步以下变更：
- 成员登录与自有 Topic 查看
- 模板管理员 / 模板助手归属校验修复
- `/api/projects/:projectId/agents` 的 `rt_fetch used out-of-bounds` 规避
- 网关对 SPA HTML 入口加 `no-cache` 响应头

说明：
- 最后一项要求同步更新网关配置文件 `default.conf`
- 如果只更新 `web/dist`，但不更新网关配置，浏览器仍可能继续使用旧 HTML

## 2. 升级前备份

建议至少备份以下文件：

```bash
cp /home/admin/lobehub-admin/service/.env /home/admin/lobehub-admin/service/.env.bak.$(date +%F-%H%M%S)
cp /home/admin/lobehub-nginx/conf.d/default.conf /home/admin/lobehub-nginx/conf.d/default.conf.bak.$(date +%F-%H%M%S)
cp /home/admin/lobehub-nginx/docker-compose.gateway-admin.yml /home/admin/lobehub-nginx/docker-compose.gateway-admin.yml.bak.$(date +%F-%H%M%S)
```

## 3. 本地更新代码并重新构建

在本地仓库更新代码后，重新构建：

```powershell
cd D:\lobe-hub2\lobehub-admin-module\service
npm install
npm run build

cd D:\lobe-hub2\lobehub-admin-module\web
npm install
npm run build
```

## 4. 上传需要更新的文件

### 4.1 后端

建议同步整个 `service/` 目录到服务器，但不要覆盖线上 `.env`：

目标目录：

```text
/home/admin/lobehub-admin/service/
```

至少要同步：
- `service/dist/`
- `service/src/`
- `service/package.json`
- `service/package-lock.json`

### 4.2 前端

将新的 `web/dist/` 内容覆盖上传到：

```text
/home/admin/lobehub-admin/web/
```

### 4.3 网关

如果这次要一起修复“升级后浏览器仍使用旧 HTML”的问题，必须同步：

- [default.conf](/D:/lobe-hub2/deploy/lobehub-gateway/default.conf)

覆盖到：

```text
/home/admin/lobehub-nginx/conf.d/default.conf
```

如果网关 compose 模板也有调整，再同步：

- [docker-compose.gateway-admin.yml](/D:/lobe-hub2/deploy/lobehub-gateway/docker-compose.gateway-admin.yml)

覆盖到：

```text
/home/admin/lobehub-nginx/docker-compose.gateway-admin.yml
```

## 5. 服务器端重新安装依赖并构建后端

进入：

```bash
cd /home/admin/lobehub-admin/service
```

执行：

```bash
docker run --rm -it -v "$PWD":/app -w /app node:20 npm install
docker run --rm -it -v "$PWD":/app -w /app node:20 npm run build
```

说明：
- 即使后端依赖没有明显变化，也建议执行一次 `npm install`
- 这样可以避免 `package-lock.json` 或间接依赖变化导致容器启动异常

## 6. 重启服务

进入：

```bash
cd /home/admin/lobehub-nginx
```

执行：

```bash
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service nginx-gateway
```

如果只更新了后端，没有改网关配置，也至少执行：

```bash
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service
```

## 7. 升级后验证

先做服务器内验证：

```bash
curl http://127.0.0.1/admin-api/health
curl -I http://127.0.0.1/admin/
curl -I http://127.0.0.1/admin/database-viewer.html
```

再做功能验证：
- 系统管理员可以登录
- 项目管理员可以登录并打开模板配置页
- 切换模板管理员后，模板助手列表会刷新
- 选错模板助手时，保存模板会返回明确业务错误
- 项目成员可以登录并查看自己的 Topic
- 数据查看页“全清空后再单选一列”的列显隐逻辑正常

## 8. 当前版本升级特别提醒

### 8.1 模板配置页

本次升级后：
- 切换模板管理员会清空旧助手选择
- 助手列表加载中时不能保存
- 如果助手不属于当前模板管理员，会直接阻止保存

### 8.2 `rt_fetch` 相关问题

本次已经修复一个可复现路径：
- `GET /api/projects/:projectId/agents`

如果线上旧版的模板配置页之前经常在加载助手时报：

```text
rt_fetch used out-of-bounds
```

升级后应优先验证该问题是否消失。

### 8.3 浏览器缓存

本次网关模板已给以下 HTML 入口加了 `no-cache`：
- `/`
- `/index.html`
- `/admin/index.html`
- `/admin/database-viewer.html`

因此升级后：
- 一般不需要再手工强刷浏览器缓存
- 但前提是你已经同步了新的 `default.conf` 并重启 `nginx-gateway`

## 9. 回滚方式

如果升级后发现异常，可按以下方式回滚：

1. 恢复备份的 `.env`
2. 恢复备份的 `default.conf`
3. 恢复旧版 `service/` 与 `web/` 文件
4. 再执行：

```bash
cd /home/admin/lobehub-nginx
docker compose -f docker-compose.gateway-admin.yml up -d --force-recreate lobehub-admin-service nginx-gateway
```
