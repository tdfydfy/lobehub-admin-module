BEGIN;

CREATE OR REPLACE FUNCTION lobehub_admin.enforce_single_project_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_other_project_id text;
  v_is_system_admin boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM lobehub_admin.system_admins sa
    WHERE sa.user_id = NEW.user_id
  )
  INTO v_is_system_admin;

  IF v_is_system_admin THEN
    RETURN NEW;
  END IF;

  SELECT pm.project_id
  INTO v_other_project_id
  FROM lobehub_admin.project_members pm
  WHERE pm.user_id = NEW.user_id
    AND pm.project_id <> NEW.project_id
    AND (TG_OP <> 'UPDATE' OR pm.id <> NEW.id)
  LIMIT 1;

  IF v_other_project_id IS NOT NULL THEN
    RAISE EXCEPTION 'User % is already bound to another project %', NEW.user_id, v_other_project_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_single_project_membership ON lobehub_admin.project_members;
CREATE TRIGGER trg_enforce_single_project_membership
BEFORE INSERT OR UPDATE OF project_id, user_id ON lobehub_admin.project_members
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.enforce_single_project_membership();

COMMIT;
