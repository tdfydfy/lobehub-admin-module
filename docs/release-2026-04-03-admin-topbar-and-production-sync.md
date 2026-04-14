# 2026-04-03 Admin Topbar And Production Sync

## Summary

This release focuses on simplifying the admin topbar and removing duplicate project entry points in the system admin workspace.

## Shipped Changes

- The system admin topbar keeps a persistent project card across `project-list`, `project-create`, and `global-docs`.
- The project card can switch the current project directly from the topbar and provides an `Enter Project` action for quick navigation into project detail.
- The duplicate `Project List` block on the system homepage was removed.
- `Portfolio` remains the single project entry surface on the system homepage.

## Deployment Status

- `ali-2c2g` was synced on 2026-04-03 and remains the active deployment target.
- Production now serves:
  - `/admin/assets/main-DpRhrgiX.js`
  - `/admin/assets/styles-Cgb2-UmV.css`

## Rollback Note

- A production static backup was created on `ali-2c2g`:
  - `/tmp/admin-web-backup-2026-04-03-005431.tgz`
