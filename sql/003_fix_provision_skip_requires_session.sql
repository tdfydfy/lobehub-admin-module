BEGIN;

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

COMMIT;
