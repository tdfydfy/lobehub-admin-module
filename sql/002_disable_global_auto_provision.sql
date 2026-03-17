BEGIN;

UPDATE public.system_provisioning_config
SET enabled = false,
    updated_at = now()
WHERE id = 1;

ALTER TABLE public.users DISABLE TRIGGER trg_provision_on_user_insert;

COMMIT;
