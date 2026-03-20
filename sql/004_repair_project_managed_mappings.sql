BEGIN;

WITH canonical AS (
  SELECT
    pma.id,
    pma.project_id,
    pma.user_id,
    'prj-' || substr(md5(pma.project_id), 1, 20) AS canonical_agent_slug,
    'project-' || substr(md5(pma.project_id || ':' || pma.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_managed_agents pma
),
resolved_agents AS (
  SELECT
    c.id,
    c.canonical_agent_slug,
    COALESCE(
      a_valid.id,
      a_slug.id
    ) AS resolved_agent_id
  FROM canonical c
  LEFT JOIN lobehub_admin.project_managed_agents pma
    ON pma.id = c.id
  LEFT JOIN public.agents a_valid
    ON a_valid.id = pma.managed_agent_id
   AND a_valid.user_id = c.user_id
  LEFT JOIN public.agents a_slug
    ON a_slug.user_id = c.user_id
   AND a_slug.slug = c.canonical_agent_slug
),
resolved_sessions AS (
  SELECT
    c.id,
    c.canonical_session_slug,
    COALESCE(
      s_valid.id,
      s_slug.id
    ) AS resolved_session_id
  FROM canonical c
  LEFT JOIN lobehub_admin.project_managed_agents pma
    ON pma.id = c.id
  LEFT JOIN public.sessions s_valid
    ON s_valid.id = pma.managed_session_id
   AND s_valid.user_id = c.user_id
   AND s_valid.type = 'agent'
  LEFT JOIN public.sessions s_slug
    ON s_slug.user_id = c.user_id
   AND s_slug.slug = c.canonical_session_slug
   AND s_slug.type = 'agent'
)
UPDATE lobehub_admin.project_managed_agents pma
SET managed_agent_id = ra.resolved_agent_id,
    managed_session_id = rs.resolved_session_id,
    managed_agent_slug = ra.canonical_agent_slug,
    managed_session_slug = rs.canonical_session_slug,
    updated_at = now()
FROM resolved_agents ra
JOIN resolved_sessions rs
  ON rs.id = ra.id
WHERE pma.id = ra.id
  AND (
    pma.managed_agent_id IS DISTINCT FROM ra.resolved_agent_id
    OR pma.managed_session_id IS DISTINCT FROM rs.resolved_session_id
    OR pma.managed_agent_slug IS DISTINCT FROM ra.canonical_agent_slug
    OR pma.managed_session_slug IS DISTINCT FROM rs.canonical_session_slug
  );

WITH canonical AS (
  SELECT
    pma.project_id,
    pma.user_id,
    pma.managed_agent_id,
    pma.managed_session_id,
    'prj-' || substr(md5(pma.project_id), 1, 20) AS canonical_agent_slug,
    'project-' || substr(md5(pma.project_id || ':' || pma.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_managed_agents pma
)
UPDATE public.agents a
SET slug = c.canonical_agent_slug,
    pinned = true,
    updated_at = now()
FROM canonical c
WHERE a.id = c.managed_agent_id
  AND a.user_id = c.user_id
  AND a.slug IS DISTINCT FROM c.canonical_agent_slug;

WITH canonical AS (
  SELECT
    pma.project_id,
    pma.user_id,
    pma.managed_session_id,
    'project-' || substr(md5(pma.project_id || ':' || pma.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_managed_agents pma
)
UPDATE public.sessions s
SET slug = c.canonical_session_slug,
    pinned = true,
    updated_at = now()
FROM canonical c
WHERE s.id = c.managed_session_id
  AND s.user_id = c.user_id
  AND s.type = 'agent'
  AND s.slug IS DISTINCT FROM c.canonical_session_slug;

INSERT INTO public.agents_to_sessions (agent_id, session_id, user_id)
SELECT DISTINCT
  pma.managed_agent_id,
  pma.managed_session_id,
  pma.user_id
FROM lobehub_admin.project_managed_agents pma
JOIN public.agents a
  ON a.id = pma.managed_agent_id
 AND a.user_id = pma.user_id
JOIN public.sessions s
  ON s.id = pma.managed_session_id
 AND s.user_id = pma.user_id
 AND s.type = 'agent'
WHERE pma.managed_agent_id IS NOT NULL
  AND pma.managed_session_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
