import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireActor } from '../auth.js';
import { query } from '../db.js';

type DatabaseTableRow = {
  table_schema: string;
  table_name: string;
};

type DatabaseColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
};

type DatabaseAccessScope = {
  mode: 'system' | 'project';
  allowedSchemas: string[];
  projectNames: string[];
  projectFieldName: 'project';
};

const tableDataQuerySchema = z.object({
  schema: z.string().min(1),
  table: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

function databaseAccessError(message: string) {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = 403;
  return error;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function getQualifiedTableName(schemaName: string, tableName: string) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

function getDefaultOrderExpression(columns: DatabaseColumnRow[]) {
  const columnNames = new Set(columns.map((column) => column.column_name));

  if (columnNames.has('updated_at')) return `${quoteIdentifier('updated_at')} desc nulls last`;
  if (columnNames.has('created_at')) return `${quoteIdentifier('created_at')} desc nulls last`;
  if (columnNames.has('joined_at')) return `${quoteIdentifier('joined_at')} desc nulls last`;
  if (columnNames.has('id')) return `${quoteIdentifier('id')} desc nulls last`;

  return 'ctid desc';
}

async function resolveDatabaseAccessScope(request: FastifyRequest): Promise<DatabaseAccessScope> {
  const actor = await requireActor(request);

  if (actor.isSystemAdmin) {
    return {
      mode: 'system',
      allowedSchemas: ['crm', 'lobehub_admin', 'public'],
      projectNames: [],
      projectFieldName: 'project',
    };
  }

  const projectResult = await query<{ project_name: string }>(
    `
    select p.name as project_name
    from lobehub_admin.project_members pm
    join lobehub_admin.projects p on p.id = pm.project_id
    where pm.user_id = $1
      and pm.role = 'admin'
    order by p.name asc
    `,
    [actor.id],
  );

  const projectNames = [...new Set(projectResult.rows.map((row) => row.project_name).filter(Boolean))];

  if (projectNames.length === 0) {
    throw databaseAccessError('System admin or project admin access required');
  }

  return {
    mode: 'project',
    allowedSchemas: ['crm'],
    projectNames,
    projectFieldName: 'project',
  };
}

async function listBrowsableTables(allowedSchemas: string[]) {
  return query<DatabaseTableRow>(
    `
    select
      t.table_schema,
      t.table_name
    from information_schema.tables t
    where t.table_type = 'BASE TABLE'
      and t.table_schema = any($1::text[])
    order by
      case t.table_schema
        when 'crm' then 0
        when 'lobehub_admin' then 1
        when 'public' then 2
        else 3
      end,
      t.table_schema asc,
      t.table_name asc
    `,
    [allowedSchemas],
  );
}

async function findBrowsableTable(allowedSchemas: string[], schemaName: string, tableName: string) {
  return query<DatabaseTableRow>(
    `
    select
      t.table_schema,
      t.table_name
    from information_schema.tables t
    where t.table_type = 'BASE TABLE'
      and t.table_schema = $1
      and t.table_name = $2
      and t.table_schema = any($3::text[])
    limit 1
    `,
    [schemaName, tableName, allowedSchemas],
  );
}

async function getTableColumns(schemaName: string, tableName: string) {
  return query<DatabaseColumnRow>(
    `
    select
      c.column_name,
      c.data_type,
      c.is_nullable
    from information_schema.columns c
    where c.table_schema = $1
      and c.table_name = $2
    order by c.ordinal_position asc
    `,
    [schemaName, tableName],
  );
}

function mapAccessScope(scope: DatabaseAccessScope) {
  return {
    mode: scope.mode,
    allowedSchemas: scope.allowedSchemas,
    projectNames: scope.projectNames,
    projectFieldName: scope.projectFieldName,
  };
}

export async function registerDatabaseRoutes(app: FastifyInstance) {
  app.get('/api/system/database/tables', async (request) => {
    const accessScope = await resolveDatabaseAccessScope(request);
    const result = await listBrowsableTables(accessScope.allowedSchemas);

    return {
      accessScope: mapAccessScope(accessScope),
      tables: result.rows.map((row) => ({
        schema: row.table_schema,
        name: row.table_name,
        fullName: `${row.table_schema}.${row.table_name}`,
      })),
    };
  });

  app.get('/api/system/database/table-data', async (request) => {
    const accessScope = await resolveDatabaseAccessScope(request);
    const queryParams = tableDataQuerySchema.parse(request.query);
    const tableResult = await findBrowsableTable(accessScope.allowedSchemas, queryParams.schema, queryParams.table);
    const selectedTable = tableResult.rows[0];

    if (!selectedTable) {
      const error = new Error(`Table not found: ${queryParams.schema}.${queryParams.table}`);
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }

    const columnsResult = await getTableColumns(selectedTable.table_schema, selectedTable.table_name);
    const columns = columnsResult.rows;
    const qualifiedTableName = getQualifiedTableName(selectedTable.table_schema, selectedTable.table_name);
    const orderByExpression = getDefaultOrderExpression(columns);
    const offset = (queryParams.page - 1) * queryParams.pageSize;
    const projectColumnPresent = columns.some((column) => column.column_name === accessScope.projectFieldName);

    let total = 0;
    let rows: Record<string, unknown>[] = [];
    let emptyReason: string | null = null;

    if (accessScope.mode === 'project' && !projectColumnPresent) {
      emptyReason = `当前表不包含 ${accessScope.projectFieldName} 字段，项目管理员视角不展示数据`;
    } else if (accessScope.mode === 'project') {
      const [countResult, rowsResult] = await Promise.all([
        query<{ total_count: string }>(
          `
          select count(*)::text as total_count
          from ${qualifiedTableName}
          where (${quoteIdentifier(accessScope.projectFieldName)})::text = any($1::text[])
          `,
          [accessScope.projectNames],
        ),
        query<Record<string, unknown>>(
          `
          select *
          from ${qualifiedTableName}
          where (${quoteIdentifier(accessScope.projectFieldName)})::text = any($1::text[])
          order by ${orderByExpression}
          limit $2
          offset $3
          `,
          [accessScope.projectNames, queryParams.pageSize, offset],
        ),
      ]);

      total = Number(countResult.rows[0]?.total_count ?? 0);
      rows = rowsResult.rows;

      if (total === 0) {
        emptyReason = `未命中 project 字段为 ${accessScope.projectNames.join(' / ')} 的数据`;
      }
    } else {
      const [countResult, rowsResult] = await Promise.all([
        query<{ total_count: string }>(
          `
          select count(*)::text as total_count
          from ${qualifiedTableName}
          `,
        ),
        query<Record<string, unknown>>(
          `
          select *
          from ${qualifiedTableName}
          order by ${orderByExpression}
          limit $1
          offset $2
          `,
          [queryParams.pageSize, offset],
        ),
      ]);

      total = Number(countResult.rows[0]?.total_count ?? 0);
      rows = rowsResult.rows;
    }

    return {
      accessScope: mapAccessScope(accessScope),
      projectColumnPresent,
      emptyReason,
      table: {
        schema: selectedTable.table_schema,
        name: selectedTable.table_name,
        fullName: `${selectedTable.table_schema}.${selectedTable.table_name}`,
      },
      columns: columns.map((column) => ({
        name: column.column_name,
        dataType: column.data_type,
        nullable: column.is_nullable === 'YES',
      })),
      rows,
      pagination: {
        page: queryParams.page,
        pageSize: queryParams.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / queryParams.pageSize)),
      },
    };
  });
}
