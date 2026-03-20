-- 1) Summary
WITH canonical AS (
  SELECT
    pma.id,
    pma.project_id,
    pma.user_id,
    pma.managed_agent_id,
    pma.managed_session_id,
    pma.managed_agent_slug,
    pma.managed_session_slug,
    'prj-' || substr(md5(pma.project_id), 1, 20) AS canonical_agent_slug,
    'project-' || substr(md5(pma.project_id || ':' || pma.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_managed_agents pma
)
SELECT
  count(*)::int AS total_mappings,
  count(*) FILTER (WHERE managed_agent_id IS NULL)::int AS missing_agent_id,
  count(*) FILTER (WHERE managed_session_id IS NULL)::int AS missing_session_id,
  count(*) FILTER (
    WHERE managed_agent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agents a
        WHERE a.id = canonical.managed_agent_id
          AND a.user_id = canonical.user_id
      )
  )::int AS dangling_agent_id,
  count(*) FILTER (
    WHERE managed_session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.sessions s
        WHERE s.id = canonical.managed_session_id
          AND s.user_id = canonical.user_id
          AND s.type = 'agent'
      )
  )::int AS dangling_session_id,
  count(*) FILTER (
    WHERE managed_agent_slug IS DISTINCT FROM canonical_agent_slug
  )::int AS non_canonical_agent_slug,
  count(*) FILTER (
    WHERE managed_session_slug IS DISTINCT FROM canonical_session_slug
  )::int AS non_canonical_session_slug
FROM canonical;

-- 2) Members without any official mapping
SELECT
  pm.project_id,
  p.name AS project_name,
  pm.user_id,
  lobehub_admin.user_display_name(pm.user_id) AS display_name,
  u.email
FROM lobehub_admin.project_members pm
JOIN lobehub_admin.projects p
  ON p.id = pm.project_id
JOIN public.users u
  ON u.id = pm.user_id
LEFT JOIN lobehub_admin.project_managed_agents pma
  ON pma.project_id = pm.project_id
 AND pma.user_id = pm.user_id
WHERE pm.role = 'member'
  AND pma.id IS NULL
ORDER BY p.name ASC, pm.joined_at ASC
LIMIT 100;

-- 3) Mappings that need repair
WITH canonical AS (
  SELECT
    pma.id,
    pma.project_id,
    p.name AS project_name,
    pma.user_id,
    lobehub_admin.user_display_name(pma.user_id) AS display_name,
    u.email,
    pma.managed_agent_id,
    pma.managed_session_id,
    pma.managed_agent_slug,
    pma.managed_session_slug,
    'prj-' || substr(md5(pma.project_id), 1, 20) AS canonical_agent_slug,
    'project-' || substr(md5(pma.project_id || ':' || pma.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_managed_agents pma
  JOIN lobehub_admin.projects p
    ON p.id = pma.project_id
  JOIN public.users u
    ON u.id = pma.user_id
)
SELECT
  canonical.project_id,
  canonical.project_name,
  canonical.user_id,
  canonical.display_name,
  canonical.email,
  canonical.managed_agent_id,
  canonical.managed_session_id,
  canonical.managed_agent_slug,
  canonical.canonical_agent_slug,
  canonical.managed_session_slug,
  canonical.canonical_session_slug,
  CASE
    WHEN canonical.managed_agent_id IS NULL THEN 'missing_agent_id'
    WHEN canonical.managed_session_id IS NULL THEN 'missing_session_id'
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.agents a
      WHERE a.id = canonical.managed_agent_id
        AND a.user_id = canonical.user_id
    ) THEN 'dangling_agent_id'
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = canonical.managed_session_id
        AND s.user_id = canonical.user_id
        AND s.type = 'agent'
    ) THEN 'dangling_session_id'
    WHEN canonical.managed_agent_slug IS DISTINCT FROM canonical.canonical_agent_slug THEN 'non_canonical_agent_slug'
    WHEN canonical.managed_session_slug IS DISTINCT FROM canonical.canonical_session_slug THEN 'non_canonical_session_slug'
    ELSE 'ok'
  END AS primary_issue
FROM canonical
WHERE canonical.managed_agent_id IS NULL
   OR canonical.managed_session_id IS NULL
   OR canonical.managed_agent_slug IS DISTINCT FROM canonical.canonical_agent_slug
   OR canonical.managed_session_slug IS DISTINCT FROM canonical.canonical_session_slug
   OR NOT EXISTS (
     SELECT 1
     FROM public.agents a
     WHERE a.id = canonical.managed_agent_id
       AND a.user_id = canonical.user_id
   )
   OR NOT EXISTS (
     SELECT 1
     FROM public.sessions s
     WHERE s.id = canonical.managed_session_id
       AND s.user_id = canonical.user_id
       AND s.type = 'agent'
   )
ORDER BY canonical.project_name ASC, canonical.display_name ASC
LIMIT 100;

-- 4) Existing official-looking objects by canonical slug
WITH member_base AS (
  SELECT
    pm.project_id,
    p.name AS project_name,
    pm.user_id,
    lobehub_admin.user_display_name(pm.user_id) AS display_name,
    'prj-' || substr(md5(pm.project_id), 1, 20) AS canonical_agent_slug,
    'project-' || substr(md5(pm.project_id || ':' || pm.user_id), 1, 20) AS canonical_session_slug
  FROM lobehub_admin.project_members pm
  JOIN lobehub_admin.projects p
    ON p.id = pm.project_id
  WHERE pm.role = 'member'
)
SELECT
  mb.project_id,
  mb.project_name,
  mb.user_id,
  mb.display_name,
  (
    SELECT count(*)::int
    FROM public.agents a
    WHERE a.user_id = mb.user_id
      AND a.slug = mb.canonical_agent_slug
  ) AS canonical_agent_count,
  (
    SELECT count(*)::int
    FROM public.sessions s
    WHERE s.user_id = mb.user_id
      AND s.slug = mb.canonical_session_slug
      AND s.type = 'agent'
  ) AS canonical_session_count
FROM member_base mb
WHERE (
  SELECT count(*)::int
  FROM public.agents a
  WHERE a.user_id = mb.user_id
    AND a.slug = mb.canonical_agent_slug
) > 1
   OR (
  SELECT count(*)::int
  FROM public.sessions s
  WHERE s.user_id = mb.user_id
    AND s.slug = mb.canonical_session_slug
    AND s.type = 'agent'
) > 1
ORDER BY mb.project_name ASC, mb.display_name ASC
LIMIT 100;
