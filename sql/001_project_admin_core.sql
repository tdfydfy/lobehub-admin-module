BEGIN;

CREATE SCHEMA IF NOT EXISTS lobehub_admin;

CREATE OR REPLACE FUNCTION lobehub_admin.gen_id(p_prefix text)
RETURNS text
LANGUAGE sql
AS $$
  SELECT p_prefix || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
$$;

CREATE TABLE IF NOT EXISTS lobehub_admin.system_admins (
  user_id text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobehub_admin.projects (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('prj_'),
  name text NOT NULL UNIQUE,
  description text,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_members (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('pm_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_project_members_project
  ON lobehub_admin.project_members(project_id);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_project_members_user
  ON lobehub_admin.project_members(user_id);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_templates (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('pt_'),
  project_id text NOT NULL UNIQUE REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  template_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  template_agent_id text REFERENCES public.agents(id) ON DELETE SET NULL,
  copy_skills boolean NOT NULL DEFAULT true,
  updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_managed_agents (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('pma_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  template_agent_id text REFERENCES public.agents(id) ON DELETE SET NULL,
  managed_agent_id text REFERENCES public.agents(id) ON DELETE CASCADE,
  managed_session_id text REFERENCES public.sessions(id) ON DELETE SET NULL,
  managed_agent_slug text,
  managed_session_slug text,
  last_job_id text,
  last_status text NOT NULL DEFAULT 'provisioned' CHECK (last_status IN ('provisioned', 'failed', 'skipped')),
  last_message text,
  provisioned_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_managed_agents_project
  ON lobehub_admin.project_managed_agents(project_id);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_managed_agents_user
  ON lobehub_admin.project_managed_agents(user_id);

CREATE TABLE IF NOT EXISTS lobehub_admin.provision_jobs (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('job_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('configure', 'refresh')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'partial', 'failed')),
  template_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  template_agent_id text REFERENCES public.agents(id) ON DELETE SET NULL,
  copy_skills boolean NOT NULL DEFAULT true,
  set_default_agent boolean NOT NULL DEFAULT false,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  error_message text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_provision_jobs_project
  ON lobehub_admin.provision_jobs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lobehub_admin.provision_job_items (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('jbi_'),
  job_id text NOT NULL REFERENCES lobehub_admin.provision_jobs(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped')),
  message text,
  managed_agent_id text REFERENCES public.agents(id) ON DELETE SET NULL,
  managed_session_id text REFERENCES public.sessions(id) ON DELETE SET NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (job_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_job_items_job
  ON lobehub_admin.provision_job_items(job_id);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_daily_report_settings (
  project_id text PRIMARY KEY REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Asia/Shanghai',
  business_day_close_time_local time NOT NULL DEFAULT time '22:00:00',
  prompt_template text NOT NULL DEFAULT '',
  generate_when_no_visit boolean NOT NULL DEFAULT true,
  model_provider_override text CHECK (model_provider_override IN ('volcengine', 'fallback')),
  model_name_override text,
  updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobehub_admin.daily_report_jobs (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('drj_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  trigger_source text NOT NULL CHECK (trigger_source IN ('scheduled', 'manual', 'retry')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  timezone text NOT NULL,
  close_time_local time NOT NULL,
  generate_when_no_visit boolean NOT NULL DEFAULT true,
  window_start_at timestamp with time zone NOT NULL,
  window_end_at timestamp with time zone NOT NULL,
  prompt_snapshot text NOT NULL,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  report_id text,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  error_message text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_daily_report_jobs_project
  ON lobehub_admin.daily_report_jobs(project_id, business_date DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobehub_admin_daily_report_jobs_active
  ON lobehub_admin.daily_report_jobs(project_id, business_date)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS lobehub_admin.project_daily_reports (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('drr_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  is_current boolean NOT NULL DEFAULT true,
  job_id text REFERENCES lobehub_admin.daily_report_jobs(id) ON DELETE SET NULL,
  timezone text NOT NULL,
  window_start_at timestamp with time zone NOT NULL,
  window_end_at timestamp with time zone NOT NULL,
  visited_customer_count integer NOT NULL DEFAULT 0,
  active_topic_count integer NOT NULL DEFAULT 0,
  total_message_count integer NOT NULL DEFAULT 0,
  user_message_count integer NOT NULL DEFAULT 0,
  assistant_message_count integer NOT NULL DEFAULT 0,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_markdown text NOT NULL DEFAULT '',
  prompt_snapshot text NOT NULL DEFAULT '',
  system_prompt_version text NOT NULL DEFAULT 'daily-report-v1',
  model_provider text NOT NULL DEFAULT 'fallback',
  model_name text NOT NULL DEFAULT 'built-in-fallback',
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, business_date, revision)
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_project_daily_reports_project
  ON lobehub_admin.project_daily_reports(project_id, business_date DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobehub_admin_project_daily_reports_current
  ON lobehub_admin.project_daily_reports(project_id, business_date)
  WHERE is_current;

CREATE TABLE IF NOT EXISTS lobehub_admin.project_customer_analysis_sessions (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('cas_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '新会话',
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_customer_analysis_sessions_project
  ON lobehub_admin.project_customer_analysis_sessions(project_id, updated_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_customer_analysis_messages (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('cam_'),
  session_id text NOT NULL REFERENCES lobehub_admin.project_customer_analysis_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  range_preset text CHECK (range_preset IN ('today', 'last7days', 'last30days', 'custom')),
  date_from date,
  date_to date,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  model_provider text,
  model_name text,
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_customer_analysis_messages_session
  ON lobehub_admin.project_customer_analysis_messages(session_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS lobehub_admin.project_customer_analysis_jobs (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('caj_'),
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES lobehub_admin.project_customer_analysis_sessions(id) ON DELETE CASCADE,
  user_message_id text NOT NULL REFERENCES lobehub_admin.project_customer_analysis_messages(id) ON DELETE CASCADE,
  assistant_message_id text REFERENCES lobehub_admin.project_customer_analysis_messages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  range_preset text NOT NULL CHECK (range_preset IN ('today', 'last7days', 'last30days', 'custom')),
  date_from date NOT NULL,
  date_to date NOT NULL,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  model_provider text,
  model_name text,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  error_message text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_customer_analysis_jobs_project
  ON lobehub_admin.project_customer_analysis_jobs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_customer_analysis_jobs_session
  ON lobehub_admin.project_customer_analysis_jobs(session_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lobehub_admin_customer_analysis_jobs_active
  ON lobehub_admin.project_customer_analysis_jobs(session_id)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION lobehub_admin.user_display_name(p_user_id text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(btrim(u.full_name), ''),
    NULLIF(
      btrim(
        concat_ws(' ', NULLIF(btrim(u.first_name), ''), NULLIF(btrim(u.last_name), ''))
      ),
      ''
    ),
    NULLIF(btrim(u.username), ''),
    NULLIF(btrim(u.email), ''),
    p_user_id
  )
  FROM public.users u
  WHERE u.id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION lobehub_admin.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_updated_at_projects ON lobehub_admin.projects;
CREATE TRIGGER trg_touch_updated_at_projects
BEFORE UPDATE ON lobehub_admin.projects
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_project_templates ON lobehub_admin.project_templates;
CREATE TRIGGER trg_touch_updated_at_project_templates
BEFORE UPDATE ON lobehub_admin.project_templates
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_project_managed_agents ON lobehub_admin.project_managed_agents;
CREATE TRIGGER trg_touch_updated_at_project_managed_agents
BEFORE UPDATE ON lobehub_admin.project_managed_agents
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_provision_jobs ON lobehub_admin.provision_jobs;
CREATE TRIGGER trg_touch_updated_at_provision_jobs
BEFORE UPDATE ON lobehub_admin.provision_jobs
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_provision_job_items ON lobehub_admin.provision_job_items;
CREATE TRIGGER trg_touch_updated_at_provision_job_items
BEFORE UPDATE ON lobehub_admin.provision_job_items
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_project_daily_report_settings ON lobehub_admin.project_daily_report_settings;
CREATE TRIGGER trg_touch_updated_at_project_daily_report_settings
BEFORE UPDATE ON lobehub_admin.project_daily_report_settings
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_daily_report_jobs ON lobehub_admin.daily_report_jobs;
CREATE TRIGGER trg_touch_updated_at_daily_report_jobs
BEFORE UPDATE ON lobehub_admin.daily_report_jobs
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_project_daily_reports ON lobehub_admin.project_daily_reports;
CREATE TRIGGER trg_touch_updated_at_project_daily_reports
BEFORE UPDATE ON lobehub_admin.project_daily_reports
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_customer_analysis_sessions ON lobehub_admin.project_customer_analysis_sessions;
CREATE TRIGGER trg_touch_updated_at_customer_analysis_sessions
BEFORE UPDATE ON lobehub_admin.project_customer_analysis_sessions
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_customer_analysis_messages ON lobehub_admin.project_customer_analysis_messages;
CREATE TRIGGER trg_touch_updated_at_customer_analysis_messages
BEFORE UPDATE ON lobehub_admin.project_customer_analysis_messages
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at_customer_analysis_jobs ON lobehub_admin.project_customer_analysis_jobs;
CREATE TRIGGER trg_touch_updated_at_customer_analysis_jobs
BEFORE UPDATE ON lobehub_admin.project_customer_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

CREATE OR REPLACE FUNCTION lobehub_admin.create_project(
  p_name text,
  p_description text DEFAULT NULL,
  p_created_by text DEFAULT NULL,
  p_admin_user_ids text[] DEFAULT ARRAY[]::text[]
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_id text;
  v_admin_user_id text;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Project name is required';
  END IF;

  INSERT INTO lobehub_admin.projects (name, description, created_by)
  VALUES (btrim(p_name), p_description, p_created_by)
  RETURNING id INTO v_project_id;

  FOREACH v_admin_user_id IN ARRAY p_admin_user_ids
  LOOP
    IF v_admin_user_id IS NULL OR btrim(v_admin_user_id) = '' THEN
      CONTINUE;
    END IF;

    INSERT INTO lobehub_admin.project_members (project_id, user_id, role)
    VALUES (v_project_id, v_admin_user_id, 'admin')
    ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'admin';
  END LOOP;

  RETURN v_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION lobehub_admin.add_project_members_by_email(
  p_project_id text,
  p_emails text[],
  p_role text DEFAULT 'member'
)
RETURNS TABLE (
  email text,
  user_id text,
  status text,
  message text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_email text;
  v_user_id text;
BEGIN
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  FOREACH v_email IN ARRAY p_emails
  LOOP
    v_email := lower(btrim(v_email));

    IF v_email IS NULL OR v_email = '' THEN
      CONTINUE;
    END IF;

    SELECT u.id INTO v_user_id
    FROM public.users u
    WHERE lower(u.email) = v_email
    LIMIT 1;

    IF v_user_id IS NULL THEN
      email := v_email;
      user_id := NULL;
      status := 'not_found';
      message := 'User not registered';
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO lobehub_admin.project_members (project_id, user_id, role)
      VALUES (p_project_id, v_user_id, p_role);

      email := v_email;
      user_id := v_user_id;
      status := 'added';
      message := 'Member added';
      RETURN NEXT;
    EXCEPTION
      WHEN unique_violation THEN
        UPDATE lobehub_admin.project_members
        SET role = p_role
        WHERE project_id = p_project_id
          AND user_id = v_user_id;

        email := v_email;
        user_id := v_user_id;
        status := 'updated';
        message := 'Existing member role updated';
        RETURN NEXT;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION lobehub_admin.set_project_template(
  p_project_id text,
  p_template_user_id text,
  p_template_agent_id text,
  p_copy_skills boolean DEFAULT true,
  p_updated_by text DEFAULT NULL
)
RETURNS TABLE (
  project_id text,
  template_user_id text,
  template_agent_id text,
  template_agent_title text,
  template_skill_count integer,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_admin boolean;
  v_agent_title text;
  v_skill_count integer;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM lobehub_admin.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = p_template_user_id
      AND pm.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Template user must be a project admin';
  END IF;

  SELECT a.title INTO v_agent_title
  FROM public.agents a
  WHERE a.id = p_template_agent_id
    AND a.user_id = p_template_user_id
  LIMIT 1;

  IF v_agent_title IS NULL THEN
    RAISE EXCEPTION 'Template agent % does not belong to template user %', p_template_agent_id, p_template_user_id;
  END IF;

  SELECT count(*)::int INTO v_skill_count
  FROM public.agent_skills s
  WHERE s.user_id = p_template_user_id;

  INSERT INTO lobehub_admin.project_templates (
    project_id,
    template_user_id,
    template_agent_id,
    copy_skills,
    updated_by,
    updated_at
  )
  VALUES (
    p_project_id,
    p_template_user_id,
    p_template_agent_id,
    COALESCE(p_copy_skills, true),
    p_updated_by,
    now()
  )
  ON CONFLICT ON CONSTRAINT project_templates_project_id_key DO UPDATE
  SET template_user_id = EXCLUDED.template_user_id,
      template_agent_id = EXCLUDED.template_agent_id,
      copy_skills = EXCLUDED.copy_skills,
      updated_by = EXCLUDED.updated_by,
      updated_at = now();

  RETURN QUERY
  SELECT
    p_project_id,
    p_template_user_id,
    p_template_agent_id,
    v_agent_title,
    v_skill_count,
    now();
END;
$$;

CREATE OR REPLACE FUNCTION lobehub_admin.provision_project_member(
  p_project_id text,
  p_target_user_id text,
  p_template_user_id text,
  p_template_agent_id text,
  p_copy_skills boolean DEFAULT true,
  p_force_refresh boolean DEFAULT false,
  p_set_default_agent boolean DEFAULT false,
  p_job_id text DEFAULT NULL
)
RETURNS TABLE (
  status text,
  message text,
  managed_agent_id text,
  managed_session_id text,
  copied_skill_count integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  tpl_agent public.agents%ROWTYPE;
  existing_map lobehub_admin.project_managed_agents%ROWTYPE;
  v_agent_slug text;
  v_session_slug text;
  v_managed_agent_id text;
  v_managed_session_id text;
  v_default_agent jsonb;
  v_copied_skill_count integer := 0;
BEGIN
  IF p_project_id IS NULL OR p_target_user_id IS NULL OR p_template_user_id IS NULL OR p_template_agent_id IS NULL THEN
    RAISE EXCEPTION 'project_id, target_user_id, template_user_id, template_agent_id are required';
  END IF;

  IF p_target_user_id = p_template_user_id THEN
    status := 'skipped';
    message := 'Template user skipped';
    managed_agent_id := NULL;
    managed_session_id := NULL;
    copied_skill_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO tpl_agent
  FROM public.agents a
  WHERE a.id = p_template_agent_id
    AND a.user_id = p_template_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template agent not found for template user';
  END IF;

  SELECT * INTO existing_map
  FROM lobehub_admin.project_managed_agents pma
  WHERE pma.project_id = p_project_id
    AND pma.user_id = p_target_user_id
  LIMIT 1;

  IF FOUND
     AND NOT p_force_refresh
     AND existing_map.template_user_id = p_template_user_id
     AND existing_map.template_agent_id = p_template_agent_id
     AND existing_map.managed_agent_id IS NOT NULL
     AND existing_map.managed_session_id IS NOT NULL THEN
    status := 'skipped';
    message := 'Already provisioned with current template';
    managed_agent_id := existing_map.managed_agent_id;
    managed_session_id := existing_map.managed_session_id;
    copied_skill_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Keep managed agent/session identity stable per project+user.
  -- Template changes should update the same managed records, not create new ones.
  v_agent_slug := 'prj-' || substr(md5(p_project_id), 1, 20);
  v_session_slug := 'project-' || substr(md5(p_project_id || ':' || p_target_user_id), 1, 20);

  IF COALESCE(p_copy_skills, true) THEN
    INSERT INTO public.agent_skills (
      id, name, description, identifier, source, manifest, content, editor_data,
      resources, zip_file_hash, user_id, accessed_at, created_at, updated_at
    )
    SELECT
      'skl_' || substr(md5(p_target_user_id || ':' || p_project_id || ':' || s.id), 1, 12),
      s.name, s.description, s.identifier, s.source, s.manifest, s.content, s.editor_data,
      s.resources, s.zip_file_hash, p_target_user_id, now(), now(), now()
    FROM public.agent_skills s
    WHERE s.user_id = p_template_user_id
    ON CONFLICT (user_id, name) DO UPDATE
      SET description   = EXCLUDED.description,
          identifier    = EXCLUDED.identifier,
          source        = EXCLUDED.source,
          manifest      = EXCLUDED.manifest,
          content       = EXCLUDED.content,
          editor_data   = EXCLUDED.editor_data,
          resources     = EXCLUDED.resources,
          zip_file_hash = EXCLUDED.zip_file_hash,
          updated_at    = now();

    SELECT count(*)::int INTO v_copied_skill_count
    FROM public.agent_skills s
    WHERE s.user_id = p_template_user_id;
  END IF;

  -- Official assistant identity is fixed by (project_id, user_id).
  -- Prefer the stored mapping; if missing, absorb the legacy managed slug; otherwise create the fixed official assistant.
  v_managed_agent_id := existing_map.managed_agent_id;

  IF v_managed_agent_id IS NULL THEN
    SELECT a.id INTO v_managed_agent_id
    FROM public.agents a
    WHERE a.user_id = p_target_user_id
      AND a.slug = v_agent_slug
    LIMIT 1;
  END IF;

  IF v_managed_agent_id IS NULL THEN
    v_managed_agent_id := 'agt_' || substr(md5(p_target_user_id || ':' || p_project_id || ':managed'), 1, 12);
  END IF;

  INSERT INTO public.agents (
    id, slug, title, description, tags, avatar, background_color, plugins, user_id,
    chat_config, few_shots, model, params, provider, system_role, tts,
    created_at, updated_at, accessed_at, client_id, opening_message, opening_questions,
    virtual, market_identifier, editor_data, pinned, session_group_id, agency_config
  )
  VALUES (
    v_managed_agent_id,
    v_agent_slug,
    tpl_agent.title,
    tpl_agent.description,
    tpl_agent.tags,
    tpl_agent.avatar,
    tpl_agent.background_color,
    tpl_agent.plugins,
    p_target_user_id,
    tpl_agent.chat_config,
    tpl_agent.few_shots,
    tpl_agent.model,
    tpl_agent.params,
    tpl_agent.provider,
    tpl_agent.system_role,
    tpl_agent.tts,
    now(),
    now(),
    now(),
    NULL,
    tpl_agent.opening_message,
    tpl_agent.opening_questions,
    tpl_agent.virtual,
    tpl_agent.market_identifier,
    tpl_agent.editor_data,
    true,
    NULL,
    tpl_agent.agency_config
  )
  ON CONFLICT (id) DO UPDATE
    SET slug              = EXCLUDED.slug,
        title             = EXCLUDED.title,
        description       = EXCLUDED.description,
        tags              = EXCLUDED.tags,
        avatar            = EXCLUDED.avatar,
        background_color  = EXCLUDED.background_color,
        plugins           = EXCLUDED.plugins,
        chat_config       = EXCLUDED.chat_config,
        few_shots         = EXCLUDED.few_shots,
        model             = EXCLUDED.model,
        params            = EXCLUDED.params,
        provider          = EXCLUDED.provider,
        system_role       = EXCLUDED.system_role,
        tts               = EXCLUDED.tts,
        updated_at        = now(),
        accessed_at       = now(),
        opening_message   = EXCLUDED.opening_message,
        opening_questions = EXCLUDED.opening_questions,
        virtual           = EXCLUDED.virtual,
        market_identifier = EXCLUDED.market_identifier,
        editor_data       = EXCLUDED.editor_data,
        pinned            = true,
        agency_config     = EXCLUDED.agency_config
  WHERE public.agents.user_id = p_target_user_id
  RETURNING id INTO v_managed_agent_id;

  IF v_managed_agent_id IS NULL THEN
    RAISE EXCEPTION 'Managed agent id conflict for target user';
  END IF;

  v_managed_session_id := existing_map.managed_session_id;

  IF v_managed_session_id IS NULL THEN
    SELECT s.id INTO v_managed_session_id
    FROM public.sessions s
    WHERE s.user_id = p_target_user_id
      AND s.slug = v_session_slug
      AND s.type = 'agent'
    LIMIT 1;
  END IF;

  IF v_managed_session_id IS NULL THEN
    v_managed_session_id := 'ssn_' || substr(md5(p_target_user_id || ':' || p_project_id || ':managed'), 1, 12);
  END IF;

  INSERT INTO public.sessions (
    id, slug, title, description, avatar, background_color, type, user_id,
    group_id, pinned, created_at, updated_at, client_id, accessed_at
  )
  VALUES (
    v_managed_session_id,
    v_session_slug,
    tpl_agent.title,
    'Managed by project ' || p_project_id,
    tpl_agent.avatar,
    tpl_agent.background_color,
    'agent',
    p_target_user_id,
    NULL,
    true,
    now(),
    now(),
    NULL,
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET slug = EXCLUDED.slug,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        avatar = EXCLUDED.avatar,
        background_color = EXCLUDED.background_color,
        pinned = true,
        updated_at = now(),
        accessed_at = now()
  WHERE public.sessions.user_id = p_target_user_id
    AND public.sessions.type = 'agent'
  RETURNING id INTO v_managed_session_id;

  IF v_managed_session_id IS NULL THEN
    RAISE EXCEPTION 'Managed session id conflict for target user';
  END IF;

  INSERT INTO public.agents_to_sessions (agent_id, session_id, user_id)
  VALUES (v_managed_agent_id, v_managed_session_id, p_target_user_id)
  ON CONFLICT DO NOTHING;

  IF COALESCE(p_set_default_agent, false) THEN
    SELECT us.default_agent INTO v_default_agent
    FROM public.user_settings us
    WHERE us.id = p_target_user_id
    LIMIT 1;

    IF v_default_agent IS NULL THEN
      INSERT INTO public.user_settings (id, default_agent)
      VALUES (
        p_target_user_id,
        jsonb_build_object('id', v_managed_agent_id, 'slug', v_agent_slug, 'title', tpl_agent.title)
      )
      ON CONFLICT (id) DO UPDATE
        SET default_agent = COALESCE(
          public.user_settings.default_agent,
          EXCLUDED.default_agent
        );
    END IF;
  END IF;

  INSERT INTO lobehub_admin.project_managed_agents (
    project_id,
    user_id,
    template_user_id,
    template_agent_id,
    managed_agent_id,
    managed_session_id,
    managed_agent_slug,
    managed_session_slug,
    last_job_id,
    last_status,
    last_message,
    provisioned_at,
    created_at,
    updated_at
  )
  VALUES (
    p_project_id,
    p_target_user_id,
    p_template_user_id,
    p_template_agent_id,
    v_managed_agent_id,
    v_managed_session_id,
    v_agent_slug,
    v_session_slug,
    p_job_id,
    'provisioned',
    'Provisioned successfully',
    now(),
    now(),
    now()
  )
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET template_user_id = EXCLUDED.template_user_id,
        template_agent_id = EXCLUDED.template_agent_id,
        managed_agent_id = EXCLUDED.managed_agent_id,
        managed_session_id = EXCLUDED.managed_session_id,
        managed_agent_slug = EXCLUDED.managed_agent_slug,
        managed_session_slug = EXCLUDED.managed_session_slug,
        last_job_id = EXCLUDED.last_job_id,
        last_status = EXCLUDED.last_status,
        last_message = EXCLUDED.last_message,
        provisioned_at = EXCLUDED.provisioned_at,
        updated_at = now();

  status := 'success';
  message := 'Provisioned successfully';
  managed_agent_id := v_managed_agent_id;
  managed_session_id := v_managed_session_id;
  copied_skill_count := v_copied_skill_count;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION lobehub_admin.run_project_provision_job(
  p_project_id text,
  p_job_type text DEFAULT 'configure',
  p_created_by text DEFAULT NULL,
  p_force_refresh boolean DEFAULT false,
  p_set_default_agent boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_id text;
  v_template lobehub_admin.project_templates%ROWTYPE;
  member_record record;
  result_record record;
  v_total integer := 0;
  v_success integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
  v_final_status text := 'completed';
BEGIN
  IF p_job_type NOT IN ('configure', 'refresh') THEN
    RAISE EXCEPTION 'Invalid job_type: %', p_job_type;
  END IF;

  SELECT * INTO v_template
  FROM lobehub_admin.project_templates pt
  WHERE pt.project_id = p_project_id
  LIMIT 1;

  IF NOT FOUND OR v_template.template_user_id IS NULL OR v_template.template_agent_id IS NULL THEN
    RAISE EXCEPTION 'Project template is not configured';
  END IF;

  INSERT INTO lobehub_admin.provision_jobs (
    project_id,
    job_type,
    status,
    template_user_id,
    template_agent_id,
    copy_skills,
    set_default_agent,
    created_by,
    started_at
  )
  VALUES (
    p_project_id,
    p_job_type,
    'running',
    v_template.template_user_id,
    v_template.template_agent_id,
    v_template.copy_skills,
    p_set_default_agent,
    p_created_by,
    now()
  )
  RETURNING id INTO v_job_id;

  FOR member_record IN
    SELECT pm.user_id
    FROM lobehub_admin.project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.role = 'member'
    ORDER BY pm.joined_at ASC
  LOOP
    v_total := v_total + 1;

    INSERT INTO lobehub_admin.provision_job_items (job_id, user_id, status, started_at)
    VALUES (v_job_id, member_record.user_id, 'running', now())
    ON CONFLICT (job_id, user_id) DO UPDATE
      SET status = 'running',
          started_at = now(),
          updated_at = now();

    BEGIN
      SELECT * INTO result_record
      FROM lobehub_admin.provision_project_member(
        p_project_id,
        member_record.user_id,
        v_template.template_user_id,
        v_template.template_agent_id,
        v_template.copy_skills,
        COALESCE(p_force_refresh, false) OR p_job_type = 'refresh',
        p_set_default_agent,
        v_job_id
      );

      UPDATE lobehub_admin.provision_job_items
      SET status = CASE result_record.status
                     WHEN 'success' THEN 'success'
                     WHEN 'skipped' THEN 'skipped'
                     ELSE 'failed'
                   END,
          message = result_record.message,
          managed_agent_id = result_record.managed_agent_id,
          managed_session_id = result_record.managed_session_id,
          finished_at = now(),
          updated_at = now()
      WHERE job_id = v_job_id
        AND user_id = member_record.user_id;

      IF result_record.status = 'success' THEN
        v_success := v_success + 1;
      ELSIF result_record.status = 'skipped' THEN
        v_skipped := v_skipped + 1;
      ELSE
        v_failed := v_failed + 1;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed := v_failed + 1;

        UPDATE lobehub_admin.provision_job_items
        SET status = 'failed',
            message = SQLERRM,
            finished_at = now(),
            updated_at = now()
        WHERE job_id = v_job_id
          AND user_id = member_record.user_id;

        INSERT INTO lobehub_admin.project_managed_agents (
          project_id,
          user_id,
          template_user_id,
          template_agent_id,
          last_job_id,
          last_status,
          last_message,
          updated_at
        )
        VALUES (
          p_project_id,
          member_record.user_id,
          v_template.template_user_id,
          v_template.template_agent_id,
          v_job_id,
          'failed',
          SQLERRM,
          now()
        )
        ON CONFLICT (project_id, user_id) DO UPDATE
          SET last_job_id = EXCLUDED.last_job_id,
              last_status = EXCLUDED.last_status,
              last_message = EXCLUDED.last_message,
              updated_at = now();
    END;
  END LOOP;

  IF v_total = 0 THEN
    v_final_status := 'completed';
  ELSIF v_failed = 0 THEN
    v_final_status := 'completed';
  ELSIF v_success > 0 OR v_skipped > 0 THEN
    v_final_status := 'partial';
  ELSE
    v_final_status := 'failed';
  END IF;

  UPDATE lobehub_admin.provision_jobs
  SET status = v_final_status,
      total_count = v_total,
      success_count = v_success,
      failed_count = v_failed,
      skipped_count = v_skipped,
      finished_at = now(),
      updated_at = now()
  WHERE id = v_job_id;

  RETURN v_job_id;
EXCEPTION
  WHEN OTHERS THEN
    IF v_job_id IS NOT NULL THEN
      UPDATE lobehub_admin.provision_jobs
      SET status = 'failed',
          error_message = SQLERRM,
          total_count = v_total,
          success_count = v_success,
          failed_count = v_failed,
          skipped_count = v_skipped,
          finished_at = now(),
          updated_at = now()
      WHERE id = v_job_id;
    END IF;

    RAISE;
END;
$$;

CREATE OR REPLACE VIEW lobehub_admin.project_members_view AS
SELECT
  pm.project_id,
  pm.user_id,
  pm.role,
  pm.joined_at,
  u.email,
  u.avatar,
  lobehub_admin.user_display_name(u.id) AS display_name
FROM lobehub_admin.project_members pm
JOIN public.users u ON u.id = pm.user_id;

COMMIT;
