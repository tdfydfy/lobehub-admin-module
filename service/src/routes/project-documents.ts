import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db, query } from '../db.js';
import {
  buildProjectKnowledgePluginIdentifier,
  syncProjectDocumentPlugin,
  verifyProjectKnowledgePluginSignature,
} from '../project-document-plugin.js';
import { z } from 'zod';
import { ensureProjectAdminRequest } from '../auth.js';
import { env } from '../config.js';

type ProjectDocumentStatus = 'draft' | 'published' | 'archived';

type ProjectDocumentRow = {
  id: string;
  project_id: string;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  status: ProjectDocumentStatus;
  sort_order: number;
  is_entry: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type GlobalDocumentRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  status: ProjectDocumentStatus;
  sort_order: number;
  is_entry: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectDocumentSearchRow = Pick<
  ProjectDocumentRow,
  'id' | 'project_id' | 'slug' | 'title' | 'description' | 'status' | 'sort_order' | 'is_entry' | 'content_md' | 'updated_at'
> & {
  rank_score: number | null;
};

type UnifiedKnowledgeDocument = {
  contentMd: string;
  createdAt: string;
  createdBy: string | null;
  description: string | null;
  id: string;
  isEntry: boolean;
  knowledgeScope: 'global' | 'project';
  projectId?: string;
  slug: string;
  sortOrder: number;
  status: ProjectDocumentStatus;
  title: string;
  updatedAt: string;
  updatedBy: string | null;
};

const documentStatusSchema = z.enum(['draft', 'published', 'archived']);

const createDocumentSchema = z.object({
  slug: z.string().trim().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  contentMd: z.string().default(''),
  status: documentStatusSchema.default('draft'),
  sortOrder: z.coerce.number().int().default(0),
  isEntry: z.boolean().default(false),
});

const updateDocumentSchema = createDocumentSchema;

const listDocumentsQuerySchema = z.object({
  status: z.enum(['all', 'draft', 'published', 'archived']).default('all'),
});

const internalSearchQuerySchema = z.object({
  projectId: z.string().min(1),
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

const internalContextQuerySchema = z.object({
  projectId: z.string().min(1),
});

const internalReadQuerySchema = z.object({
  projectId: z.string().min(1),
  documentId: z.string().optional(),
  slug: z.string().optional(),
}).superRefine((value, context) => {
  if (!value.documentId && !value.slug) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'documentId or slug is required',
      path: ['documentId'],
    });
  }
});

const publicPluginParamsSchema = z.object({
  projectId: z.string().min(1),
  signature: z.string().min(1),
});

const publicPluginSearchBodySchema = z.object({
  query: z.string().trim().min(1),
});

const publicPluginQueryBodySchema = z.object({
  question: z.string().trim().min(1),
});

const publicPluginReadBodySchema = z.object({
  documentId: z.string().trim().optional(),
  slug: z.string().trim().optional(),
}).superRefine((value, context) => {
  if (!value.documentId && !value.slug) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'documentId or slug is required',
      path: ['documentId'],
    });
  }
});

const publicPluginReadBodyLooseSchema = z.object({
  documentId: z.string().trim().optional(),
  slug: z.string().trim().optional(),
});

function normalizePublicPluginSearchInput(body: unknown) {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return { query: '' };

    try {
      const parsed = JSON.parse(trimmed);
      return publicPluginSearchBodySchema.partial().parse(parsed);
    } catch {
      return { query: trimmed };
    }
  }

  return publicPluginSearchBodySchema.partial().parse(body ?? {});
}

function normalizePublicPluginReadInput(body: unknown) {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return {};

    try {
      const parsed = JSON.parse(trimmed);
      return publicPluginReadBodyLooseSchema.parse(parsed);
    } catch {
      return { slug: trimmed };
    }
  }

  return publicPluginReadBodyLooseSchema.parse(body ?? {});
}

function normalizePublicPluginQuestionInput(body: unknown) {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) return { question: '' };

    try {
      const parsed = JSON.parse(trimmed);
      return publicPluginQueryBodySchema.partial().parse(parsed);
    } catch {
      return { question: trimmed };
    }
  }

  return publicPluginQueryBodySchema.partial().parse(body ?? {});
}

function createHttpError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeSlugPart(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildSlug(title: string, requestedSlug?: string) {
  const normalized = normalizeSlugPart(requestedSlug?.trim() || title);
  return normalized || `doc-${Date.now().toString(36)}`;
}

function stripMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExcerpt(markdown: string, limit = 200) {
  const text = stripMarkdown(markdown);

  if (!text) return '';
  if (text.length <= limit) return text;

  return `${text.slice(0, limit).trim()}...`;
}

function extractSearchTerms(question: string) {
  const normalized = question.trim();
  if (!normalized) return [] as string[];

  const terms = new Set<string>();
  terms.add(normalized);

  for (const token of normalized.split(/[\s,.;:!?/|，。；：！？、]+/)) {
    const clean = token.trim();
    if (clean.length >= 2) {
      terms.add(clean);
    }
  }

  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const chunk of cjk) {
    terms.add(chunk);
    if (chunk.length > 2) {
      for (let index = 0; index < chunk.length - 1; index += 1) {
        terms.add(chunk.slice(index, index + 2));
      }
    }
  }

  return [...terms].filter((item) => item.length >= 2).slice(0, 12);
}

function mapDocument(row: ProjectDocumentRow) {
  return {
    contentMd: row.content_md,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    id: row.id,
    isEntry: row.is_entry,
    projectId: row.project_id,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapGlobalDocument(row: GlobalDocumentRow): UnifiedKnowledgeDocument {
  return {
    contentMd: row.content_md,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    id: row.id,
    isEntry: row.is_entry,
    knowledgeScope: 'global',
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapProjectKnowledgeDocument(row: ProjectDocumentRow): UnifiedKnowledgeDocument {
  return {
    ...mapDocument(row),
    knowledgeScope: 'project',
  };
}

function mapDocumentListItem(row: ProjectDocumentRow) {
  return {
    contentLength: row.content_md.length,
    description: row.description,
    excerpt: buildExcerpt(row.content_md),
    id: row.id,
    isEntry: row.is_entry,
    projectId: row.project_id,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function ensurePluginSignature(params: z.infer<typeof publicPluginParamsSchema>) {
  if (!verifyProjectKnowledgePluginSignature(params.projectId, params.signature)) {
    throw createHttpError('Invalid plugin signature', 401);
  }
}

function ensureInternalToken(request: FastifyRequest) {
  const configuredToken = env.PROJECT_DOCS_INTERNAL_TOKEN?.trim();

  if (!configuredToken) {
    throw createHttpError('PROJECT_DOCS_INTERNAL_TOKEN is not configured', 503);
  }

  const headerToken = request.headers['x-project-docs-token'];

  if (typeof headerToken !== 'string' || headerToken.trim() !== configuredToken) {
    throw createHttpError('Invalid project docs token', 401);
  }
}

async function fetchProjectDocument(projectId: string, documentId: string) {
  const result = await query<ProjectDocumentRow>(
    `
    select
      id,
      project_id,
      slug,
      title,
      description,
      content_md,
      status,
      sort_order,
      is_entry,
      created_by,
      updated_by,
      created_at,
      updated_at
    from lobehub_admin.project_documents
    where project_id = $1
      and id = $2
    limit 1
    `,
    [projectId, documentId],
  );

  return result.rows[0] ?? null;
}

async function fetchProjectDocumentBySlug(projectId: string, slug: string) {
  const result = await query<ProjectDocumentRow>(
    `
    select
      id,
      project_id,
      slug,
      title,
      description,
      content_md,
      status,
      sort_order,
      is_entry,
      created_by,
      updated_by,
      created_at,
      updated_at
    from lobehub_admin.project_documents
    where project_id = $1
      and slug = $2
    limit 1
    `,
    [projectId, slug],
  );

  return result.rows[0] ?? null;
}

async function fetchPublishedDocumentCount(projectId: string) {
  const result = await query<{ count: string }>(
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

async function fetchPublishedGlobalDocumentCount() {
  const result = await query<{ count: string }>(
    `
    select count(*)::text as count
    from lobehub_admin.global_documents
    where status = 'published'
    `,
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function fetchPublishedGlobalDocuments() {
  const result = await query<GlobalDocumentRow>(
    `
    select
      id,
      slug,
      title,
      description,
      content_md,
      status,
      sort_order,
      is_entry,
      created_by,
      updated_by,
      created_at,
      updated_at
    from lobehub_admin.global_documents
    where status = 'published'
    order by is_entry desc, sort_order asc, updated_at desc
    `,
  );

  return result.rows;
}

function scoreKnowledgeDocument(doc: UnifiedKnowledgeDocument, terms: string[]) {
  const haystack = `${doc.slug} ${doc.title} ${doc.description ?? ''} ${doc.contentMd}`.toLowerCase();
  let score = doc.knowledgeScope === 'project' ? 100 : 10;
  if (doc.isEntry) score += 5;

  const joinedTerms = terms.join(' ').toLowerCase();
  const askingForMap =
    joinedTerms.includes('map')
    || joinedTerms.includes('目录')
    || joinedTerms.includes('地图')
    || joinedTerms.includes('总览')
    || joinedTerms.includes('overview');

  if (doc.slug.startsWith('00-') && !askingForMap) {
    score -= 25;
  }

  for (const term of terms) {
    const lowered = term.toLowerCase();
    if (doc.slug.toLowerCase().includes(lowered)) score += 30;
    if (doc.title.toLowerCase().includes(lowered)) score += 25;
    if ((doc.description ?? '').toLowerCase().includes(lowered)) score += 15;
    if (haystack.includes(lowered)) score += 8;
  }

  return score;
}

export async function registerProjectDocumentRoutes(app: FastifyInstance) {
  app.get('/api/projects/:projectId/documents', async (request) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const filters = listDocumentsQuerySchema.parse(request.query);
    await ensureProjectAdminRequest(request, params.projectId);

    const values: unknown[] = [params.projectId];
    const conditions = ['project_id = $1'];

    if (filters.status !== 'all') {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

    const result = await query<ProjectDocumentRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by,
        created_at,
        updated_at
      from lobehub_admin.project_documents
      where ${conditions.join(' and ')}
      order by
        is_entry desc,
        sort_order asc,
        updated_at desc
      `,
      values,
    );

    return {
      documents: result.rows.map(mapDocumentListItem),
    };
  });

  app.post('/api/projects/:projectId/documents', async (request, reply) => {
    const params = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = createDocumentSchema.parse(request.body);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const slug = buildSlug(body.title, body.slug);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<ProjectDocumentRow>(
        `
        insert into lobehub_admin.project_documents (
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        returning
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        `,
        [
          params.projectId,
          slug,
          body.title,
          normalizeOptionalText(body.description),
          body.contentMd,
          body.status,
          body.sortOrder,
          body.isEntry,
          actor.id,
        ],
      );

      const syncResult = await syncProjectDocumentPlugin(client, params.projectId);
      await client.query('commit');

      return reply.code(201).send({
        document: mapDocument(result.rows[0]),
        pluginSync: syncResult,
      });
    } catch (error) {
      await client.query('rollback');
      const pgError = error as Error & { code?: string };
      if (pgError.code === '23505') {
        throw createHttpError('当前项目下文档 slug 已存在', 409);
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/projects/:projectId/documents/:documentId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      documentId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);

    const document = await fetchProjectDocument(params.projectId, params.documentId);

    if (!document) {
      throw createHttpError('Document not found', 404);
    }

    return {
      document: mapDocument(document),
    };
  });

  app.put('/api/projects/:projectId/documents/:documentId', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
      documentId: z.string().min(1),
    }).parse(request.params);
    const body = updateDocumentSchema.parse(request.body);
    const actor = await ensureProjectAdminRequest(request, params.projectId);
    const slug = buildSlug(body.title, body.slug);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<ProjectDocumentRow>(
        `
        update lobehub_admin.project_documents
        set
          slug = $3,
          title = $4,
          description = $5,
          content_md = $6,
          status = $7,
          sort_order = $8,
          is_entry = $9,
          updated_by = $10
        where project_id = $1
          and id = $2
        returning
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        `,
        [
          params.projectId,
          params.documentId,
          slug,
          body.title,
          normalizeOptionalText(body.description),
          body.contentMd,
          body.status,
          body.sortOrder,
          body.isEntry,
          actor.id,
        ],
      );

      const document = result.rows[0];

      if (!document) {
        throw createHttpError('Document not found', 404);
      }

      const syncResult = await syncProjectDocumentPlugin(client, params.projectId);
      await client.query('commit');

      return {
        document: mapDocument(document),
        pluginSync: syncResult,
      };
    } catch (error) {
      await client.query('rollback');
      const pgError = error as Error & { code?: string };
      if (pgError.code === '23505') {
        throw createHttpError('当前项目下文档 slug 已存在', 409);
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/projects/:projectId/documents/:documentId', async (request, reply) => {
    const params = z.object({
      projectId: z.string().min(1),
      documentId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<{ id: string }>(
        `
        delete from lobehub_admin.project_documents
        where project_id = $1
          and id = $2
        returning id
        `,
        [params.projectId, params.documentId],
      );

      if (!result.rows[0]) {
        await client.query('rollback');
        return reply.code(404).send({ message: 'Document not found' });
      }

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

  app.post('/api/projects/:projectId/documents/sync-plugin', async (request) => {
    const params = z.object({
      projectId: z.string().min(1),
    }).parse(request.params);
    await ensureProjectAdminRequest(request, params.projectId);
    const client = await db.connect();

    try {
      await client.query('begin');
      const sync = await syncProjectDocumentPlugin(client, params.projectId);
      await client.query('commit');
      return { pluginSync: sync };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/internal/project-docs/context', async (request) => {
    ensureInternalToken(request);

    const queryParams = internalContextQuerySchema.parse(request.query);
    const result = await query<ProjectDocumentRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by,
        created_at,
        updated_at
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
        and is_entry = true
      order by
        sort_order asc,
        updated_at desc
      `,
      [queryParams.projectId],
    );

    return {
      documents: result.rows.map(mapDocument),
    };
  });

  app.get('/internal/project-docs/search', async (request) => {
    ensureInternalToken(request);

    const queryParams = internalSearchQuerySchema.parse(request.query);
    const searchText = queryParams.query?.trim() ?? '';

    if (!searchText) {
      const result = await query<ProjectDocumentRow>(
        `
        select
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        from lobehub_admin.project_documents
        where project_id = $1
          and status = 'published'
        order by
          is_entry desc,
          sort_order asc,
          updated_at desc
        limit $2
        `,
        [queryParams.projectId, queryParams.limit],
      );

      return {
        documents: result.rows.map((row) => ({
          ...mapDocumentListItem(row),
          rankScore: null,
        })),
      };
    }

    const result = await query<ProjectDocumentSearchRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        updated_at,
        ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
          ),
          plainto_tsquery('simple', $2)
        ) as rank_score
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
        and to_tsvector(
          'simple',
          coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
        ) @@ plainto_tsquery('simple', $2)
      order by
        rank_score desc,
        is_entry desc,
        sort_order asc,
        updated_at desc
      limit $3
      `,
      [queryParams.projectId, searchText, queryParams.limit],
    );

    return {
      documents: result.rows.map((row) => ({
        contentLength: row.content_md.length,
        description: row.description,
        excerpt: buildExcerpt(row.content_md),
        id: row.id,
        isEntry: row.is_entry,
        projectId: row.project_id,
        rankScore: row.rank_score,
        slug: row.slug,
        sortOrder: row.sort_order,
        status: row.status,
        title: row.title,
        updatedAt: row.updated_at,
      })),
    };
  });

  app.get('/internal/project-docs/read', async (request) => {
    ensureInternalToken(request);

    const queryParams = internalReadQuerySchema.parse(request.query);
    const document = queryParams.documentId
      ? await fetchProjectDocument(queryParams.projectId, queryParams.documentId)
      : await fetchProjectDocumentBySlug(queryParams.projectId, queryParams.slug!);

    if (!document || document.status !== 'published') {
      throw createHttpError('Document not found', 404);
    }

    return {
      document: mapDocument(document),
    };
  });

  app.get('/public/project-knowledge/:projectId/:signature/manifest.json', async (request) => {
    const params = publicPluginParamsSchema.parse(request.params);
    ensurePluginSignature(params);

    const baseUrl = env.PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL?.trim()?.replace(/\/+$/, '');

    if (!baseUrl) {
      throw createHttpError('PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL is not configured', 503);
    }

    const documents = await query<ProjectDocumentRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by,
        created_at,
        updated_at
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
      order by is_entry desc, sort_order asc, updated_at desc
      `,
      [params.projectId],
    );

    const api = [
      {
        description:
          documents.rows.length <= 1
            ? 'Answer any project-specific question using the shared project knowledge. Use this first before any other knowledge or web search. There is currently only one published project document, so this tool already includes the full available project knowledge.'
            : 'Answer any project-specific question using the shared project knowledge. Use this first before any other knowledge or web search.',
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
        url: `${baseUrl}/public/project-knowledge/${params.projectId}/${params.signature}/query`,
      },
    ];

    return {
      api,
      identifier: buildProjectKnowledgePluginIdentifier(params.projectId),
      meta: {
        avatar: '📚',
        description: 'Shared project knowledge for the current project.',
        title: 'Project Knowledge',
      },
      type: 'default',
      version: '1',
    };
  });

  app.post('/public/project-knowledge/:projectId/:signature/context', async (request) => {
    const params = publicPluginParamsSchema.parse(request.params);
    ensurePluginSignature(params);
    const publishedDocumentCount = await fetchPublishedDocumentCount(params.projectId);
    const publishedGlobalDocumentCount = await fetchPublishedGlobalDocumentCount();

    const result = await query<ProjectDocumentRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by,
        created_at,
        updated_at
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
        and is_entry = true
      order by sort_order asc, updated_at desc
      `,
      [params.projectId],
    );

    return {
      documents: result.rows.map(mapProjectKnowledgeDocument),
      meta: {
        entryDocumentCount: result.rows.length,
        globalDocumentCount: publishedGlobalDocumentCount,
        publishedDocumentCount,
      },
    };
  });

  app.post('/public/project-knowledge/:projectId/:signature/query', async (request) => {
    const params = publicPluginParamsSchema.parse(request.params);
    const body = normalizePublicPluginQuestionInput(request.body);
    ensurePluginSignature(params);
    const publishedDocumentCount = await fetchPublishedDocumentCount(params.projectId);
    const publishedGlobalDocumentCount = await fetchPublishedGlobalDocumentCount();
    const question = body.question?.trim() ?? '';

    if (!question) {
      const fallback = await query<ProjectDocumentRow>(
        `
        select
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        from lobehub_admin.project_documents
        where project_id = $1
          and status = 'published'
        order by is_entry desc, sort_order asc, updated_at desc
        limit 3
        `,
        [params.projectId],
      );

      return {
        documents: fallback.rows.map(mapProjectKnowledgeDocument),
        meta: {
          globalDocumentCount: publishedGlobalDocumentCount,
          publishedDocumentCount,
          question,
          strategy: 'fallback-no-question',
        },
      };
    }

    const projectDocs = (await query<ProjectDocumentRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        created_by,
        updated_by,
        created_at,
        updated_at
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
      order by is_entry desc, sort_order asc, updated_at desc
      `,
      [params.projectId],
    )).rows.map(mapProjectKnowledgeDocument);

    const globalDocs = (await fetchPublishedGlobalDocuments()).map(mapGlobalDocument);
    const allDocs = [...projectDocs, ...globalDocs];

    if (allDocs.length <= 1) {
      return {
        documents: allDocs.slice(0, 1),
        meta: {
          globalDocumentCount: publishedGlobalDocumentCount,
          publishedDocumentCount,
          question,
          strategy: 'single-document-direct',
        },
      };
    }

    const matched = await query<ProjectDocumentSearchRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        updated_at,
        ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
          ),
          plainto_tsquery('simple', $2)
        ) as rank_score
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
        and to_tsvector(
          'simple',
          coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
        ) @@ plainto_tsquery('simple', $2)
      order by rank_score desc, is_entry desc, sort_order asc, updated_at desc
      limit 3
      `,
      [params.projectId, question],
    );

    if (matched.rows.length > 0) {
      return {
        documents: matched.rows.map((row) => mapDocument(row as unknown as ProjectDocumentRow)),
        meta: {
          globalDocumentCount: publishedGlobalDocumentCount,
          matchedDocumentCount: matched.rows.length,
          publishedDocumentCount,
          question,
          strategy: 'fts-match',
        },
      };
    }

    const fallbackTerms = extractSearchTerms(question);

    if (fallbackTerms.length > 0) {
      const fuzzy = allDocs
        .map((doc) => ({ doc, score: scoreKnowledgeDocument(doc, fallbackTerms) }))
        .filter((item) => item.score > (item.doc.knowledgeScope === 'project' ? 100 : 10))
        .sort((left, right) => right.score - left.score);

      const fuzzyProject = fuzzy.filter((item) => item.doc.knowledgeScope === 'project');
      const fuzzyGlobal = fuzzy.filter((item) => item.doc.knowledgeScope === 'global');
      const mergedFuzzy = [
        ...fuzzyProject.slice(0, 2),
        ...fuzzyGlobal.slice(0, 1),
        ...fuzzyProject.slice(2),
        ...fuzzyGlobal.slice(1),
      ]
        .slice(0, 3)
        .map((item) => item.doc);

      if (mergedFuzzy.length > 0) {
        return {
          documents: mergedFuzzy,
          meta: {
            fallbackTerms,
            globalDocumentCount: publishedGlobalDocumentCount,
            matchedDocumentCount: mergedFuzzy.length,
            publishedDocumentCount,
            question,
            strategy: 'fuzzy-like-match',
          },
        };
      }
    }

    const fallback = [
      ...projectDocs.filter((doc) => doc.isEntry),
      ...globalDocs.filter((doc) => doc.isEntry || doc.slug.startsWith('00-')),
    ].slice(0, 3);

    return {
      documents: fallback,
      meta: {
        fallbackToContext: true,
        globalDocumentCount: publishedGlobalDocumentCount,
        matchedDocumentCount: 0,
        publishedDocumentCount,
        question,
        strategy: 'fallback-entry-docs',
      },
    };
  });

  app.post('/public/project-knowledge/:projectId/:signature/search', async (request) => {
    const params = publicPluginParamsSchema.parse(request.params);
    const body = normalizePublicPluginSearchInput(request.body);
    ensurePluginSignature(params);
    const publishedDocumentCount = await fetchPublishedDocumentCount(params.projectId);
    const queryText = body.query?.trim() ?? '';

    if (!queryText) {
      const fallback = await query<ProjectDocumentRow>(
        `
        select
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        from lobehub_admin.project_documents
        where project_id = $1
          and status = 'published'
        order by is_entry desc, sort_order asc, updated_at desc
        limit 8
        `,
        [params.projectId],
      );

      return {
        documents: fallback.rows.map((row) => ({
          ...mapDocumentListItem(row),
          rankScore: null,
        })),
        meta: {
          fallbackToContext: true,
          matchedDocumentCount: fallback.rows.length,
          publishedDocumentCount,
          query: queryText,
        },
      };
    }

    const result = await query<ProjectDocumentSearchRow>(
      `
      select
        id,
        project_id,
        slug,
        title,
        description,
        content_md,
        status,
        sort_order,
        is_entry,
        updated_at,
        ts_rank_cd(
          to_tsvector(
            'simple',
            coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
          ),
          plainto_tsquery('simple', $2)
        ) as rank_score
      from lobehub_admin.project_documents
      where project_id = $1
        and status = 'published'
        and to_tsvector(
          'simple',
          coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(content_md, '')
        ) @@ plainto_tsquery('simple', $2)
      order by rank_score desc, is_entry desc, sort_order asc, updated_at desc
      limit 8
      `,
      [params.projectId, queryText],
    );

    return {
      documents: result.rows.map((row) => ({
        ...mapDocumentListItem(row as unknown as ProjectDocumentRow),
        rankScore: row.rank_score,
      })),
      meta: {
        matchedDocumentCount: result.rows.length,
        publishedDocumentCount,
        query: queryText,
      },
    };
  });

  app.post('/public/project-knowledge/:projectId/:signature/read', async (request) => {
    const params = publicPluginParamsSchema.parse(request.params);
    const body = normalizePublicPluginReadInput(request.body);
    ensurePluginSignature(params);
    const publishedDocumentCount = await fetchPublishedDocumentCount(params.projectId);

    if (!body.documentId && !body.slug) {
      const fallback = await query<ProjectDocumentRow>(
        `
        select
          id,
          project_id,
          slug,
          title,
          description,
          content_md,
          status,
          sort_order,
          is_entry,
          created_by,
          updated_by,
          created_at,
          updated_at
        from lobehub_admin.project_documents
        where project_id = $1
          and status = 'published'
        order by is_entry desc, sort_order asc, updated_at desc
        limit 1
        `,
        [params.projectId],
      );

      const document = fallback.rows[0];

      if (!document) {
        throw createHttpError('Document not found', 404);
      }

      return {
        document: mapDocument(document),
        meta: {
          fallbackToPrimaryDocument: true,
          publishedDocumentCount,
        },
      };
    }

    const document = body.documentId
      ? await fetchProjectDocument(params.projectId, body.documentId)
      : await fetchProjectDocumentBySlug(params.projectId, body.slug!);

    if (!document || document.status !== 'published') {
      throw createHttpError('Document not found', 404);
    }

    return {
      document: mapDocument(document),
      meta: {
        publishedDocumentCount,
      },
    };
  });
}
