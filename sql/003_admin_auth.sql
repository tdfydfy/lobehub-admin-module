CREATE TABLE IF NOT EXISTS lobehub_admin.admin_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_admin_sessions_user
  ON lobehub_admin.admin_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_lobehub_admin_admin_sessions_expires
  ON lobehub_admin.admin_sessions(expires_at);
