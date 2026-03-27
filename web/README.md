# Admin Web

独立于 `lobehub` 主应用的管理前端。

## 启动

1. 复制 `.env.example` 为 `.env`
2. 安装依赖
3. 启动开发服务

```bash
npm install
npm run dev
```

默认访问地址：

```bash
http://127.0.0.1:4173
```

默认需要配合独立后端服务一起运行：
- `http://127.0.0.1:3321`

## 生产构建

当前已提供生产环境变量文件：

- `.env.production`
- `.env.production.example`

默认内容：

```env
VITE_PUBLIC_BASE=/admin/
VITE_API_BASE_URL=/admin-api
```

如果构建环境没有显式提供 `VITE_PUBLIC_BASE` / `VITE_API_BASE_URL`，当前生产构建也会默认回退到 `/admin/` 与 `/admin-api`，避免在子路径部署时生成错误的 `/assets/...` 入口。

生产构建命令：

```bash
npm install
npm run build
```

构建产物输出到：

```text
dist/
```
