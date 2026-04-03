BEGIN;

ALTER TABLE crm.customer_profiles
  ADD COLUMN IF NOT EXISTS topic_id text REFERENCES public.topics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intent_grade text,
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS summary_json jsonb,
  ADD COLUMN IF NOT EXISTS last_summary_message_id text REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_summary_at timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_customer_profiles_topic_id
  ON crm.customer_profiles(topic_id);

CREATE INDEX IF NOT EXISTS idx_crm_customer_profiles_project_updated_at
  ON crm.customer_profiles(project, updated_at DESC);

CREATE TABLE IF NOT EXISTS lobehub_admin.crm_summary_sync_state (
  worker_key text PRIMARY KEY,
  cursor_updated_at timestamp with time zone NOT NULL DEFAULT now(),
  cursor_message_id text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_touch_updated_at_crm_summary_sync_state ON lobehub_admin.crm_summary_sync_state;
CREATE TRIGGER trg_touch_updated_at_crm_summary_sync_state
BEFORE UPDATE ON lobehub_admin.crm_summary_sync_state
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_public_messages_assistant_updated_at_id
  ON public.messages(updated_at ASC, id ASC)
  WHERE role = 'assistant';

COMMIT;
