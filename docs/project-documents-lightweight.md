# 项目与全局知识文档

## 当前状态

当前 `ali-temp` 已经落地以下知识结构：

- 项目知识域：`lobehub_admin.project_documents`
- 全局知识域：`lobehub_admin.global_documents`
- 项目知识插件：`lobehub-admin.project-knowledge.<project_id>`

这份文档只描述当前已经实现的口径，不再使用旧的“文档同步为 skill 正文”方案。

## 知识域划分

### 项目知识域

表：

- `lobehub_admin.project_documents`

特点：

- 只归属于单个项目
- 由项目管理员维护
- 系统管理员也可维护
- 适合存放：
  - 项目介绍
  - 项目 FAQ
  - 学校 / 学区口径
  - 项目价格口径
  - 项目竞品资料

### 全局知识域

表：

- `lobehub_admin.global_documents`

特点：

- 面向所有项目共享
- 由系统管理员维护
- 项目管理员只读
- 适合存放：
  - 全局学校 / 学区合规口径
  - 全局价格表达原则
  - 全局竞品对比原则
  - 跟进策略
  - 客户判断规则

## 知识地图

每个知识域都建议保留一个 `00-map` 文档：

- 项目知识域：`00-project-knowledge-map`
- 全局知识域：`00-global-knowledge-map`

用途：

- 说明当前知识域有哪些类别
- 说明优先阅读顺序
- 作为轻量路由参考

这层不是硬编码路由表，不需要枚举“每个问题对应哪篇文档”，只负责说明：

- 有哪些类型的知识
- 每类大概在哪些文档里
- 项目知识和全局知识如何配合

## 文档结构

每篇文档保持轻量：

- `title`
- `description`
- `content_md`
- `status`
- `is_entry`
- `sort_order`

当前没有引入重型标签系统。

## 管理端接口

### 项目文档

- `GET /api/projects/:projectId/documents`
- `POST /api/projects/:projectId/documents`
- `GET /api/projects/:projectId/documents/:documentId`
- `PUT /api/projects/:projectId/documents/:documentId`
- `DELETE /api/projects/:projectId/documents/:documentId`
- `POST /api/projects/:projectId/documents/sync-plugin`

### 全局文档

- `GET /api/system/global-documents`
- `POST /api/system/global-documents`
- `GET /api/system/global-documents/:documentId`
- `PUT /api/system/global-documents/:documentId`
- `DELETE /api/system/global-documents/:documentId`

## 实际接入方式

项目助手当前不是通过多个低层知识工具去拼装知识，而是通过一个高层项目知识插件：

- `queryProjectKnowledge`

插件 manifest 当前只暴露这一个工具，避免模型自己拆成：

- `context`
- `search`
- `read`

从而减少绕路和低效搜索。

## 路由原则

当前高层原则：

- 项目助手：
  - 项目知识优先
  - 全局知识补充
- 普通问题：
  - 不优先返回 `00-map`
  - 优先返回正文文档
- 搜索不是默认入口，而是兜底

## 部署影响

当前这套知识系统仍然只改管理端：

- 新增项目知识文档表
- 新增全局知识文档表
- 新增项目知识插件公开接口
- 新增项目知识和全局知识的联合查询逻辑

不涉及：

- 主站 `lobehub` 镜像改造
- 主站聊天链路改造

## 后续建议

后续继续按这个方向演进：

1. 逐步把知识型 skill 迁移到：
   - 项目知识域
   - 全局知识域
2. 保留动作型 skill / tool
3. 继续优化项目 / 全局文档的候选排序
