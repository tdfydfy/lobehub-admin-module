# Template Agent Ownership Fix

Date: 2026-03-18

## Problem

- After switching the template admin, the frontend kept the previously selected template agent.
- The agent list is loaded asynchronously, so an older response could briefly leave stale state on screen.
- Saving the template only checked that `templateUserId` and `templateAgentId` were non-empty, not that they belonged to the same user.
- The database function `lobehub_admin.set_project_template(...)` correctly rejected the mismatch and raised `Template agent ... does not belong to template user ...`.

## Fix

- Keep the database ownership validation unchanged.
- When the template admin changes, clear the current agent selection and reload the agent list for the new admin.
- Disable or block template save while the agent list is still loading.
- Before save, verify that the selected agent still exists in the current admin's agent list.
- Add a backend ownership check so the API returns a clearer business error before the raw SQL error leaks through.
