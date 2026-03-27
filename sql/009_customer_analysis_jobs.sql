BEGIN;

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

DROP TRIGGER IF EXISTS trg_touch_updated_at_customer_analysis_jobs ON lobehub_admin.project_customer_analysis_jobs;
CREATE TRIGGER trg_touch_updated_at_customer_analysis_jobs
BEFORE UPDATE ON lobehub_admin.project_customer_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

COMMIT;
