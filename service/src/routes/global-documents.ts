import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ensureSystemAdmin, getManagedProjectCount, requireActor } from '../auth.js';
import { db, query } from '../db.js';
import { syncKnowledgePluginsForAllProjects } from '../project-document-plugin.js';

type DocumentStatus = 'draft' | 'published' | 'archived';

type GlobalDocumentRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  status: DocumentStatus;
  sort_order: number;
  is_entry: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const documentStatusSchema = z.enum(['draft', 'published', 'archived']);

const createGlobalDocumentSchema = z.object({
  slug: z.string().trim().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  contentMd: z.string().default(''),
  status: documentStatusSchema.default('draft'),
  sortOrder: z.coerce.number().int().default(0),
  isEntry: z.boolean().default(false),
});

const updateGlobalDocumentSchema = createGlobalDocumentSchema;

const listGlobalDocumentsQuerySchema = z.object({
  status: z.enum(['all', 'draft', 'published', 'archived']).default('all'),
});

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

function mapGlobalDocument(row: GlobalDocumentRow) {
  return {
    contentMd: row.content_md,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    id: row.id,
    isEntry: row.is_entry,
    scope: 'global' as const,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapGlobalDocumentListItem(row: GlobalDocumentRow) {
  return {
    contentLength: row.content_md.length,
    description: row.description,
    excerpt: buildExcerpt(row.content_md),
    id: row.id,
    isEntry: row.is_entry,
    scope: 'global' as const,
    slug: row.slug,
    sortOrder: row.sort_order,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

async function fetchGlobalDocument(documentId: string) {
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
    where id = $1
    limit 1
    `,
    [documentId],
  );

  return result.rows[0] ?? null;
}

async function ensureGlobalDocumentReadAccess(actorId: string) {
  const actor = await ensureSystemAdmin(actorId).catch(() => null);

  if (actor) return actor;

  const managedCount = await getManagedProjectCount(actorId);
  if (managedCount > 0) {
    return { id: actorId };
  }

  throw createHttpError('System admin or project admin access required', 403);
}

export async function registerGlobalDocumentRoutes(app: FastifyInstance) {
  app.get('/api/system/global-documents', async (request) => {
    const actor = await requireActor(request);
    await ensureGlobalDocumentReadAccess(actor.id);
    const filters = listGlobalDocumentsQuerySchema.parse(request.query);

    const values: unknown[] = [];
    const conditions: string[] = [];

    if (filters.status !== 'all') {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

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
      ${conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''}
      order by
        is_entry desc,
        sort_order asc,
        updated_at desc
      `,
      values,
    );

    return {
      documents: result.rows.map(mapGlobalDocumentListItem),
    };
  });

  app.post('/api/system/global-documents', async (request, reply) => {
    const actor = await requireActor(request);
    await ensureSystemAdmin(actor.id);
    const body = createGlobalDocumentSchema.parse(request.body);
    const slug = buildSlug(body.title, body.slug);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<GlobalDocumentRow>(
        `
        insert into lobehub_admin.global_documents (
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
        values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        returning
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
        `,
        [
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

      await syncKnowledgePluginsForAllProjects(client);
      await client.query('commit');

      return reply.code(201).send({
        document: mapGlobalDocument(result.rows[0]),
      });
    } catch (error) {
      await client.query('rollback');
      const pgError = error as Error & { code?: string };
      if (pgError.code === '23505') {
        throw createHttpError('当前全局文档 slug 已存在', 409);
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/system/global-documents/:documentId', async (request) => {
    const actor = await requireActor(request);
    await ensureGlobalDocumentReadAccess(actor.id);
    const params = z.object({ documentId: z.string().min(1) }).parse(request.params);

    const document = await fetchGlobalDocument(params.documentId);

    if (!document) {
      throw createHttpError('Document not found', 404);
    }

    return {
      document: mapGlobalDocument(document),
    };
  });

  app.put('/api/system/global-documents/:documentId', async (request) => {
    const actor = await requireActor(request);
    await ensureSystemAdmin(actor.id);
    const params = z.object({ documentId: z.string().min(1) }).parse(request.params);
    const body = updateGlobalDocumentSchema.parse(request.body);
    const slug = buildSlug(body.title, body.slug);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<GlobalDocumentRow>(
        `
        update lobehub_admin.global_documents
        set
          slug = $2,
          title = $3,
          description = $4,
          content_md = $5,
          status = $6,
          sort_order = $7,
          is_entry = $8,
          updated_by = $9
        where id = $1
        returning
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
        `,
        [
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

      await syncKnowledgePluginsForAllProjects(client);
      await client.query('commit');

      return {
        document: mapGlobalDocument(document),
      };
    } catch (error) {
      await client.query('rollback');
      const pgError = error as Error & { code?: string };
      if (pgError.code === '23505') {
        throw createHttpError('当前全局文档 slug 已存在', 409);
      }

      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/system/global-documents/:documentId', async (request, reply) => {
    const actor = await requireActor(request);
    await ensureSystemAdmin(actor.id);
    const params = z.object({ documentId: z.string().min(1) }).parse(request.params);
    const client = await db.connect();

    try {
      await client.query('begin');

      const result = await client.query<{ id: string }>(
        `
        delete from lobehub_admin.global_documents
        where id = $1
        returning id
        `,
        [params.documentId],
      );

      if (!result.rows[0]) {
        await client.query('rollback');
        return reply.code(404).send({ message: 'Document not found' });
      }

      await syncKnowledgePluginsForAllProjects(client);
      await client.query('commit');
      return reply.code(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });
}
