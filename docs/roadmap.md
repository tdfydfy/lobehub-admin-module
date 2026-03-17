# 开发拆解

## 阶段 1：数据库核心

状态：已完成

目标：
- 完成项目级管理表
- 完成模板与成员管理函数
- 完成项目级助手 provisioning 函数
- 关闭旧的全局自动下发

交付物：
- `001_project_admin_core.sql`
- `002_disable_global_auto_provision.sql`
- 安装脚本

## 阶段 2：独立 API 服务

状态：已完成 MVP

建议技术路线：
- 独立 Node.js 服务
- 直接连接 PostgreSQL
- REST API 或 tRPC 二选一

建议先做 REST：
- `GET /api/system/status`
- `GET /api/users?q=`
- `GET /projects`
- `POST /projects`
- `GET /projects/:id`
- `DELETE /projects/:id`
- `POST /projects/:id/members`
- `DELETE /projects/:id/members/:userId`
- `GET /projects/:id/agents`
- `GET /projects/:id/template`
- `PUT /projects/:id/template`
- `POST /projects/:id/provision`
- `POST /projects/:id/provision/refresh`
- `GET /projects/:id/jobs/:jobId`

## 阶段 3：独立管理前端

状态：已完成 MVP

建议最小页面：
- 项目列表页
- 项目详情页

详情页包含：
- 成员管理
- 助手配置
- 对话统计
- 任务进度
- 数据查看
- 报表

## 阶段 4：报表接入

状态：部分完成

前提：
- 明确业务表真实名称
- 明确用户关联字段
- 明确时间字段

如果未来不是 `crm.customer_profiles`，不要硬编码旧名称。

当前已完成：
- 项目成员运营报表
  - 已接入真实查询
  - 支持成员过滤、时间过滤、分页、导出
- 项目对话统计
  - 已按项目托管会话接入 `topic` 真实查询
  - 支持当日、近三天、近七天、一个月、指定日期范围
  - 支持成员 -> topic 清单 -> 消息详情两级下钻
- 数据查看
  - 系统管理员可查看 `crm` / `lobehub_admin` / `public`
  - 项目管理员可查看 `crm`
  - 项目管理员查看 `crm` 时按 `project` 字段强制过滤

当前仍待完成：
- 面向真实 CRM 业务语义的专用报表
- 更细的业务指标与图表

## 阶段 5：任务异步化

状态：未开始

当前 SQL 已有任务表，但执行仍可先由 API 同步调用。

后续再升级为：
- API 仅创建任务
- Worker 轮询 `pending`
- 分批处理成员
- 前端实时展示进度

## 当前开发决策

当前版本已经完成：
- 独立模块目录
- 架构文档
- 数据库核心 schema
- 安装脚本
- 独立 API 服务
- 项目/成员/模板接口
- 任务状态接口
- 项目成员运营报表
- 项目对话统计与下钻查看
- 数据查看接口
- 前端页面与首页接入
- 基本联调与问题修复

下一阶段优先级：
1. skill 覆盖风险治理
2. CRM 业务专用报表接入
3. 正式鉴权与权限体系
4. 后台 worker 异步执行
