BEGIN;

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

COMMIT;
