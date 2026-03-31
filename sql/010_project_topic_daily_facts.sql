BEGIN;

CREATE TABLE IF NOT EXISTS lobehub_admin.project_topic_daily_facts (
  project_id text NOT NULL REFERENCES lobehub_admin.projects(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  topic_id text NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  managed_session_id text REFERENCES public.sessions(id) ON DELETE SET NULL,
  topic_created_at timestamp with time zone NOT NULL,
  topic_updated_at timestamp with time zone NOT NULL,
  first_user_message_at timestamp with time zone,
  previous_user_message_at timestamp with time zone,
  last_user_message_at timestamp with time zone,
  last_visible_message_at timestamp with time zone,
  is_new_topic boolean NOT NULL DEFAULT false,
  is_active_topic boolean NOT NULL DEFAULT false,
  has_visit boolean NOT NULL DEFAULT false,
  is_first_visit boolean NOT NULL DEFAULT false,
  is_revisit boolean NOT NULL DEFAULT false,
  visible_message_count integer NOT NULL DEFAULT 0,
  user_message_count integer NOT NULL DEFAULT 0,
  assistant_message_count integer NOT NULL DEFAULT 0,
  latest_intent_band text CHECK (latest_intent_band IN ('A', 'B', 'C', 'D')),
  latest_intent_grade text,
  latest_intent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, business_date, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_topic_daily_facts_project_date
  ON lobehub_admin.project_topic_daily_facts(project_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_topic_daily_facts_date
  ON lobehub_admin.project_topic_daily_facts(business_date DESC);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_topic_daily_facts_project_owner
  ON lobehub_admin.project_topic_daily_facts(project_id, owner_user_id, business_date DESC);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_topic_daily_facts_project_revisit
  ON lobehub_admin.project_topic_daily_facts(project_id, business_date DESC, is_revisit);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_topic_daily_facts_project_visit
  ON lobehub_admin.project_topic_daily_facts(project_id, business_date DESC, has_visit);

CREATE OR REPLACE FUNCTION lobehub_admin.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_updated_at_project_topic_daily_facts ON lobehub_admin.project_topic_daily_facts;
CREATE TRIGGER trg_touch_updated_at_project_topic_daily_facts
BEFORE UPDATE ON lobehub_admin.project_topic_daily_facts
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

CREATE OR REPLACE VIEW lobehub_admin.project_daily_overview_view AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  f.business_date,
  count(*) FILTER (WHERE f.is_new_topic)::int AS new_topic_count,
  count(*) FILTER (WHERE f.is_active_topic)::int AS active_topic_count,
  count(*) FILTER (WHERE f.has_visit)::int AS visit_customer_count,
  count(*) FILTER (WHERE f.is_first_visit)::int AS first_visit_count,
  count(*) FILTER (WHERE f.is_revisit)::int AS revisit_count,
  count(DISTINCT f.owner_user_id) FILTER (WHERE f.is_active_topic)::int AS active_member_count,
  coalesce(sum(f.visible_message_count), 0)::int AS visible_message_count,
  coalesce(sum(f.user_message_count), 0)::int AS user_message_count,
  coalesce(sum(f.assistant_message_count), 0)::int AS assistant_message_count,
  count(*) FILTER (WHERE f.latest_intent_band = 'A')::int AS a_intent_count,
  count(*) FILTER (WHERE f.latest_intent_band = 'B')::int AS b_intent_count,
  count(*) FILTER (WHERE f.latest_intent_band = 'C')::int AS c_intent_count,
  count(*) FILTER (WHERE f.latest_intent_band = 'D')::int AS d_intent_count,
  count(*) FILTER (WHERE f.has_visit AND f.latest_intent_band IS NULL)::int AS missing_intent_count,
  max(f.last_visible_message_at) AS last_active_at
FROM lobehub_admin.projects p
JOIN lobehub_admin.project_topic_daily_facts f
  ON f.project_id = p.id
GROUP BY p.id, p.name, f.business_date;

COMMIT;
