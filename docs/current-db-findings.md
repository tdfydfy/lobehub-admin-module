# 当前数据库现状

更新时间：2026-03-14

## 已确认

- 当前运行中的服务名是 `lobehub`
- PostgreSQL 已运行，数据库名为 `lobehub`
- 旧的全局自动下发表与触发器对象仍存在，但已不再生效：
  - 表：`public.system_provisioning_config`
  - 触发器：`public.users` 上的 `trg_provision_on_user_insert`
- 当前数据库里还没有 `crm` schema
- 当前数据库已安装 `lobehub_admin` schema

## 已安装对象

- `lobehub_admin.projects`
- `lobehub_admin.project_members`
- `lobehub_admin.project_templates`
- `lobehub_admin.project_managed_agents`
- `lobehub_admin.provision_jobs`
- `lobehub_admin.provision_job_items`
- `lobehub_admin.system_admins`

## 已验证

- `create_project(...)`
- `add_project_members_by_email(...)`
- `set_project_template(...)`
- `run_project_provision_job(...)`
- 更换模板后执行 `refresh`

以上函数已做过事务级烟测，并成功回滚。

## 已执行

- `002_disable_global_auto_provision.sql`

当前状态：
- `public.system_provisioning_config.enabled = false`
- `public.users` 上的 `trg_provision_on_user_insert` 已被禁用
- 当前项目级刷新逻辑已修复 `agents_pkey` 冲突
