import { createHmac } from 'node:crypto';

import type { QueryResultRow } from 'pg';

import { env } from './config.js';

type QueryRunner = <T extends QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: T[] }>;

type Queryable =
  | QueryRunner
  | {
    query: QueryRunner;
  };

type ProjectInfoRow = {
  project_id: string;
  project_name: string;
  template_user_id: string | null;
  template_agent_id: string | null;
};

type ProjectManagedAgentRow = {
  id: string;
  user_id: string;
  plugins: unknown;
};

type ProjectMemberUserRow = {
  user_id: string;
};

const EXCLUDED_AGENT_SLUGS = ['inbox', 'page-agent', 'agent-builder', 'group-agent-builder'];
const KNOWLEDGE_PLUGIN_IDENTIFIER = 'lobehub-admin.knowledge';
const LEGACY_PROJECT_KNOWLEDGE_PREFIX = 'lobehub-admin.project-knowledge.';
const LEGACY_PROJECT_SKILL_PREFIX = 'lobehub-admin.project-docs.';
const LEGACY_PROJECT_SKILL_NAME_PREFIX = 'project-docs-';

export type ProjectDocumentPluginSyncResult = {
  documentCount: number;
  managedAgentCount: number;
  pluginIdentifier: string;
  projectId: string;
  publicBaseUrl: string | null;
  skipped: boolean;
  skippedReason: string | null;
  templateAgentId: string | null;
  templateUserId: string | null;
  updatedPluginUserCount: number;
};

async function runQuery<T extends QueryResultRow>(
  executeQuery: Queryable,
  text: string,
  values?: unknown[],
) {
  if (typeof executeQuery === 'function') {
    return executeQuery<T>(text, values);
  }

  return executeQuery.query<T>(text, values);
}

function normalizePluginIdentifiers(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function serializePluginIdentifiers(identifiers: string[]) {
  return JSON.stringify([...new Set(identifiers.filter(Boolean))]);
}

function buildPluginIdentifiersValue(existing: unknown, identifier: string) {
  const identifiers = normalizePluginIdentifiers(existing);

  if (!identifiers.includes(identifier)) {
    identifiers.push(identifier);
  }

  return serializePluginIdentifiers(identifiers);
}

function removePluginIdentifiersValue(
  existing: unknown,
  predicate: (identifier: string) => boolean,
) {
  return serializePluginIdentifiers(
    normalizePluginIdentifiers(existing).filter((identifier) => !predicate(identifier)),
  );
}

function removePluginIdentifierValue(existing: unknown, identifier: string) {
  return removePluginIdentifiersValue(existing, (item) => item === identifier);
}

function normalizeKnowledgePluginAgentState(existing: unknown) {
  return removePluginIdentifiersValue(
    existing,
    (identifier) => identifier.startsWith(LEGACY_PROJECT_KNOWLEDGE_PREFIX),
  );
}

export function buildKnowledgePluginIdentifier() {
  return KNOWLEDGE_PLUGIN_IDENTIFIER;
}

export function buildProjectKnowledgePluginIdentifier(projectId: string) {
  return `${LEGACY_PROJECT_KNOWLEDGE_PREFIX}${projectId}`;
}

function buildLegacyProjectSkillName(projectId: string) {
  return `${LEGACY_PROJECT_SKILL_NAME_PREFIX}${projectId}`;
}

function buildLegacyProjectSkillIdentifier(projectId: string) {
  return `${LEGACY_PROJECT_SKILL_PREFIX}${projectId}`;
}

function buildScopedSignature(scopeKey: string) {
  if (!env.PROJECT_DOCS_PLUGIN_SECRET) {
    throw new Error('PROJECT_DOCS_PLUGIN_SECRET is not configured');
  }

  return createHmac('sha256', env.PROJECT_DOCS_PLUGIN_SECRET).update(scopeKey).digest('hex');
}

function buildKnowledgePluginSignature(userId: string) {
  return buildScopedSignature(`knowledge:${userId}`);
}

function buildProjectKnowledgePluginSignature(projectId: string) {
  return buildScopedSignature(`project:${projectId}`);
}

export function verifyKnowledgePluginSignature(userId: string, signature: string) {
  return signature === buildKnowledgePluginSignature(userId);
}

export function verifyProjectKnowledgePluginSignature(projectId: string, signature: string) {
  return signature === buildProjectKnowledgePluginSignature(projectId);
}

function getPluginPublicBaseUrl() {
  const value = env.PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

function buildKnowledgePluginApiDefinitions(
  userId: string,
  signature: string,
  projectName: string,
  projectDocumentCount: number,
  globalDocumentCount: number,
  publicBaseUrl: string,
) {
  const baseUrl = `${publicBaseUrl}/public/knowledge/${userId}/${signature}`;
  const totalDocumentCount = projectDocumentCount + globalDocumentCount;

  return [
    {
      description:
        totalDocumentCount <= 1
          ? `Answer any project question for ${projectName} using the current project knowledge and shared global knowledge. Use this first before any other knowledge or web search.`
          : `Answer any project question for ${projectName} using the current project knowledge and shared global knowledge. Use this first before any other knowledge or web search.`,
      name: 'queryKnowledge',
      parameters: {
        properties: {
          question: {
            description: 'The user question about the current project.',
            type: 'string',
          },
        },
        required: ['question'],
        type: 'object',
      },
      url: `${baseUrl}/query`,
    },
  ];
}

function createKnowledgePluginManifest(
  userId: string,
  projectName: string,
  projectDocumentCount: number,
  globalDocumentCount: number,
  publicBaseUrl: string,
) {
  const signature = buildKnowledgePluginSignature(userId);

  return {
    api: buildKnowledgePluginApiDefinitions(
      userId,
      signature,
      projectName,
      projectDocumentCount,
      globalDocumentCount,
      publicBaseUrl,
    ),
    identifier: buildKnowledgePluginIdentifier(),
    meta: {
      avatar: '知识',
      description: `当前项目与全局共享知识：${projectName}`,
      title: '统一知识库',
    },
    type: 'default',
    version: '1',
  };
}

async function fetchProjectInfo(executeQuery: Queryable, projectId: string) {
  const result = await runQuery<ProjectInfoRow>(
    executeQuery,
    `
    select
      p.id as project_id,
      p.name as project_name,
      pt.template_user_id,
      pt.template_agent_id
    from lobehub_admin.projects p
    left join lobehub_admin.project_templates pt
      on pt.project_id = p.id
    where p.id = $1
    limit 1
    `,
    [projectId],
  );

  return result.rows[0] ?? null;
}

async function fetchPublishedProjectDocumentCount(executeQuery: Queryable, projectId: string) {
  const result = await runQuery<{ count: string }>(
    executeQuery,
    `
    select count(*)::text as count
    from lobehub_admin.project_documents
    where project_id = $1
      and status = 'published'
    `,
    [projectId],
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function fetchPublishedGlobalDocumentCount(executeQuery: Queryable) {
  const result = await runQuery<{ count: string }>(
    executeQuery,
    `
    select count(*)::text as count
    from lobehub_admin.global_documents
    where status = 'published'
    `,
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function fetchTargetUsers(executeQuery: Queryable, projectId: string) {
  const result = await runQuery<ProjectMemberUserRow>(
    executeQuery,
    `
    select user_id
    from lobehub_admin.project_members
    where project_id = $1
    order by joined_at asc
    `,
    [projectId],
  );

  return [...new Set(result.rows.map((row) => row.user_id))];
}

async function fetchAgentsForUsers(executeQuery: Queryable, userIds: string[]) {
  if (userIds.length === 0) return [] as ProjectManagedAgentRow[];

  const result = await runQuery<ProjectManagedAgentRow>(
    executeQuery,
    `
    select
      a.id,
      a.user_id,
      a.plugins
    from public.agents a
    where a.user_id = any($1::text[])
      and coalesce(a.slug, '') <> all($2::text[])
    order by a.user_id asc, a.updated_at desc
    `,
    [userIds, EXCLUDED_AGENT_SLUGS],
  );

  return result.rows;
}

async function fetchTargetAgents(executeQuery: Queryable, projectId: string) {
  const users = await fetchTargetUsers(executeQuery, projectId);
  return fetchAgentsForUsers(executeQuery, users);
}

async function upsertInstalledPluginForUsers(
  executeQuery: Queryable,
  installations: Array<{ manifest: Record<string, unknown>; userId: string }>,
  identifier: string,
) {
  for (const installation of installations) {
    await runQuery(
      executeQuery,
      `
      insert into public.user_installed_plugins (
        user_id,
        identifier,
        type,
        manifest,
        settings,
        custom_params,
        created_at,
        updated_at,
        accessed_at,
        source
      )
      values (
        $1,
        $2,
        'customPlugin',
        $3::jsonb,
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        now(),
        'lobehub-admin'
      )
      on conflict (user_id, identifier) do update
      set
        type = excluded.type,
        manifest = excluded.manifest,
        settings = excluded.settings,
        custom_params = excluded.custom_params,
        updated_at = now(),
        accessed_at = now(),
        source = excluded.source
      `,
      [installation.userId, identifier, JSON.stringify(installation.manifest)],
    );
  }
}

async function removeInstalledPluginForUsers(
  executeQuery: Queryable,
  users: string[],
  identifier: string,
) {
  if (users.length === 0) return;

  await runQuery(
    executeQuery,
    `
    delete from public.user_installed_plugins
    where user_id = any($1::text[])
      and identifier = $2
    `,
    [users, identifier],
  );
}

async function removeLegacyProjectInstalledPluginsForUsers(
  executeQuery: Queryable,
  users: string[],
) {
  if (users.length === 0) return;

  await runQuery(
    executeQuery,
    `
    delete from public.user_installed_plugins
    where user_id = any($1::text[])
      and identifier like $2
    `,
    [users, `${LEGACY_PROJECT_KNOWLEDGE_PREFIX}%`],
  );
}

async function ensureAgentPlugins(
  executeQuery: Queryable,
  agents: ProjectManagedAgentRow[],
  identifier: string,
) {
  for (const agent of agents) {
    await runQuery(
      executeQuery,
      `
      update public.agents
      set
        plugins = $2::jsonb,
        updated_at = now()
      where id = $1
      `,
      [agent.id, buildPluginIdentifiersValue(agent.plugins, identifier)],
    );
  }
}

async function removeAgentPlugins(
  executeQuery: Queryable,
  agents: ProjectManagedAgentRow[],
  identifier: string,
) {
  for (const agent of agents) {
    await runQuery(
      executeQuery,
      `
      update public.agents
      set
        plugins = $2::jsonb,
        updated_at = now()
      where id = $1
      `,
      [agent.id, removePluginIdentifierValue(agent.plugins, identifier)],
    );
  }
}

async function removeLegacyProjectPluginsFromAgents(
  executeQuery: Queryable,
  agents: ProjectManagedAgentRow[],
) {
  for (const agent of agents) {
    await runQuery(
      executeQuery,
      `
      update public.agents
      set
        plugins = $2::jsonb,
        updated_at = now()
      where id = $1
      `,
      [agent.id, normalizeKnowledgePluginAgentState(agent.plugins)],
    );
  }
}

async function removeLegacyProjectSkills(
  executeQuery: Queryable,
  users: string[],
  projectId: string,
) {
  if (users.length === 0) return;

  await runQuery(
    executeQuery,
    `
    delete from public.agent_skills
    where user_id = any($1::text[])
      and (
        name = $2
        or identifier = $3
      )
    `,
    [users, buildLegacyProjectSkillName(projectId), buildLegacyProjectSkillIdentifier(projectId)],
  );
}

async function removeAllLegacyProjectSkillsForUsers(
  executeQuery: Queryable,
  users: string[],
) {
  if (users.length === 0) return;

  await runQuery(
    executeQuery,
    `
    delete from public.agent_skills
    where user_id = any($1::text[])
      and (
        name like $2
        or identifier like $3
      )
    `,
    [users, `${LEGACY_PROJECT_SKILL_NAME_PREFIX}%`, `${LEGACY_PROJECT_SKILL_PREFIX}%`],
  );
}

export async function removeKnowledgePluginForUsers(
  executeQuery: Queryable,
  users: string[],
) {
  if (users.length === 0) return;

  const userAgents = await fetchAgentsForUsers(executeQuery, users);

  await removeInstalledPluginForUsers(executeQuery, users, buildKnowledgePluginIdentifier());
  await removeLegacyProjectInstalledPluginsForUsers(executeQuery, users);
  await removeAgentPlugins(executeQuery, userAgents, buildKnowledgePluginIdentifier());
  await removeLegacyProjectPluginsFromAgents(executeQuery, userAgents);
  await removeAllLegacyProjectSkillsForUsers(executeQuery, users);
}

async function fetchProjectIdsWithMembers(executeQuery: Queryable) {
  const result = await runQuery<{ project_id: string }>(
    executeQuery,
    `
    select distinct pm.project_id
    from lobehub_admin.project_members pm
    order by pm.project_id asc
    `,
  );

  return result.rows.map((row) => row.project_id);
}

export async function syncKnowledgePluginsForAllProjects(executeQuery: Queryable) {
  const projectIds = await fetchProjectIdsWithMembers(executeQuery);
  const results: ProjectDocumentPluginSyncResult[] = [];

  for (const projectId of projectIds) {
    results.push(await syncProjectDocumentPlugin(executeQuery, projectId));
  }

  return results;
}

export async function syncProjectDocumentPlugin(
  executeQuery: Queryable,
  projectId: string,
): Promise<ProjectDocumentPluginSyncResult> {
  const project = await fetchProjectInfo(executeQuery, projectId);
  const identifier = buildKnowledgePluginIdentifier();
  const publicBaseUrl = getPluginPublicBaseUrl();

  if (!project) {
    return {
      documentCount: 0,
      managedAgentCount: 0,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: true,
      skippedReason: 'project-not-found',
      templateAgentId: null,
      templateUserId: null,
      updatedPluginUserCount: 0,
    };
  }

  if (!publicBaseUrl || !env.PROJECT_DOCS_PLUGIN_SECRET) {
    return {
      documentCount: 0,
      managedAgentCount: 0,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: true,
      skippedReason: 'plugin-public-url-or-secret-not-configured',
      templateAgentId: project.template_agent_id,
      templateUserId: project.template_user_id,
      updatedPluginUserCount: 0,
    };
  }

  const targetUsers = await fetchTargetUsers(executeQuery, projectId);
  const targetAgents = await fetchTargetAgents(executeQuery, projectId);
  const projectDocumentCount = await fetchPublishedProjectDocumentCount(executeQuery, projectId);
  const globalDocumentCount = await fetchPublishedGlobalDocumentCount(executeQuery);
  const normalizedTargetAgents = targetAgents.map((agent) => ({
    ...agent,
    plugins: normalizeKnowledgePluginAgentState(agent.plugins),
  }));

  await removeLegacyProjectSkills(executeQuery, targetUsers, projectId);
  await removeInstalledPluginForUsers(executeQuery, targetUsers, buildProjectKnowledgePluginIdentifier(projectId));
  await removeAgentPlugins(executeQuery, targetAgents, buildProjectKnowledgePluginIdentifier(projectId));
  await removeLegacyProjectInstalledPluginsForUsers(executeQuery, targetUsers);
  await removeLegacyProjectPluginsFromAgents(executeQuery, targetAgents);

  const totalDocumentCount = projectDocumentCount + globalDocumentCount;

  if (totalDocumentCount === 0) {
    await removeInstalledPluginForUsers(executeQuery, targetUsers, identifier);
    await removeAgentPlugins(executeQuery, normalizedTargetAgents, identifier);

    return {
      documentCount: totalDocumentCount,
      managedAgentCount: targetAgents.length,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: false,
      skippedReason: null,
      templateAgentId: project.template_agent_id,
      templateUserId: project.template_user_id,
      updatedPluginUserCount: 0,
    };
  }

  await upsertInstalledPluginForUsers(
    executeQuery,
    targetUsers.map((userId) => ({
      manifest: createKnowledgePluginManifest(
        userId,
        project.project_name,
        projectDocumentCount,
        globalDocumentCount,
        publicBaseUrl,
      ),
      userId,
    })),
    identifier,
  );
  await ensureAgentPlugins(executeQuery, normalizedTargetAgents, identifier);

  return {
    documentCount: totalDocumentCount,
    managedAgentCount: targetAgents.length,
    pluginIdentifier: identifier,
    projectId,
    publicBaseUrl,
    skipped: false,
    skippedReason: null,
    templateAgentId: project.template_agent_id,
    templateUserId: project.template_user_id,
    updatedPluginUserCount: targetUsers.length,
  };
}
