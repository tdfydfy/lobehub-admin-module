import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from './config.js';
import { query } from './db.js';

const CREDENTIAL_PROVIDER_ID = 'credential';
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 16,
  p: 1,
  maxmem: 128 * 16384 * 16 * 2,
} as const;

export type ActorIdentity = {
  id: string;
  email: string | null;
  avatar: string | null;
  displayName: string;
  isSystemAdmin: boolean;
};

export type ProjectActorAccessRole = 'system_admin' | 'admin' | 'member';

export type ProjectActorAccess = ActorIdentity & {
  projectRole: ProjectActorAccessRole;
};

export type ActorProjectBindingStatus = 'system_admin' | 'bound' | 'unbound' | 'invalid_multi_project';

export type ActorProjectBinding = {
  status: ActorProjectBindingStatus;
  projectId: string | null;
  projectName: string | null;
  projectRole: 'admin' | 'member' | null;
};

type CredentialActorRow = {
  id: string;
  email: string | null;
  avatar: string | null;
  display_name: string;
  is_system_admin: boolean;
  managed_project_count: number;
  joined_project_count: number;
  password_hash: string | null;
};

type AdminSessionRow = {
  user_id: string;
};

type AdminSessionInfo = {
  token: string;
  expiresAt: Date;
};

let ensureAdminAuthSchemaPromise: Promise<void> | null = null;

function withStatus(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function parseCookieHeader(cookieHeader?: string) {
  const cookies = new Map<string, string>();

  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');

    if (separatorIndex < 0) continue;

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (!name) continue;

    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createSessionToken() {
  return randomBytes(32).toString('hex');
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
  ];

  if (env.ADMIN_SESSION_SECURE_COOKIE) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function getSessionCookieValue(request: FastifyRequest) {
  const cookies = parseCookieHeader(request.headers.cookie);
  return cookies.get(env.ADMIN_SESSION_COOKIE_NAME) ?? null;
}

function verifyCredentialPassword(storedPasswordHash: string, password: string) {
  const [salt, keyHex] = storedPasswordHash.split(':');

  if (!salt || !keyHex) {
    return false;
  }

  const normalizedPassword = password.normalize('NFKC');
  const derivedKey = scryptSync(normalizedPassword, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  const storedKey = Buffer.from(keyHex, 'hex');

  if (storedKey.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedKey);
}

async function findActorByIdInternal(actorId: string): Promise<ActorIdentity | null> {
  const result = await query<{
    id: string;
    email: string | null;
    avatar: string | null;
    display_name: string;
    is_system_admin: boolean;
  }>(
    `
    select
      u.id,
      u.email,
      u.avatar,
      lobehub_admin.user_display_name(u.id) as display_name,
      exists (
        select 1
        from lobehub_admin.system_admins sa
        where sa.user_id = u.id
      ) as is_system_admin
    from public.users u
    where u.id = $1
    limit 1
    `,
    [actorId],
  );

  const row = result.rows[0];

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    avatar: row.avatar,
    displayName: row.display_name,
    isSystemAdmin: row.is_system_admin,
  };
}

async function findSessionActorId(request: FastifyRequest) {
  const sessionToken = getSessionCookieValue(request);

  if (!sessionToken) return null;

  await ensureAdminAuthSchema();

  const result = await query<AdminSessionRow>(
    `
    update lobehub_admin.admin_sessions
    set last_seen_at = now()
    where token_hash = $1
      and expires_at > now()
    returning user_id
    `,
    [hashSessionToken(sessionToken)],
  );

  return result.rows[0]?.user_id ?? null;
}

async function findCredentialActorByEmail(email: string) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const result = await query<CredentialActorRow>(
    `
    select
      u.id,
      u.email,
      u.avatar,
      lobehub_admin.user_display_name(u.id) as display_name,
      exists (
        select 1
        from lobehub_admin.system_admins sa
        where sa.user_id = u.id
      ) as is_system_admin,
      (
        select count(*)::int
        from lobehub_admin.project_members pm
        where pm.user_id = u.id
          and pm.role = 'admin'
      ) as managed_project_count,
      (
        select count(*)::int
        from lobehub_admin.project_members pm
        where pm.user_id = u.id
      ) as joined_project_count,
      a.password as password_hash
    from public.users u
    join public.accounts a
      on a.user_id = u.id
     and a.provider_id = $2
    where lower(coalesce(u.email, '')) = $1
    limit 1
    `,
    [normalizedEmail, CREDENTIAL_PROVIDER_ID],
  );

  return result.rows[0] ?? null;
}

export async function ensureAdminAuthSchema() {
  if (!ensureAdminAuthSchemaPromise) {
    ensureAdminAuthSchemaPromise = (async () => {
      await query(
        `
        create table if not exists lobehub_admin.admin_sessions (
          id text primary key,
          user_id text not null references public.users(id) on delete cascade,
          token_hash text not null unique,
          ip text,
          user_agent text,
          created_at timestamptz not null default now(),
          last_seen_at timestamptz not null default now(),
          expires_at timestamptz not null
        );

        create index if not exists idx_lobehub_admin_admin_sessions_user
          on lobehub_admin.admin_sessions(user_id);

        create index if not exists idx_lobehub_admin_admin_sessions_expires
          on lobehub_admin.admin_sessions(expires_at);
        `,
      );
    })();
  }

  await ensureAdminAuthSchemaPromise;
}

export async function findActor(actorId: string): Promise<ActorIdentity | null> {
  return findActorByIdInternal(actorId);
}

export async function findActorByEmail(email: string): Promise<ActorIdentity | null> {
  const row = await findCredentialActorByEmail(email);

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    avatar: row.avatar,
    displayName: row.display_name,
    isSystemAdmin: row.is_system_admin,
  };
}

export async function getManagedProjectCount(actorId: string) {
  const result = await query<{ managed_project_count: string }>(
    `
    select count(*)::text as managed_project_count
    from lobehub_admin.project_members pm
    where pm.user_id = $1
      and pm.role = 'admin'
    `,
    [actorId],
  );

  return Number(result.rows[0]?.managed_project_count ?? 0);
}

export async function getProjectAccessCounts(actorId: string) {
  const result = await query<{
    managed_project_count: string;
    joined_project_count: string;
  }>(
    `
    select
      count(*) filter (where pm.role = 'admin')::text as managed_project_count,
      count(*)::text as joined_project_count
    from lobehub_admin.project_members pm
    where pm.user_id = $1
    `,
    [actorId],
  );

  return {
    managedProjectCount: Number(result.rows[0]?.managed_project_count ?? 0),
    joinedProjectCount: Number(result.rows[0]?.joined_project_count ?? 0),
  };
}

export async function getActorProjectBinding(actorId: string): Promise<ActorProjectBinding> {
  const actor = await findActor(actorId);

  if (!actor) {
    throw withStatus(`Actor not found: ${actorId}`, 404);
  }

  if (actor.isSystemAdmin) {
    return {
      status: 'system_admin',
      projectId: null,
      projectName: null,
      projectRole: null,
    };
  }

  const result = await query<{
    project_id: string;
    project_name: string;
    role: 'admin' | 'member';
  }>(
    `
    select
      pm.project_id,
      p.name as project_name,
      pm.role
    from lobehub_admin.project_members pm
    join lobehub_admin.projects p
      on p.id = pm.project_id
    where pm.user_id = $1
    order by pm.joined_at asc
    limit 2
    `,
    [actorId],
  );

  if (result.rows.length === 0) {
    return {
      status: 'unbound',
      projectId: null,
      projectName: null,
      projectRole: null,
    };
  }

  if (result.rows.length > 1) {
    return {
      status: 'invalid_multi_project',
      projectId: null,
      projectName: null,
      projectRole: null,
    };
  }

  const row = result.rows[0];

  return {
    status: 'bound',
    projectId: row.project_id,
    projectName: row.project_name,
    projectRole: row.role,
  };
}

export async function authenticateAdminLogin(email: string, password: string) {
  const row = await findCredentialActorByEmail(email);

  if (!row?.password_hash) {
    throw withStatus('邮箱或密码错误', 401);
  }

  if (!verifyCredentialPassword(row.password_hash, password)) {
    throw withStatus('邮箱或密码错误', 401);
  }

  if (!row.is_system_admin && row.joined_project_count <= 0) {
    throw withStatus('当前账号没有可访问项目', 403);
  }

  return {
    actor: {
      id: row.id,
      email: row.email,
      avatar: row.avatar,
      displayName: row.display_name,
      isSystemAdmin: row.is_system_admin,
    },
    managedProjectCount: row.managed_project_count,
    joinedProjectCount: row.joined_project_count,
  };
}

export async function createAdminSession(userId: string, request: FastifyRequest): Promise<AdminSessionInfo> {
  await ensureAdminAuthSchema();

  const token = createSessionToken();
  const sessionId = `ads_${randomBytes(10).toString('hex')}`;
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000);

  await query(
    `
    insert into lobehub_admin.admin_sessions (
      id,
      user_id,
      token_hash,
      ip,
      user_agent,
      expires_at
    )
    values ($1, $2, $3, $4, $5, $6)
    `,
    [
      sessionId,
      userId,
      hashSessionToken(token),
      request.ip,
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      expiresAt.toISOString(),
    ],
  );

  return {
    token,
    expiresAt,
  };
}

export function setAdminSessionCookie(reply: FastifyReply, session: AdminSessionInfo) {
  const maxAgeSeconds = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
  reply.header('Set-Cookie', serializeCookie(env.ADMIN_SESSION_COOKIE_NAME, session.token, maxAgeSeconds));
}

export function clearAdminSessionCookie(reply: FastifyReply) {
  reply.header('Set-Cookie', serializeCookie(env.ADMIN_SESSION_COOKIE_NAME, '', 0));
}

export async function revokeAdminSessionFromRequest(request: FastifyRequest) {
  const sessionToken = getSessionCookieValue(request);

  if (!sessionToken) return;

  await ensureAdminAuthSchema();
  await query(
    `
    delete from lobehub_admin.admin_sessions
    where token_hash = $1
    `,
    [hashSessionToken(sessionToken)],
  );
}

async function resolveActorIdFromRequest(request: FastifyRequest) {
  const sessionActorId = await findSessionActorId(request);

  if (sessionActorId) {
    return sessionActorId;
  }

  if (env.ALLOW_LEGACY_ACTOR_HEADER) {
    const actorId = request.headers['x-admin-user-id'];

    if (typeof actorId === 'string' && actorId.trim() !== '') {
      return actorId.trim();
    }
  }

  throw withStatus('登录已过期或未登录', 401);
}

export async function requireActor(request: FastifyRequest) {
  const actorId = await resolveActorIdFromRequest(request);
  const actor = await findActor(actorId);

  if (!actor) {
    throw withStatus(`Actor not found: ${actorId}`, 404);
  }

  return actor;
}

export async function ensureSystemAdmin(actorId: string) {
  const actor = await findActor(actorId);

  if (!actor) {
    throw withStatus(`Actor not found: ${actorId}`, 404);
  }

  if (!actor.isSystemAdmin) {
    throw withStatus('System admin access required', 403);
  }

  return actor;
}

export async function ensureProjectMember(actorId: string, projectId: string): Promise<ProjectActorAccess> {
  const actor = await findActor(actorId);

  if (!actor) {
    throw withStatus(`Actor not found: ${actorId}`, 404);
  }

  if (actor.isSystemAdmin) {
    return {
      ...actor,
      projectRole: 'system_admin',
    };
  }

  const accessResult = await query<{ role: 'admin' | 'member' }>(
    `
    select pm.role
    from lobehub_admin.project_members pm
    where pm.project_id = $1
      and pm.user_id = $2
    limit 1
    `,
    [projectId, actorId],
  );

  const role = accessResult.rows[0]?.role;

  if (!role) {
    throw withStatus('Project member access required', 403);
  }

  return {
    ...actor,
    projectRole: role,
  };
}

export async function ensureProjectAdmin(actorId: string, projectId: string) {
  const access = await ensureProjectMember(actorId, projectId);

  if (access.projectRole === 'member') {
    throw withStatus('Project admin access required', 403);
  }

  return access;
}

export async function ensureProjectMemberRequest(request: FastifyRequest, projectId: string) {
  const actor = await requireActor(request);
  return ensureProjectMember(actor.id, projectId);
}

export async function ensureProjectAdminRequest(request: FastifyRequest, projectId: string) {
  const actor = await requireActor(request);
  return ensureProjectAdmin(actor.id, projectId);
}
