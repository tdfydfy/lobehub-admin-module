import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureProjectAdmin, ensureProjectMember, requireActor } from '../auth.js';
import { db, query } from '../db.js';
import { seedDefaultProjectDocuments } from '../project-document-templates.js';
import {
  buildKnowledgePluginIdentifier,
  removeKnowledgePluginForUsers,
  syncProjectDocumentPlugin,
} from '../project-document-plugin.js';
import { enqueueProvisionJob, enqueueProvisionJobForUsers, scheduleProvisionJob } from '../provision-jobs.js';

type ManagedAssistantStatus = 'provisioned' | 'failed' | 'skipped' | null;
const EXCLUDED_AGENT_SLUGS = ['inbox', 'page-agent', 'agent-builder', 'group-agent-builder'];

type ProjectSummaryRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  admin_count: string;
  member_count: string;
  actor_role: 'system_admin' | 'admin' | 'member';
};

type MemberAssistantSummary = {
  id: string;
  title: string | null;
  slug: string | null;
  updatedAt: string;
  isProjectManaged: boolean;
  managedStatus: ManagedAssistantStatus;
  description?: string | null;
  model?: string | null;
  provider?: string | null;
  systemRole?: string | null;
  openingMessage?: string | null;
  openingQuestions?: string[];
  chatConfig?: unknown | null;
  params?: unknown | null;
  pluginIdentifiers?: string[];
  unresolvedPluginIdentifiers?: string[];
  skills?: Array<{
    id: string;
    kind: 'skill' | 'plugin';
    name: string;
    description: string | null;
    identifier: string | null;
    pluginType?: string | null;
    source: string | null;
    updatedAt: string;
  }>;
};

type MemberAssistantDetailRow = {
  id: string;
  user_id: string;
  title: string | null;
  slug: string | null;
  description: string | null;
  updated_at: string;
  model: string | null;
  provider: string | null;
  system_role: string | null;
  opening_message: string | null;
  opening_questions: string[] | null;
  chat_config: unknown | null;
  params: unknown | null;
  plugins: unknown;
  is_project_managed: boolean;
  managed_status: ManagedAssistantStatus;
};

type MemberAssistantSkillRow = {
  id: string;
  name: string;
  description: string | null;
  identifier: string | null;
  source: string | null;
  updated_at: string;
  kind: 'skill' | 'plugin';
  plugin_type: string | null;
};

type MemberAssistantSkillLookupRow = MemberAssistantSkillRow & {
  user_id: string;
};

type ProjectMembershipConflictRow = {
  current_project_id: string;
  current_project_name: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  user_id: string;
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

async function findProjectMembershipConflicts(
  executeQuery: typeof query,
  userIds: string[],
  excludeProjectId?: string,
) {
  if (userIds.length === 0) return [] as ProjectMembershipConflictRow[];

  const values: unknown[] = [userIds];
  const excludeClause = excludeProjectId
    ? (() => {
      values.push(excludeProjectId);
      return `and pm.project_id <> $${values.length}`;
    })()
    : '';

  const result = await executeQuery<ProjectMembershipConflictRow>(
    `
    select
      pm.user_id,
      pm.project_id as current_project_id,
      p.name as current_project_name,
      lobehub_admin.user_display_name(pm.user_id) as display_name,
      u.email,
      pm.role
    from lobehub_admin.project_members pm
    join lobehub_admin.projects p
      on p.id = pm.project_id
    join public.users u
      on u.id = pm.user_id
    where pm.user_id = any($1::text[])
      ${excludeClause}
      and not exists (
        select 1
        from lobehub_admin.system_admins sa
        where sa.user_id = pm.user_id
      )
    order by pm.joined_at asc
    `,
    values,
  );

  return result.rows;
}

async function findProjectMembershipConflictsByEmails(
  executeQuery: typeof query,
  emails: string[],
  excludeProjectId?: string,
) {
  if (emails.length === 0) return [] as ProjectMembershipConflictRow[];

  const normalizedEmails = emails.map((email) => email.trim().toLowerCase()).filter(Boolean);

  if (normalizedEmails.length === 0) return [] as ProjectMembershipConflictRow[];

  const values: unknown[] = [normalizedEmails];
  const excludeClause = excludeProjectId
    ? (() => {
      values.push(excludeProjectId);
      return `and pm.project_id <> $${values.length}`;
    })()
    : '';

  const result = await executeQuery<ProjectMembershipConflictRow>(
    `
    select
      pm.user_id,
      pm.project_id as current_project_id,
      p.name as current_project_name,
      lobehub_admin.user_display_name(pm.user_id) as display_name,
      u.email,
      pm.role
    from lobehub_admin.project_members pm
    join lobehub_admin.projects p
      on p.id = pm.project_id
    join public.users u
      on u.id = pm.user_id
    where lower(coalesce(u.email, '')) = any($1::text[])
      ${excludeClause}
      and not exists (
        select 1
        from lobehub_admin.system_admins sa
        where sa.user_id = pm.user_id
      )
    order by pm.joined_at asc
    `,
    values,
  );

  return result.rows;
}

function throwProjectMembershipConflicts(conflicts: ProjectMembershipConflictRow[]) {
  if (conflicts.length === 0) return;

  const summary = conflicts
    .slice(0, 3)
    .map((conflict) => `${conflict.display_name} -> ${conflict.current_project_name}`)
    .join('；');

  throw memberMutationError(`以下账号已绑定其他项目，请先移除原项目绑定：${summary}`);
}

function parsePluginIdentifiers(value: unknown) {
  if (!Array.isArray(value)) return [];

  const identifiers = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(identifiers)];
}

function buildAssistantBindingLookupKey(userId: string, identifier: string) {
  return `${userId}:${identifier}`;
}

async function fetchAssistantBindingLookup(
  executeQuery: typeof query,
  requestedIdentifiersByUser: Map<string, Set<string>>,
) {
  const requestedUserIds = [...requestedIdentifiersByUser.keys()];
  const requestedIdentifiers = [...new Set(
    [...requestedIdentifiersByUser.values()].flatMap((identifiers) => [...identifiers]),
  )];
  const bindingLookup = new Map<string, MemberAssistantSkillLookupRow>();

  if (requestedUserIds.length === 0 || requestedIdentifiers.length === 0) {
    return bindingLookup;
  }

  const [skillResult, pluginResult] = await Promise.all([
    executeQuery<MemberAssistantSkillLookupRow>(
      `
      select
        s.user_id,
        s.id,
        s.name,
        s.description,
        s.identifier,
        s.source,
        s.updated_at,
        'skill'::text as kind,
        null::text as plugin_type
      from public.agent_skills s
      where s.user_id = any($1::text[])
        and s.identifier = any($2::text[])
      `,
      [requestedUserIds, requestedIdentifiers],
    ),
    executeQuery<MemberAssistantSkillLookupRow>(
      `
      select
        p.user_id,
        'plugin:' || p.identifier as id,
        coalesce(nullif(btrim(p.manifest->'meta'->>'title'), ''), p.identifier) as name,
        nullif(btrim(p.manifest->'meta'->>'description'), '') as description,
        p.identifier,
        p.source,
        p.updated_at,
        'plugin'::text as kind,
        p.type as plugin_type
      from public.user_installed_plugins p
      where p.user_id = any($1::text[])
        and p.identifier = any($2::text[])
      `,
      [requestedUserIds, requestedIdentifiers],
    ),
  ]);

  for (const row of skillResult.rows) {
    if (!row.identifier) continue;
    bindingLookup.set(buildAssistantBindingLookupKey(row.user_id, row.identifier), row);
  }

  for (const row of pluginResult.rows) {
    if (!row.identifier) continue;

    const lookupKey = buildAssistantBindingLookupKey(row.user_id, row.identifier);

    if (!bindingLookup.has(lookupKey)) {
      bindingLookup.set(lookupKey, row);
    }
  }

  return bindingLookup;
}

function buildAssistantBindings(
  userId: string,
  pluginIdentifiers: string[],
  bindingLookup: Map<string, MemberAssistantSkillLookupRow>,
) {
  const matchedIdentifiers = new Set<string>();
  const skills: MemberAssistantSummary['skills'] = [];

  for (const identifier of pluginIdentifiers) {
    const binding = bindingLookup.get(buildAssistantBindingLookupKey(userId, identifier));

    if (!binding) continue;

    matchedIdentifiers.add(identifier);
    skills.push({
      id: binding.id,
      kind: binding.kind,
      name: binding.name,
      description: binding.description,
      identifier: binding.identifier,
      pluginType: binding.plugin_type,
      source: binding.source,
      updatedAt: binding.updated_at,
    });
  }

  return {
    skills: skills ?? [],
    unresolvedPluginIdentifiers: pluginIdentifiers.filter((identifier) => !matchedIdentifiers.has(identifier)),
  };
}

async function fetchProjectAssistantDetail(projectId: string, userId: string, assistantId: string) {
  const assistantResult = await query<MemberAssistantDetailRow>(
    `
    select
      a.id,
      a.user_id,
      a.title,
      a.slug,
      a.description,
      a.updated_at,
      a.model,
      a.provider,
      a.system_role,
      a.opening_message,
      a.opening_questions,
      a.chat_config,
      a.params,
      a.plugins,
      (pma.managed_agent_id is not null) as is_project_managed,
      pma.last_status as managed_status
    from lobehub_admin.project_members pm
    join public.agents a
      on a.user_id = pm.user_id
    left join lobehub_admin.project_managed_agents pma
      on pma.project_id = pm.project_id
     and pma.user_id = pm.user_id
     and pma.managed_agent_id = a.id
    where pm.project_id = $1
      and pm.user_id = $2
      and a.id = $3
      and coalesce(a.slug, '') <> all($4::text[])
    limit 1
    `,
    [projectId, userId, assistantId, EXCLUDED_AGENT_SLUGS],
  );

  const assistant = assistantResult.rows[0];

  if (!assistant) {
    const error = new Error(`Assistant not found for member: ${assistantId}`);
    (error as Error & { statusCode?: number }).statusCode = 404;
    throw error;
  }

  const pluginIdentifiers = parsePluginIdentifiers(assistant.plugins);
  const requestedIdentifiersByUser = new Map<string, Set<string>>();

  if (pluginIdentifiers.length > 0) {
    requestedIdentifiersByUser.set(assistant.user_id, new Set(pluginIdentifiers));
  }

  const bindingLookup = await fetchAssistantBindingLookup(query, requestedIdentifiersByUser);
  const bindingState = buildAssistantBindings(assistant.user_id, pluginIdentifiers, bindingLookup);

  return {
    assistant: {
      id: assistant.id,
      userId: assistant.user_id,
      title: assistant.title,
      slug: assistant.slug,
      description: assistant.description,
      updatedAt: assistant.updated_at,
      model: assistant.model,
      provider: assistant.provider,
      systemRole: assistant.system_role,
      openingMessage: assistant.opening_message,
      openingQuestions: Array.isArray(assistant.opening_questions) ? assistant.opening_questions : [],
      chatConfig: assistant.chat_config,
      params: assistant.params,
      pluginIdentifiers,
      unresolvedPluginIdentifiers: bindingState.unresolvedPluginIdentifiers,
      isProjectManaged: assistant.is_project_managed,
      managedStatus: assistant.managed_status,
      skills: bindingState.skills,
    },
  };
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
    actorRole: row.actor_role,
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
        'system_admin'::text as actor_role,
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
      pm_actor.role as actor_role,
      count(*) filter (where pm.role = 'admin')::text as admin_count,
      count(*) filter (where pm.role = 'member')::text as member_count
    from lobehub_admin.projects p
    join lobehub_admin.project_members pm_actor
      on pm_actor.project_id = p.id
     and pm_actor.user_id = $1
    left join lobehub_admin.project_members pm on pm.project_id = p.id
    group by p.id, pm_actor.role
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
    const conflicts = await findProjectMembershipConflicts(query, body.adminUserIds);
    throwProjectMembershipConflicts(conflicts);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<{ project_id: string }>(
        'select lobehub_admin.create_project($1, $2, $3, $4) as project_id',
        [body.name, body.description ?? null, actor.id, body.adminUserIds],
      );

      const projectId = result.rows[0]?.project_id;
      let seededDocumentCount = 0;

      if (projectId) {
        const seedResult = await seedDefaultProjectDocuments(client, projectId, body.name, actor.id);
        seededDocumentCount = seedResult.createdDocumentCount;
        await syncProjectDocumentPlugin(client, projectId);
      }

      await client.query('commit');

      return reply.code(201).send({
        projectId,
        seededDocumentCount,
      });
    } catch (error) {
      await client.query('rollback');
      const message = (error as Error).message;

      if (message.includes('already bound to another project')) {
        throw memberMutationError('目标账号已绑定其他项目，请先移除原项目绑定');
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/projects/:projectId', async (request) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    const projectAccess = await ensureProjectMember(actor.id, params.projectId);

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
      project: result.rows[0]
        ? mapProjectRow({
          ...result.rows[0],
          actor_role: projectAccess.projectRole,
        })
        : null,
    };
  });

  app.delete('/api/projects/:projectId', async (request, reply) => {
    const actor = await requireActor(request);

    if (!actor.isSystemAdmin) {
      throw projectAccessError('Only system admins can delete projects');
    }

    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);

    const client = await db.connect();

    try {
      await client.query('begin');

      const memberResult = await client.query<{ user_id: string }>(
        `
        select user_id
        from lobehub_admin.project_members
        where project_id = $1
        `,
        [params.projectId],
      );

      await removeKnowledgePluginForUsers(client, memberResult.rows.map((row) => row.user_id));

      const result = await client.query<{ id: string }>(
        'delete from lobehub_admin.projects where id = $1 returning id',
        [params.projectId],
      );

      if (!result.rows[0]) {
        await client.query('rollback');
        return reply.code(404).send({ message: 'Project not found' });
      }

      await client.query('commit');
      return reply.code(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
      project_managed_updated_at: string | null;
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
        pma.last_message as project_managed_message,
        pma.provisioned_at as project_managed_updated_at
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
        description: string | null;
        model: string | null;
        provider: string | null;
        system_role: string | null;
        opening_message: string | null;
        opening_questions: string[] | null;
        chat_config: unknown | null;
        params: unknown | null;
        plugins: unknown;
      }>(
        `
        select
          a.user_id,
          a.id as agent_id,
          a.title,
          a.slug,
          a.updated_at,
          a.description,
          a.model,
          a.provider,
          a.system_role,
          a.opening_message,
          a.opening_questions,
          a.chat_config,
          a.params,
          a.plugins,
          (pma.managed_agent_id is not null) as is_project_managed,
          pma.last_status as managed_status
        from public.agents a
        left join lobehub_admin.project_managed_agents pma
          on pma.project_id = $1
         and pma.user_id = a.user_id
         and pma.managed_agent_id = a.id
        where a.user_id = any($2::text[])
          and coalesce(a.slug, '') <> all($3::text[])
        order by
          a.user_id asc,
          case when pma.managed_agent_id is not null then 0 else 1 end,
          a.updated_at desc
        `,
        [params.projectId, userIds, EXCLUDED_AGENT_SLUGS],
      );

      const pluginIdentifiersByAssistant = new Map<string, string[]>();
      const requestedSkillIdentifiersByUser = new Map<string, Set<string>>();

      for (const row of assistantResult.rows) {
        const pluginIdentifiers = parsePluginIdentifiers(row.plugins);
        pluginIdentifiersByAssistant.set(`${row.user_id}:${row.agent_id}`, pluginIdentifiers);

        if (pluginIdentifiers.length === 0) continue;

        const current = requestedSkillIdentifiersByUser.get(row.user_id) ?? new Set<string>();

        for (const identifier of pluginIdentifiers) {
          current.add(identifier);
        }

        requestedSkillIdentifiersByUser.set(row.user_id, current);
      }

      const bindingLookup = await fetchAssistantBindingLookup(query, requestedSkillIdentifiersByUser);

      for (const row of assistantResult.rows) {
        const pluginIdentifiers = pluginIdentifiersByAssistant.get(`${row.user_id}:${row.agent_id}`) ?? [];
        const bindingState = buildAssistantBindings(row.user_id, pluginIdentifiers, bindingLookup);
        const current = assistantsByUser.get(row.user_id) ?? [];
        current.push({
          id: row.agent_id,
          title: row.title,
          slug: row.slug,
          updatedAt: row.updated_at,
          isProjectManaged: row.is_project_managed,
          managedStatus: row.managed_status,
          description: row.description,
          model: row.model,
          provider: row.provider,
          systemRole: row.system_role,
          openingMessage: row.opening_message,
          openingQuestions: Array.isArray(row.opening_questions) ? row.opening_questions : [],
          chatConfig: row.chat_config,
          params: row.params,
          pluginIdentifiers,
          unresolvedPluginIdentifiers: bindingState.unresolvedPluginIdentifiers,
          skills: bindingState.skills,
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
        projectManagedUpdatedAt: row.project_managed_updated_at,
      };

      if (row.role === 'admin') {
        admins.push(item);
      } else {
        members.push(item);
      }
    }

    return { admins, members };
  });

  app.get('/api/assistant-detail', async (request) => {
    const actor = await requireActor(request);
    const queryParams = z
      .object({
        projectId: z.string().min(1),
        userId: z.string().min(1),
        assistantId: z.string().min(1),
      })
      .parse(request.query);

    await ensureProjectAdmin(actor.id, queryParams.projectId);
    return fetchProjectAssistantDetail(queryParams.projectId, queryParams.userId, queryParams.assistantId);
  });

  app.post('/api/projects/:projectId/members', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = addMembersSchema.parse(request.body);

    await ensureProjectAdmin(actor.id, params.projectId);

    const client = await db.connect();

    try {
      await client.query('begin');
      const conflicts = await findProjectMembershipConflictsByEmails(client.query.bind(client) as typeof query, body.emails, params.projectId);
      throwProjectMembershipConflicts(conflicts);

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

      await syncProjectDocumentPlugin(client, params.projectId);
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
      const message = (error as Error).message;

      if (message.includes('already bound to another project')) {
        throw memberMutationError('目标账号已绑定其他项目，请先移除原项目绑定');
      }

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

      await syncProjectDocumentPlugin(client, params.projectId);
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

      await removeKnowledgePluginForUsers(client, [params.userId]);
      await syncProjectDocumentPlugin(client, params.projectId);
      await client.query('commit');
      return reply.code(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/projects/:projectId/members/:userId/provision', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z
      .object({
        projectId: z.string().min(1),
        userId: z.string().min(1),
      })
      .parse(request.params);
    const body = runProvisionSchema.parse(request.body ?? {});

    await ensureProjectAdmin(actor.id, params.projectId);

    const memberResult = await query<{ role: 'admin' | 'member' }>(
      `
      select role
      from lobehub_admin.project_members
      where project_id = $1
        and user_id = $2
      limit 1
      `,
      [params.projectId, params.userId],
    );

    const member = memberResult.rows[0];

    if (!member) {
      return reply.code(404).send({ message: 'Member not found' });
    }

    if (member.role !== 'member') {
      throw memberMutationError('只能为项目成员执行助手重试配置');
    }

    const jobId = await enqueueProvisionJobForUsers(
      params.projectId,
      'refresh',
      actor.id,
      body.setDefaultAgent,
      [params.userId],
    );

    if (!jobId) {
      throw new Error('Failed to create provision job');
    }

    scheduleProvisionJob(jobId, app.log);

    return reply.code(202).send({
      jobId,
    });
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
        adminUserId: z.string().min(1).optional(),
        userId: z.string().min(1).optional(),
        agentId: z.string().min(1).optional(),
      })
      .parse(request.query);

    await ensureProjectAdmin(actor.id, params.projectId);

    if (queryParams.userId || queryParams.agentId) {
      if (!queryParams.userId || !queryParams.agentId) {
        const error = new Error('userId and agentId are required when querying assistant detail');
        (error as Error & { statusCode?: number }).statusCode = 400;
        throw error;
      }

      return fetchProjectAssistantDetail(params.projectId, queryParams.userId, queryParams.agentId);
    }

    if (!queryParams.adminUserId) {
      return {
        agents: [],
      };
    }

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
      attached_plugin_count: number;
      has_project_knowledge_plugin: boolean;
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
        ) as skill_count,
        case
          when jsonb_typeof(a.plugins) = 'array' then jsonb_array_length(a.plugins)
          else 0
        end as attached_plugin_count,
        coalesce(a.plugins ? $2, false) as has_project_knowledge_plugin
      from public.agents a
      where a.user_id::text = $1::text
        and a.title is not null
        and btrim(a.title) <> ''
        and (a.slug is null or a.slug not in ('inbox', 'page-agent', 'agent-builder', 'group-agent-builder'))
      order by a.updated_at desc
      `,
      [queryParams.adminUserId, buildKnowledgePluginIdentifier()],
    );

    return {
      agents: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        slug: row.slug,
        updatedAt: row.updated_at,
        skillCount: Number(row.skill_count),
        attachedPluginCount: Number(row.attached_plugin_count ?? 0),
        hasProjectKnowledgePlugin: Boolean(row.has_project_knowledge_plugin),
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
      await syncProjectDocumentPlugin(query as any, params.projectId);
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

    const jobId = await enqueueProvisionJob(
      params.projectId,
      'configure',
      actor.id,
      body.setDefaultAgent,
    );

    if (!jobId) {
      throw new Error('Failed to create provision job');
    }

    scheduleProvisionJob(jobId, app.log);

    return reply.code(202).send({
      jobId,
    });
  });

  app.post('/api/projects/:projectId/provision/refresh', async (request, reply) => {
    const actor = await requireActor(request);
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = runProvisionSchema.parse(request.body ?? {});

    await ensureProjectAdmin(actor.id, params.projectId);

    const jobId = await enqueueProvisionJob(
      params.projectId,
      'refresh',
      actor.id,
      body.setDefaultAgent,
    );

    if (!jobId) {
      throw new Error('Failed to create provision job');
    }

    scheduleProvisionJob(jobId, app.log);

    return reply.code(202).send({
      jobId,
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
