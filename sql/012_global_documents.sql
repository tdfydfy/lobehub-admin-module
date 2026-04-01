BEGIN;

CREATE TABLE IF NOT EXISTS lobehub_admin.global_documents (
  id text PRIMARY KEY DEFAULT lobehub_admin.gen_id('gdoc_'),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  content_md text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  sort_order integer NOT NULL DEFAULT 0,
  is_entry boolean NOT NULL DEFAULT false,
  created_by text REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_global_documents_main
  ON lobehub_admin.global_documents(status, is_entry, sort_order, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_global_documents_fts
  ON lobehub_admin.global_documents
  USING GIN (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
    )
  );

DROP TRIGGER IF EXISTS trg_touch_updated_at_global_documents ON lobehub_admin.global_documents;
CREATE TRIGGER trg_touch_updated_at_global_documents
BEFORE UPDATE ON lobehub_admin.global_documents
FOR EACH ROW
EXECUTE FUNCTION lobehub_admin.touch_updated_at();

COMMIT;
