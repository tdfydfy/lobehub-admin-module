import { createHmac } from 'node:crypto';

import type { QueryResultRow } from 'pg';

import { env } from './config.js';

type Queryable = {
  query: <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

type ProjectTemplateRow = {
  project_id: string;
  project_name: string;
  template_user_id: string | null;
  template_agent_id: string | null;
};

type ProjectDocumentRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  is_entry: boolean;
  sort_order: number;
  updated_at: string;
};

type ProjectManagedAgentRow = {
  id: string;
  user_id: string;
  plugins: unknown;
};

type ProjectMemberUserRow = {
  user_id: string;
};

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

function normalizePluginIdentifiers(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function buildPluginIdentifiersValue(existing: unknown, identifier: string) {
  const identifiers = normalizePluginIdentifiers(existing);

  if (!identifiers.includes(identifier)) {
    identifiers.push(identifier);
  }

  return JSON.stringify(identifiers);
}

function removePluginIdentifierValue(existing: unknown, identifier: string) {
  const identifiers = normalizePluginIdentifiers(existing).filter((item) => item !== identifier);
  return JSON.stringify(identifiers);
}

export function buildProjectKnowledgePluginIdentifier(projectId: string) {
  return `lobehub-admin.project-knowledge.${projectId}`;
}

function buildLegacyProjectSkillName(projectId: string) {
  return `project-docs-${projectId}`;
}

function buildLegacyProjectSkillIdentifier(projectId: string) {
  return `lobehub-admin.project-docs.${projectId}`;
}

function buildPluginSignature(projectId: string) {
  if (!env.PROJECT_DOCS_PLUGIN_SECRET) {
    throw new Error('PROJECT_DOCS_PLUGIN_SECRET is not configured');
  }

  return createHmac('sha256', env.PROJECT_DOCS_PLUGIN_SECRET).update(projectId).digest('hex');
}

function buildProjectKnowledgeApiDefinitions(
  projectId: string,
  signature: string,
  projectName: string,
  documentCount: number,
  publicBaseUrl: string,
) {
  const baseUrl = `${publicBaseUrl}/public/project-knowledge/${projectId}/${signature}`;
  const apis: Array<Record<string, unknown>> = [
    {
      description:
        documentCount <= 1
          ? `Answer any project-specific question for ${projectName} using the shared project knowledge. Use this first before any other knowledge or web search. There is currently only one published project document, so this tool already includes the full available project knowledge.`
          : `Answer any project-specific question for ${projectName} using the shared project knowledge. Use this first before any other knowledge or web search.`,
      name: 'queryProjectKnowledge',
      parameters: {
        properties: {
          question: {
            description: 'The user question about the project.',
            type: 'string',
          },
        },
        required: ['question'],
        type: 'object',
      },
      url: `${baseUrl}/query`,
    },
  ];

  return apis;
}

export function verifyProjectKnowledgePluginSignature(projectId: string, signature: string) {
  return signature === buildPluginSignature(projectId);
}

function getPluginPublicBaseUrl() {
  const value = env.PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL?.trim();
  return value ? value.replace(/\/+$/, '') : null;
}

function buildPluginManifest(projectId: string, projectName: string) {
  const publicBaseUrl = getPluginPublicBaseUrl();

  if (!publicBaseUrl) return null;

  const identifier = buildProjectKnowledgePluginIdentifier(projectId);
  const signature = buildPluginSignature(projectId);
  return {
    identifier,
    publicBaseUrl,
    signature,
  };
}

function createPluginManifest(
  projectId: string,
  projectName: string,
  documentCount: number,
  publicBaseUrl: string,
  signature: string,
) {
  const identifier = buildProjectKnowledgePluginIdentifier(projectId);

  return {
    api: buildProjectKnowledgeApiDefinitions(
      projectId,
      signature,
      projectName,
      documentCount,
      publicBaseUrl,
    ),
    identifier,
    meta: {
      avatar: '📚',
      description: `Shared project knowledge for ${projectName}.`,
      title: `${projectName} Knowledge`,
    },
    type: 'default',
    version: '1',
  };
}

async function fetchProjectTemplate(executeQuery: Queryable, projectId: string) {
  const result = await executeQuery.query<ProjectTemplateRow>(
    `
    select
      pt.project_id,
      p.name as project_name,
      pt.template_user_id,
      pt.template_agent_id
    from lobehub_admin.project_templates pt
    join lobehub_admin.projects p
      on p.id = pt.project_id
    where pt.project_id = $1
    limit 1
    `,
    [projectId],
  );

  return result.rows[0] ?? null;
}

async function fetchPublishedDocuments(executeQuery: Queryable, projectId: string) {
  const result = await executeQuery.query<ProjectDocumentRow>(
    `
    select
      id,
      slug,
      title,
      description,
      content_md,
      is_entry,
      sort_order,
      updated_at
    from lobehub_admin.project_documents
    where project_id = $1
      and status = 'published'
    order by
      is_entry desc,
      sort_order asc,
      updated_at desc
    `,
    [projectId],
  );

  return result.rows;
}

async function fetchTargetUsers(executeQuery: Queryable, projectId: string, templateUserId: string) {
  const result = await executeQuery.query<ProjectMemberUserRow>(
    `
    select user_id
    from lobehub_admin.project_members
    where project_id = $1
      and role = 'member'
    order by joined_at asc
    `,
    [projectId],
  );

  return [...new Set([templateUserId, ...result.rows.map((row) => row.user_id)])];
}

async function fetchManagedAgents(executeQuery: Queryable, projectId: string, templateAgentId: string) {
  const result = await executeQuery.query<ProjectManagedAgentRow>(
    `
    select
      a.id,
      a.user_id,
      a.plugins
    from public.agents a
    where a.id = $2
    union all
    select
      a.id,
      a.user_id,
      a.plugins
    from lobehub_admin.project_managed_agents pma
    join public.agents a
      on a.id = pma.managed_agent_id
    where pma.project_id = $1
      and pma.managed_agent_id is not null
    `,
    [projectId, templateAgentId],
  );

  return result.rows;
}

async function upsertInstalledPluginForUsers(
  executeQuery: Queryable,
  users: string[],
  identifier: string,
  manifest: Record<string, unknown>,
) {
  for (const userId of users) {
    await executeQuery.query(
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
      [userId, identifier, JSON.stringify(manifest)],
    );
  }
}

async function removeInstalledPluginForUsers(
  executeQuery: Queryable,
  users: string[],
  identifier: string,
) {
  if (users.length === 0) return;

  await executeQuery.query(
    `
    delete from public.user_installed_plugins
    where user_id = any($1::text[])
      and identifier = $2
    `,
    [users, identifier],
  );
}

async function ensureAgentPlugins(
  executeQuery: Queryable,
  agents: ProjectManagedAgentRow[],
  identifier: string,
) {
  for (const agent of agents) {
    await executeQuery.query(
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
    await executeQuery.query(
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

async function removeLegacyProjectSkills(
  executeQuery: Queryable,
  users: string[],
  projectId: string,
) {
  if (users.length === 0) return;

  await executeQuery.query(
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

export async function syncProjectDocumentPlugin(
  executeQuery: Queryable,
  projectId: string,
): Promise<ProjectDocumentPluginSyncResult> {
  const template = await fetchProjectTemplate(executeQuery, projectId);
  const identifier = buildProjectKnowledgePluginIdentifier(projectId);
  const publicBaseUrl = getPluginPublicBaseUrl();

  if (!template?.template_user_id || !template.template_agent_id) {
    return {
      documentCount: 0,
      managedAgentCount: 0,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: true,
      skippedReason: 'template-not-configured',
      templateAgentId: template?.template_agent_id ?? null,
      templateUserId: template?.template_user_id ?? null,
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
      templateAgentId: template.template_agent_id,
      templateUserId: template.template_user_id,
      updatedPluginUserCount: 0,
    };
  }

  const documents = await fetchPublishedDocuments(executeQuery, projectId);
  const targetUsers = await fetchTargetUsers(executeQuery, projectId, template.template_user_id);
  const targetAgents = await fetchManagedAgents(executeQuery, projectId, template.template_agent_id);
  const legacySkillIdentifier = buildLegacyProjectSkillIdentifier(projectId);

  await removeLegacyProjectSkills(executeQuery, targetUsers, projectId);
  await removeAgentPlugins(executeQuery, targetAgents, legacySkillIdentifier);

  if (documents.length === 0) {
    await removeAgentPlugins(executeQuery, targetAgents, identifier);
    await removeInstalledPluginForUsers(executeQuery, targetUsers, identifier);

    return {
      documentCount: 0,
      managedAgentCount: targetAgents.length,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: false,
      skippedReason: null,
      templateAgentId: template.template_agent_id,
      templateUserId: template.template_user_id,
      updatedPluginUserCount: 0,
    };
  }

  const manifestContext = buildPluginManifest(projectId, template.project_name);

  if (!manifestContext) {
    return {
      documentCount: documents.length,
      managedAgentCount: targetAgents.length,
      pluginIdentifier: identifier,
      projectId,
      publicBaseUrl,
      skipped: true,
      skippedReason: 'manifest-build-failed',
      templateAgentId: template.template_agent_id,
      templateUserId: template.template_user_id,
      updatedPluginUserCount: 0,
    };
  }

  const manifest = createPluginManifest(
    projectId,
    template.project_name,
    documents.length,
    manifestContext.publicBaseUrl,
    manifestContext.signature,
  );

  await upsertInstalledPluginForUsers(executeQuery, targetUsers, identifier, manifest);
  await ensureAgentPlugins(executeQuery, targetAgents, identifier);

  return {
    documentCount: documents.length,
    managedAgentCount: targetAgents.length,
    pluginIdentifier: identifier,
    projectId,
    publicBaseUrl,
    skipped: false,
    skippedReason: null,
    templateAgentId: template.template_agent_id,
    templateUserId: template.template_user_id,
    updatedPluginUserCount: targetUsers.length,
  };
}
