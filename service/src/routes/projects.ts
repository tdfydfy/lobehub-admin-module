import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdmin, requireActor } from '../auth.js';
import { db, query } from '../db.js';

type ManagedAssistantStatus = 'provisioned' | 'failed' | 'skipped' | null;

type ProjectSummaryRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  admin_count: string;
  member_count: string;
};

type MemberAssistantSummary = {
  id: string;
  title: string | null;
  slug: string | null;
  updatedAt: string;
  isProjectManaged: boolean;
  managedStatus: ManagedAssistantStatus;
};

const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  adminUserIds: z.array(z.string().min(1)).min(1),
});

const addMembersSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  role: z.enum(['admin', 'member']).default('member'),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const setTemplateSchema = z.object({
  templateUserId: z.string().min(1),
  templateAgentId: z.string().min(1),
  copySkills: z.boolean().default(true),
});

const runProvisionSchema = z.object({
  setDefaultAgent: z.boolean().default(false),
});

function projectAccessError(message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 403;
  return error;
}

function memberMutationError(message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 409;
  return error;
}

function templateMutationError(message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 409;
  return error;
}

function mapProjectRow(row: ProjectSummaryRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    adminCount: Number(row.admin_count),
    memberCount: Number(row.member_count),
  };
}

async function fetchProjectsForActor(actorId: string, isSystemAdmin: boolean) {
  if (isSystemAdmin) {
    return query<ProjectSummaryRow>(
      `
      select
        p.id,
        p.name,
        p.description,
        p.created_at,
        p.updated_at,
        count(*) filter (where pm.role = 'admin')::text as admin_count,
        count(*) filter (where pm.role = 'member')::text as member_count
      from lobehub_admin.projects p
      left join lobehub_admin.project_members pm on pm.project_id = p.id
      group by p.id
      order by p.created_at desc
      `,
    );
  }

  return query<ProjectSummaryRow>(
    `
    select
      p.id,
      p.name,
      p.description,
      p.created_at,
      p.updated_at,
      count(*) filter (where pm.role = 'admin')::text as admin_count,
      count(*) filter (where pm.role = 'member')::text as member_count
    from lobehub_admin.projects p
    join lobehub_admin.project_members pm_actor
      on pm_actor.project_id = p.id
     and pm_actor.user_id = $1
     and pm_actor.role = 'admin'
    left join lobehub_admin.project_members pm on pm.project_id = p.id
    group by p.id
    order by p.created_at desc
    `,
    [actorId],
  );
}

async function fetchProjectTemplate(projectId: string) {
  return query<{
    project_id: string;
    template_user_id: string | null;
    template_agent_id: string | null;
    copy_skills: boolean;
    updated_at: string;
    updated_by: string | null;
    template_user_email: string | null;
    template_user_display_name: string | null;
    template_agent_title: string | null;
    template_skill_count: string;
  }>(
    `
    select
      pt.project_id,
      pt.template_user_id,
      pt.template_agent_id,
      pt.copy_skills,
      pt.updated_at,
      pt.updated_by,
      u.email as template_user_email,
      lobehub_admin.user_display_name(pt.template_user_id) as template_user_display_name,
      a.title as template_agent_title,
      coalesce((
        select count(*)::text
        from public.agent_skills s
        where s.user_id = pt.template_user_id
      ), '0') as template_skill_count
    from lobehub_admin.project_templates pt
    left join public.users u on u.id = pt.template_user_id
    left join public.agents a on a.id = pt.template_agent_id
    where pt.project_id = $1
    limit 1
    `,
    [projectId],
  );
}

async function getTemplateUserId(client: { query: typeof db.query }, projectId: string) {
  const result = await client.query<{ template_user_id: string | null }>(
    `
    select template_user_id
    from lobehub_admin.project_templates
    where project_id = $1
    limit 1
    `,
    [projectId],
  );

  return result.rows[0]?.template_user_id ?? null;
}

async function getLockedAdminUserIds(client: { query: typeof db.query }, projectId: string) {
  const result = await client.query<{ user_id: string }>(
    `
    select user_id
    from lobehub_admin.project_members
    where project_id = $1
      and role = 'admin'
    for update
    `,
    [projectId],
  );

  return result.rows.map((row) => row.user_id);
}

async function assertTemplateUserUnaffected(
  client: { query: typeof db.query },
  projectId: string,
  affectedUserIds: string[],
) {
  if (affectedUserIds.length === 0) return;

  const templateUserId = await getTemplateUserId(client, projectId);

  if (templateUserId && affectedUserIds.includes(templateUserId)) {
    throw memberMutationError('当前模板管理员不能被降为成员或移除，请先更换项目模板管理员');
  }
}

async function assertAdminsRemain(
  client: { query: typeof db.query },
  projectId: string,
  adminUserIdsToRemove: string[],
) {
  if (adminUserIdsToRemove.length === 0) return;

  const adminUserIds = await getLockedAdminUserIds(client, projectId);
  const pendingRemoval = new Set(adminUserIdsToRemove);
  const remainingAdminCount = adminUserIds.filter((userId) => !pendingRemoval.has(userId)).length;

  if (remainingAdminCount < 1) {
    throw memberMutationError('项目至少需要保留一名管理员');
  }
}

async function assertTemplateSelectionValid(
  executeQuery: typeof query,
  projectId: string,
  templateUserId: string,
  templateAgentId: string,
) {
  const result = await executeQuery<{ is_admin: boolean; agent_belongs: boolean }>(
    `
    select
      exists (
        select 1
        from lobehub_admin.project_members pm
        where pm.project_id = $1
          and pm.user_id = $2
          and pm.role = 'admin'
      ) as is_admin,
      exists (
        select 1
        from public.agents a
        where a.id = $3
          and a.user_id = $2
      ) as agent_belongs
    `,
    [projectId, templateUserId, templateAgentId],
  );

  const selection = result.rows[0];

  if (!selection?.is_admin) {
    throw templateMutationError('模板用户必须是项目管理员');
  }

  if (!selection.agent_belongs) {
    throw templateMutationError('所选模板助手不属于当前模板管理员，请重新选择后再保存');
  }
}

export async function registerProjectRoutes(app: FastifyInstance) {
  app.get('/api/users', async (request) => {
    const actor = await requireActor(request);

    if (!actor.isSystemAdmin) {
      throw projectAccessError('Only system admins can search users');
    }

    const queryParams = z
      .object({
        q: z.string().optional(),
      })
      .parse(request.query);

    const keyword = queryParams.q?.trim() ?? '';

    const result = await query<{
      id: string;
      email: string | null;
      avatar: string | null;
      display_name: string;
    }>(
      `
      select
        u.id,
        u.email,
        u.avatar,
        lobehub_admin.user_display_name(u.id) as display_name
      from public.users u
      where (
        $1 = ''
        or lower(coalesce(u.email, '')) like '%' || lower($1) || '%'
        or lower(coalesce(u.username, '')) like '%' || lower($1) || '%'
        or lower(coalesce(u.full_name, '')) like '%' || lower($1) || '%'
      )
      order by u.created_at desc
      limit 20
      `,
      [keyword],
    );

    return {
      users: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        avatar: row.avatar,
        displayName: row.display_name,
      })),
    };
  });

  app.get('/api/projects', async (request) => {
    const actor = await requireActor(request);
    const result = await fetchProjectsForActor(actor.id, actor.isSystemAdmin);

    return {
      projects: result.rows.map(mapProjectRow),
    };
  });

  app.post('/api/projects', async (request, reply) => {
    const actor = await requireActor(request);

    if (!actor.isSystemAdmin) {
      throw projectAccessError('Only system admins can create projects');
    }

    const body = createProjectSchema.parse(request.body);

    const result = await query<{ project_id: string }>(
      'select lobehub_admin.create_project($1, $2, $3, $4) as project_id',
      [body.name, body.description ?? null, actor.id, body.adminUserIds],
    );

    return reply.code(201).send({
      projectId: result.rows[0]?.project_id,
    });
  });

  app.get('/api/projects/:projectId', async (request) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    await ensureProjectAdmin(actor.id, params.projectId);

    const result = await query<ProjectSummaryRow>(
      `
      select
        p.id,
        p.name,
        p.description,
        p.created_at,
        p.updated_at,
        count(*) filter (where pm.role = 'admin')::text as admin_count,
        count(*) filter (where pm.role = 'member')::text as member_count
      from lobehub_admin.projects p
      left join lobehub_admin.project_members pm on pm.project_id = p.id
      where p.id = $1
      group by p.id
      limit 1
      `,
      [params.projectId],
    );

    return {
      project: result.rows[0] ? mapProjectRow(result.rows[0]) : null,
    };
  });

  app.delete('/api/projects/:projectId', async (request, reply) => {
    const actor = await requireActor(request);

    if (!actor.isSystemAdmin) {
      throw projectAccessError('Only system admins can delete projects');
    }

    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    const result = await query<{ id: string }>(
      'delete from lobehub_admin.projects where id = $1 returning id',
      [params.projectId],
    );

    if (!result.rows[0]) {
      return reply.code(404).send({ message: 'Project not found' });
    }

    return reply.code(204).send();
  });

  app.get('/api/projects/:projectId/members', async (request) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    await ensureProjectAdmin(actor.id, params.projectId);

    const result = await query<{
      user_id: string;
      role: 'admin' | 'member';
      joined_at: string;
      email: string | null;
      avatar: string | null;
      display_name: string;
      managed_agent_id: string | null;
      managed_agent_title: string | null;
      project_managed_status: ManagedAssistantStatus;
      project_managed_message: string | null;
    }>(
      `
      select
        pmv.user_id,
        pmv.role,
        pmv.joined_at,
        pmv.email,
        pmv.avatar,
        pmv.display_name,
        pma.managed_agent_id,
        ma.title as managed_agent_title,
        pma.last_status as project_managed_status,
        pma.last_message as project_managed_message
      from lobehub_admin.project_members_view pmv
      left join lobehub_admin.project_managed_agents pma
        on pma.project_id = pmv.project_id
       and pma.user_id = pmv.user_id
      left join public.agents ma
        on ma.id = pma.managed_agent_id
      where pmv.project_id = $1
      order by case pmv.role when 'admin' then 1 else 2 end, pmv.joined_at asc
      `,
      [params.projectId],
    );

    const userIds = result.rows.map((row) => row.user_id);
    const assistantsByUser = new Map<string, MemberAssistantSummary[]>();

    if (userIds.length > 0) {
      const assistantResult = await query<{
        user_id: string;
        agent_id: string;
        title: string | null;
        slug: string | null;
        updated_at: string;
        is_project_managed: boolean;
        managed_status: ManagedAssistantStatus;
      }>(
        `
        select
          a.user_id,
          a.id as agent_id,
          a.title,
          a.slug,
          a.updated_at,
          (pma.managed_agent_id is not null) as is_project_managed,
          pma.last_status as managed_status
        from public.agents a
        left join lobehub_admin.project_managed_agents pma
          on pma.project_id = $1
         and pma.user_id = a.user_id
         and pma.managed_agent_id = a.id
        where a.user_id = any($2::text[])
          and coalesce(a.slug, '') not in ('inbox', 'page-agent', 'agent-builder', 'group-agent-builder')
        order by
          a.user_id asc,
          case when pma.managed_agent_id is not null then 0 else 1 end,
          a.updated_at desc
        `,
        [params.projectId, userIds],
      );

      for (const row of assistantResult.rows) {
        const current = assistantsByUser.get(row.user_id) ?? [];
        current.push({
          id: row.agent_id,
          title: row.title,
          slug: row.slug,
          updatedAt: row.updated_at,
          isProjectManaged: row.is_project_managed,
          managedStatus: row.managed_status,
        });
        assistantsByUser.set(row.user_id, current);
      }
    }

    const admins = [];
    const members = [];

    for (const row of result.rows) {
      const assistants = assistantsByUser.get(row.user_id) ?? [];
      const item = {
        userId: row.user_id,
        role: row.role,
        joinedAt: row.joined_at,
        email: row.email,
        avatar: row.avatar,
        displayName: row.display_name,
        assistantCount: assistants.length,
        assistants,
        projectManagedAssistantId: row.managed_agent_id,
        projectManagedAssistantTitle: row.managed_agent_title,
        projectManagedStatus: row.project_managed_status,
        projectManagedMessage: row.project_managed_message,
      };

      if (row.role === 'admin') {
        admins.push(item);
      } else {
        members.push(item);
      }
    }

    return { admins, members };
  });

  app.post('/api/projects/:projectId/members', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = addMembersSchema.parse(request.body);

    await ensureProjectAdmin(actor.id, params.projectId);

    const client = await db.connect();

    try {
      await client.query('begin');

      if (body.role === 'member') {
        const normalizedEmails = body.emails.map((email) => email.trim().toLowerCase());
        const existingResult = await client.query<{
          user_id: string;
          role: 'admin' | 'member';
        }>(
          `
          select
            pm.user_id,
            pm.role
          from lobehub_admin.project_members pm
          join public.users u on u.id = pm.user_id
          where pm.project_id = $1
            and lower(coalesce(u.email, '')) = any($2::text[])
          for update of pm
          `,
          [params.projectId, normalizedEmails],
        );

        const affectedExistingUserIds = existingResult.rows.map((row) => row.user_id);
        const affectedAdminUserIds = existingResult.rows
          .filter((row) => row.role === 'admin')
          .map((row) => row.user_id);

        await assertTemplateUserUnaffected(client, params.projectId, affectedExistingUserIds);
        await assertAdminsRemain(client, params.projectId, affectedAdminUserIds);
      }

      const result = await client.query<{
        email: string;
        user_id: string | null;
        status: string;
        message: string;
      }>(
        'select * from lobehub_admin.add_project_members_by_email($1, $2, $3)',
        [params.projectId, body.emails, body.role],
      );

      await client.query('commit');

      return reply.code(201).send({
        results: result.rows.map((row) => ({
          email: row.email,
          userId: row.user_id,
          status: row.status,
          message: row.message,
        })),
      });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.put('/api/projects/:projectId/members/:userId/role', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z
      .object({
        projectId: z.string().min(1),
        userId: z.string().min(1),
      })
      .parse(request.params);
    const body = updateMemberRoleSchema.parse(request.body);

    await ensureProjectAdmin(actor.id, params.projectId);

    const client = await db.connect();

    try {
      await client.query('begin');

      const memberResult = await client.query<{ role: 'admin' | 'member' }>(
        `
        select role
        from lobehub_admin.project_members
        where project_id = $1
          and user_id = $2
        for update
        `,
        [params.projectId, params.userId],
      );

      const member = memberResult.rows[0];

      if (!member) {
        await client.query('rollback');
        return reply.code(404).send({ message: 'Member not found' });
      }

      if (member.role === body.role) {
        await client.query('commit');
        return reply.code(204).send();
      }

      if (body.role === 'member') {
        await assertTemplateUserUnaffected(client, params.projectId, [params.userId]);
        if (member.role === 'admin') {
          await assertAdminsRemain(client, params.projectId, [params.userId]);
        }
      }

      await client.query(
        `
        update lobehub_admin.project_members
        set role = $3
        where project_id = $1
          and user_id = $2
        `,
        [params.projectId, params.userId, body.role],
      );

      await client.query('commit');
      return reply.code(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/projects/:projectId/members/:userId', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z
      .object({
        projectId: z.string().min(1),
        userId: z.string().min(1),
      })
      .parse(request.params);

    await ensureProjectAdmin(actor.id, params.projectId);

    const client = await db.connect();

    try {
      await client.query('begin');

      const memberResult = await client.query<{ user_id: string; role: 'admin' | 'member' }>(
        `
        select user_id, role
        from lobehub_admin.project_members
        where project_id = $1
          and user_id = $2
        for update
        `,
        [params.projectId, params.userId],
      );

      const member = memberResult.rows[0];

      if (!member) {
        await client.query('rollback');
        return reply.code(404).send({ message: 'Member not found' });
      }

      await assertTemplateUserUnaffected(client, params.projectId, [params.userId]);

      if (member.role === 'admin') {
        await assertAdminsRemain(client, params.projectId, [params.userId]);
      }

      await client.query(
        `
        delete from lobehub_admin.project_members
        where project_id = $1
          and user_id = $2
        `,
        [params.projectId, params.userId],
      );

      await client.query('commit');
      return reply.code(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/projects/:projectId/template', async (request) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    await ensureProjectAdmin(actor.id, params.projectId);

    const result = await fetchProjectTemplate(params.projectId);

    return {
      template: result.rows[0] ?? null,
    };
  });

  app.get('/api/projects/:projectId/agents', async (request) => {
    const actor = await requireActor(request);
    const params = z
      .object({
        projectId: z.string().min(1),
      })
      .parse(request.params);

    const queryParams = z
      .object({
        adminUserId: z.string().min(1),
      })
      .parse(request.query);

    await ensureProjectAdmin(actor.id, params.projectId);

    const adminCheck = await query<{ exists: boolean }>(
      `
      select exists (
        select 1
        from lobehub_admin.project_members
        where project_id = $1
          and user_id = $2
          and role = 'admin'
      ) as exists
      `,
      [params.projectId, queryParams.adminUserId],
    );

    if (!adminCheck.rows[0]?.exists) {
      return {
        agents: [],
      };
    }

    const result = await query<{
      id: string;
      title: string | null;
      slug: string | null;
      updated_at: string;
      skill_count: string;
    }>(
      `
      select
        a.id,
        a.title,
        a.slug,
        a.updated_at,
        (
          select count(*)::text
          from public.agent_skills s
          where s.user_id = a.user_id
        ) as skill_count
      from public.agents a
      where a.user_id = $1
        and nullif(btrim(coalesce(a.title, '')), '') is not null
        and coalesce(a.slug, '') not in ('inbox', 'page-agent', 'agent-builder', 'group-agent-builder')
      order by a.updated_at desc
      `,
      [queryParams.adminUserId],
    );

    return {
      agents: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        updatedAt: row.updated_at,
        skillCount: Number(row.skill_count),
      })),
    };
  });

  app.put('/api/projects/:projectId/template', async (request) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = setTemplateSchema.parse(request.body);

    await ensureProjectAdmin(actor.id, params.projectId);

    await assertTemplateSelectionValid(query, params.projectId, body.templateUserId, body.templateAgentId);

    try {
      await query(
        'select * from lobehub_admin.set_project_template($1, $2, $3, $4, $5)',
        [params.projectId, body.templateUserId, body.templateAgentId, body.copySkills, actor.id],
      );
    } catch (error) {
      const message = (error as Error).message;

      if (message === 'Template user must be a project admin') {
        throw templateMutationError('模板用户必须是项目管理员');
      }

      if (message.includes('does not belong to template user')) {
        throw templateMutationError('所选模板助手不属于当前模板管理员，请重新选择后再保存');
      }

      throw error;
    }

    const result = await fetchProjectTemplate(params.projectId);

    return {
      template: result.rows[0] ?? null,
    };
  });

  app.post('/api/projects/:projectId/provision', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = runProvisionSchema.parse(request.body ?? {});

    await ensureProjectAdmin(actor.id, params.projectId);

    const result = await query<{ job_id: string }>(
      'select lobehub_admin.run_project_provision_job($1, $2, $3, $4, $5) as job_id',
      [params.projectId, 'configure', actor.id, false, body.setDefaultAgent],
    );

    return reply.code(202).send({
      jobId: result.rows[0]?.job_id,
    });
  });

  app.post('/api/projects/:projectId/provision/refresh', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = runProvisionSchema.parse(request.body ?? {});

    await ensureProjectAdmin(actor.id, params.projectId);

    const result = await query<{ job_id: string }>(
      'select lobehub_admin.run_project_provision_job($1, $2, $3, $4, $5) as job_id',
      [params.projectId, 'refresh', actor.id, true, body.setDefaultAgent],
    );

    return reply.code(202).send({
      jobId: result.rows[0]?.job_id,
    });
  });

  app.get('/api/projects/:projectId/jobs/:jobId', async (request) => {
    const actor = await requireActor(request);
    const params = z
      .object({
        projectId: z.string().min(1),
        jobId: z.string().min(1),
      })
      .parse(request.params);

    await ensureProjectAdmin(actor.id, params.projectId);

    const [jobResult, itemsResult] = await Promise.all([
      query<{
        id: string;
        project_id: string;
        job_type: string;
        status: string;
        total_count: number;
        success_count: number;
        failed_count: number;
        skipped_count: number;
        started_at: string | null;
        finished_at: string | null;
        error_message: string | null;
      }>(
        `
        select
          id,
          project_id,
          job_type,
          status,
          total_count,
          success_count,
          failed_count,
          skipped_count,
          started_at,
          finished_at,
          error_message
        from lobehub_admin.provision_jobs
        where id = $1
          and project_id = $2
        limit 1
        `,
        [params.jobId, params.projectId],
      ),
      query<{
        user_id: string;
        user_email: string | null;
        user_display_name: string | null;
        status: string;
        message: string | null;
        managed_agent_id: string | null;
        managed_session_id: string | null;
        started_at: string | null;
        finished_at: string | null;
      }>(
        `
        select
          j.user_id,
          u.email as user_email,
          lobehub_admin.user_display_name(j.user_id) as user_display_name,
          j.status,
          j.message,
          j.managed_agent_id,
          j.managed_session_id,
          j.started_at,
          j.finished_at
        from lobehub_admin.provision_job_items j
        join public.users u on u.id = j.user_id
        where j.job_id = $1
        order by j.created_at asc
        `,
        [params.jobId],
      ),
    ]);

    return {
      job: jobResult.rows[0] ?? null,
      items: itemsResult.rows,
    };
  });
}
