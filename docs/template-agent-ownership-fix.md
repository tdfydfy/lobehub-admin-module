# Template Agent Ownership Fix

Date: 2026-03-18

## Problem

- After switching the template admin, the frontend could keep the previously selected template agent.
- The template agent list is loaded asynchronously, so an earlier response could briefly leave stale state on screen.
- Saving the template only checked that `templateUserId` and `templateAgentId` were non-empty, not that they still belonged together.
- The database function `lobehub_admin.set_project_template(...)` would eventually reject the mismatch, but the API error was not friendly enough.

## Fix

- Keep the database ownership validation unchanged.
- When the template admin changes, clear the current template agent selection and reload the agent list.
- Do not allow template save while the agent list is still loading.
- Before save, verify that the selected agent still exists in the current admin's agent list.
- Add a backend ownership check so the API returns a clearer business error before the raw SQL message leaks through.

## Related Runtime Fix

During the same sync, the admin agent list query was also adjusted to avoid a reproducible:

```text
rt_fetch used out-of-bounds
```

path on:

- `GET /api/projects/:projectId/agents`
