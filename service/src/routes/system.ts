import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  authenticateAdminLogin,
  clearAdminSessionCookie,
  createAdminSession,
  getActorProjectBinding,
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
    activeProjectId: null as string | null,
    activeProjectName: null as string | null,
    activeProjectRole: null as 'admin' | 'member' | null,
    bindingStatus: actor.isSystemAdmin ? 'system_admin' as const : 'unbound' as const,
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
    const binding = await getActorProjectBinding(loginResult.actor.id);

    setAdminSessionCookie(reply, session);

    const context = toActorContext(
      loginResult.actor,
      loginResult.managedProjectCount,
      loginResult.joinedProjectCount,
    );

    return {
      ...context,
      activeProjectId: binding.projectId,
      activeProjectName: binding.projectName,
      activeProjectRole: binding.projectRole,
      bindingStatus: binding.status,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await revokeAdminSessionFromRequest(request);
    clearAdminSessionCookie(reply);
    reply.status(204).send();
  });

  app.get('/api/me/context', async (request) => {
    const actor = await requireActor(request);
    const accessCounts = await getProjectAccessCounts(actor.id);
    const binding = await getActorProjectBinding(actor.id);

    return {
      ...toActorContext(actor, accessCounts.managedProjectCount, accessCounts.joinedProjectCount),
      activeProjectId: binding.projectId,
      activeProjectName: binding.projectName,
      activeProjectRole: binding.projectRole,
      bindingStatus: binding.status,
    };
  });
}
