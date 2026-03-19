# 云端部署说明

这套目录专门给“前端静态托管 + 后端独立容器 + 同站 Nginx 反代”的部署方式使用。

注意：

- 这是“宿主机已有 Nginx 或独立静态托管能力”的方案
- 当前实际线上环境如果没有系统级 Nginx，而是使用 Docker Nginx 网关，请优先参考：
  - `deploy/lobehub-gateway/README.md`

目标：
- 不改动现有本地开发脚本和目录
- 管理端前端作为静态文件发布
- 管理端后端单独打包镜像
- 最终通过同站点路径暴露：
  - `/admin/`
  - `/admin-api/`

## 目录内容

- `web.env.production.example`
  - 前端生产构建环境变量模板
- `service.env.production.example`
  - 后端生产环境变量模板
- `nginx.admin.conf.example`
  - Nginx 路由示例
- `nginx.admin.https.daiworld.com.conf.example`
  - `daiworld.com` / `www.daiworld.com` HTTPS + 旧 IP HTTP 兜底示例
- `release-checklist.md`
  - 上线前检查项

## 建议部署拓扑

- 前端静态文件
  - 构建自 `web/`
  - 上传到现有 Nginx 可访问的静态目录
- 后端服务
  - 构建自 `service/`
  - 打包成单独镜像
  - 仅在 compose 内部暴露端口
- Nginx
  - `location /admin/` 指向静态文件
  - `location /admin-api/` 反代到管理端后端容器

## 当前代码侧已支持的云端能力

- 前端构建基路径可配置
  - 使用 `VITE_PUBLIC_BASE`
- 前端 API 地址可配置
  - 使用 `VITE_API_BASE_URL`
- 后端可感知反向代理
  - 使用 `TRUST_PROXY`
- 后端登录 cookie 可切生产安全模式
  - 使用 `ADMIN_SESSION_SECURE_COOKIE`

## 推荐路径

1. 按本目录模板准备前后端生产环境变量
2. 本地执行前端构建
3. 上传 `web/dist` 到云端静态目录
4. 后端构建镜像并启动容器
5. 在 Nginx 中增加 `/admin/` 与 `/admin-api/` 路由
6. 完成联调后，再统一补 Docker / Compose 文件
