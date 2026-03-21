BEGIN;

ALTER TABLE lobehub_admin.project_daily_report_settings
  DROP CONSTRAINT IF EXISTS project_daily_report_settings_model_provider_override_check;

ALTER TABLE lobehub_admin.project_daily_report_settings
  ADD CONSTRAINT project_daily_report_settings_model_provider_override_check
  CHECK (model_provider_override IN ('volcengine', 'fallback'));

COMMIT;
