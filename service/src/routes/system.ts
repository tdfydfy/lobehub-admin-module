import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  authenticateAdminLogin,
  clearAdminSessionCookie,
  createAdminSession,
  getProjectAccessCounts,
  requireActor,
  revokeAdminSessionFromRequest,
  setAdminSessionCookie,
} from '../auth.js';

function toActorContext(actor: {
  id: string;
  email: string | null;
  avatar: string | null;
  displayName: string;
  isSystemAdmin: boolean;
}, managedProjectCount: number, joinedProjectCount: number) {
  return {
    actor: {
      id: actor.id,
      email: actor.email,
      avatar: actor.avatar,
      displayName: actor.displayName,
    },
    isSystemAdmin: actor.isSystemAdmin,
    managedProjectCount,
    joinedProjectCount,
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

    return toActorContext(
      loginResult.actor,
      loginResult.managedProjectCount,
      loginResult.joinedProjectCount,
    );
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await revokeAdminSessionFromRequest(request);
    clearAdminSessionCookie(reply);
    reply.status(204).send();
  });

  app.get('/api/me/context', async (request) => {
    const actor = await requireActor(request);
    const accessCounts = await getProjectAccessCounts(actor.id);

    return toActorContext(actor, accessCounts.managedProjectCount, accessCounts.joinedProjectCount);
  });
}
