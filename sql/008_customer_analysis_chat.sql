BEGIN;

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

COMMIT;
