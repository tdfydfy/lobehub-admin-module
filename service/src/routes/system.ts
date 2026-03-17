import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  authenticateAdminLogin,
  clearAdminSessionCookie,
  createAdminSession,
  getManagedProjectCount,
  requireActor,
  revokeAdminSessionFromRequest,
  setAdminSessionCookie,
} from '../auth.js';
import { query } from '../db.js';

function toActorContext(actor: {
  id: string;
  email: string | null;
  avatar: string | null;
  displayName: string;
  isSystemAdmin: boolean;
}, managedProjectCount: number) {
  return {
    actor: {
      id: actor.id,
      email: actor.email,
      avatar: actor.avatar,
      displayName: actor.displayName,
    },
    isSystemAdmin: actor.isSystemAdmin,
    managedProjectCount,
  };
}

export async function registerSystemRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (request, reply) => {
    const payload = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }).parse(request.body);

    const loginResult = await authenticateAdminLogin(payload.email, payload.password);
    const session = await createAdminSession(loginResult.actor.id, request);

    setAdminSessionCookie(reply, session);

    return toActorContext(loginResult.actor, loginResult.managedProjectCount);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await revokeAdminSessionFromRequest(request);
    clearAdminSessionCookie(reply);
    reply.status(204).send();
  });

  app.get('/api/me/context', async (request) => {
    const actor = await requireActor(request);
    const managedProjectCount = await getManagedProjectCount(actor.id);

    return toActorContext(actor, managedProjectCount);
  });

  app.get('/api/system/status', async () => {
    const [configResult, triggerResult] = await Promise.all([
      query<{
        enabled: boolean;
        template_user_id: string | null;
        template_agent_id: string | null;
        updated_at: string | null;
      }>(
        `
        select enabled, template_user_id, template_agent_id, updated_at
        from public.system_provisioning_config
        where id = 1
        limit 1
        `,
      ),
      query<{
        tgname: string;
        tgenabled: string;
      }>(
        `
        select tgname, tgenabled
        from pg_trigger
        where tgrelid = 'public.users'::regclass
          and not tgisinternal
          and tgname = 'trg_provision_on_user_insert'
        `,
      ),
    ]);

    return {
      legacyAutoProvision: {
        triggerInstalled: Boolean(triggerResult.rows[0]),
        triggerEnabled: triggerResult.rows[0]?.tgenabled === 'O',
        configEnabled: configResult.rows[0]?.enabled ?? null,
        templateUserId: configResult.rows[0]?.template_user_id ?? null,
        templateAgentId: configResult.rows[0]?.template_agent_id ?? null,
        updatedAt: configResult.rows[0]?.updated_at ?? null,
      },
    };
  });
}
