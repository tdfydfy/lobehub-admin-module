import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDatabaseCellValue } from '../lib/time';
import type {
  DatabaseAccessScope,
  DatabaseTableDataResult,
  DatabaseTableOption,
} from '../types';

type DatabaseTablePanelProps = {
  actorId: string;
  onFeedback: (message: string) => void;
};

type SortDirection = 'asc' | 'desc' | null;

type ExpandedCellState = {
  columnName: string;
  rowNumber: number;
  value: string;
};

const collator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

function stringifyCellValue(value: unknown, pretty = false) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, pretty ? 2 : 0);
  } catch {
    return String(value);
  }
}

function getCellPreview(value: unknown, dataType?: string) {
  return formatDatabaseCellValue(value, dataType).replace(/\s+/g, ' ').trim() || ' ';
}

function compareCellValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }

  return collator.compare(stringifyCellValue(left), stringifyCellValue(right));
}

function formatAccessScope(scope: DatabaseAccessScope | null) {
  if (!scope) return '';

  if (scope.mode === 'system') {
    return `当前为系统管理员视角，可浏览 schema：${scope.allowedSchemas.join(' / ')}`;
  }

  return `当前为项目管理员视角，仅可浏览 crm schema，且仅显示 ${scope.projectFieldName} = ${scope.projectNames.join(' / ')} 的数据`;
}

export function DatabaseTablePanel({
  actorId,
  onFeedback,
}: DatabaseTablePanelProps) {
  const [tables, setTables] = useState<DatabaseTableOption[]>([]);
  const [accessScope, setAccessScope] = useState<DatabaseAccessScope | null>(null);
  const [selectedTableKey, setSelectedTableKey] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DatabaseTableDataResult | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [visibleColumnNames, setVisibleColumnNames] = useState<string[] | null>(null);
  const [sortState, setSortState] = useState<{ columnName: string; direction: SortDirection }>({
    columnName: '',
    direction: null,
  });
  const [expandedCell, setExpandedCell] = useState<ExpandedCellState | null>(null);

  useEffect(() => {
    if (!actorId) return;

    let cancelled = false;

    async function loadTables() {
      setLoadingTables(true);
      setError('');

      try {
        const result = await api.listDatabaseTables(actorId);

        if (cancelled) return;

        setTables(result.tables);
        setAccessScope(result.accessScope);
        setSelectedTableKey((current) => {
          if (current && result.tables.some((table) => table.fullName === current)) {
            return current;
          }

          return result.tables[0]?.fullName ?? '';
        });
      } catch (loadError) {
        if (cancelled) return;
        const message = (loadError as Error).message;
        setError(message);
        onFeedback(message);
      } finally {
        if (!cancelled) {
          setLoadingTables(false);
        }
      }
    }

    void loadTables();

    return () => {
      cancelled = true;
    };
  }, [actorId, onFeedback]);

  useEffect(() => {
    if (!actorId || !selectedTableKey) return;

    let cancelled = false;

    async function loadTableData() {
      const [schema, table] = selectedTableKey.split('.', 2);

      if (!schema || !table) return;

      setLoadingData(true);
      setError('');

      try {
        const result = await api.getDatabaseTableData(actorId, {
          schema,
          table,
          page,
          pageSize,
        });

        if (cancelled) return;
        setData(result);
      } catch (loadError) {
        if (cancelled) return;
        const message = (loadError as Error).message;
        setError(message);
        onFeedback(message);
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    }

    void loadTableData();

    return () => {
      cancelled = true;
    };
  }, [actorId, selectedTableKey, page, pageSize, refreshKey, onFeedback]);

  useEffect(() => {
    if (!data) return;

    const nextColumnNames = data.columns.map((column) => column.name);

    setVisibleColumnNames((current) => {
      if (current === null) return nextColumnNames;

      return current.filter((name) => nextColumnNames.includes(name));
    });
  }, [data]);

  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const currentPage = data?.pagination.page ?? page;
  const visibleStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const visibleEnd = total === 0 ? 0 : visibleStart + (data?.rows.length ?? 0) - 1;

  const allColumns = data?.columns ?? [];
  const activeColumnNames = visibleColumnNames ?? allColumns.map((column) => column.name);
  const visibleColumns = allColumns.filter((column) => activeColumnNames.includes(column.name));
  const allColumnsVisible = allColumns.length > 0 && visibleColumns.length === allColumns.length;

  const renderedRows = data
    ? [...data.rows]
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        if (!sortState.direction || !sortState.columnName) {
          return left.index - right.index;
        }

        const result = compareCellValues(
          left.row[sortState.columnName],
          right.row[sortState.columnName],
        );

        if (result === 0) {
          return left.index - right.index;
        }

        return sortState.direction === 'asc' ? result : -result;
      })
      .map((item) => item.row)
    : [];

  function refreshTableData() {
    if (loadingData) return;
    setExpandedCell(null);
    setRefreshKey((value) => value + 1);
  }

  function changePage(nextPage: number) {
    const boundedPage = Math.max(1, Math.min(nextPage, totalPages));

    if (boundedPage === page) return;

    setExpandedCell(null);
    setPage(boundedPage);
  }

  function handleChangeTable(value: string) {
    setSelectedTableKey(value);
    setPage(1);
    setData(null);
    setVisibleColumnNames(null);
    setSortState({ columnName: '', direction: null });
    setExpandedCell(null);
  }

  function handleChangePageSize(value: string) {
    const nextPageSize = Number(value);

    if (!Number.isFinite(nextPageSize)) return;

    setExpandedCell(null);
    setPageSize(nextPageSize);
    setPage(1);
  }

  function toggleSort(columnName: string) {
    setExpandedCell(null);
    setSortState((current) => {
      if (current.columnName !== columnName) {
        return {
          columnName,
          direction: 'asc',
        };
      }

      if (current.direction === 'asc') {
        return {
          columnName,
          direction: 'desc',
        };
      }

      return {
        columnName: '',
        direction: null,
      };
    });
  }

  function toggleColumnVisibility(columnName: string) {
    setVisibleColumnNames((current) => {
      const next = current === null
        ? allColumns.map((column) => column.name)
        : current;

      const updated = next.includes(columnName)
        ? next.filter((name) => name !== columnName)
        : [...next, columnName];

      if (!updated.includes(sortState.columnName)) {
        setSortState({ columnName: '', direction: null });
      }

      return updated;
    });
  }

  function toggleAllColumns() {
    setExpandedCell(null);

    if (allColumnsVisible) {
      setVisibleColumnNames([]);
      setSortState({ columnName: '', direction: null });
      return;
    }

    setVisibleColumnNames(allColumns.map((column) => column.name));
  }

  function openExpandedCell(value: unknown, columnName: string, rowIndex: number, dataType?: string) {
    setExpandedCell({
      columnName,
      rowNumber: visibleStart + rowIndex,
      value: typeof value === 'object' && value !== null
        ? stringifyCellValue(value, true)
        : formatDatabaseCellValue(value, dataType),
    });
  }

  function closeExpandedCell() {
    setExpandedCell(null);
  }

  const emptyMessage = data?.emptyReason
    ?? (visibleColumns.length === 0
      ? '当前已隐藏全部字段，请重新开启需要显示的列'
      : '当前表暂无数据。');

  const emptyHint = data?.accessScope.mode === 'project' && !data?.projectColumnPresent
    ? `项目管理员视角要求表中存在 ${data.accessScope.projectFieldName} 字段`
    : '可以切换其他表，或刷新后重新查看。';

  return (
    <div className="data-browser-page">
      <section className="section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Database</p>
            <h3>数据查看</h3>
          </div>
          <span className="muted">
            {accessScope
              ? formatAccessScope(accessScope)
              : '正在识别当前账号可访问的数据范围。'}
          </span>
        </div>

        <div className="data-browser-toolbar">
          <label className="field grow">
            <span>数据表</span>
            <select
              value={selectedTableKey}
              onChange={(event) => handleChangeTable(event.target.value)}
              disabled={loadingTables || tables.length === 0}
            >
              {tables.length === 0 ? <option value="">暂无可浏览的数据表</option> : null}
              {tables.map((table) => (
                <option key={table.fullName} value={table.fullName}>
                  {table.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>每页条数</span>
            <select value={String(pageSize)} onChange={(event) => handleChangePageSize(event.target.value)}>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>

          <button className="ghost" disabled={loadingData || !selectedTableKey} onClick={refreshTableData}>
            刷新
          </button>
        </div>

        {error ? <p className="danger-text">{error}</p> : null}
        {loadingTables ? <p className="muted">正在加载数据表列表...</p> : null}
      </section>

      {data ? (
        <section className="section section-wide">
          <div className="section-head">
            <div>
              <p className="eyebrow">Table</p>
              <h3>{data.table.fullName}</h3>
            </div>
            <span className="muted">当前显示 {visibleStart}-{visibleEnd} / {total} 行，字段 {visibleColumns.length} / {allColumns.length}</span>
          </div>

          <div className="raw-column-toolbar">
            <div className="raw-column-summary">
              <strong>字段显示</strong>
              <span className="muted">可按需隐藏列。排序仅作用于当前页。</span>
            </div>
            <button className="ghost" onClick={toggleAllColumns}>
              {allColumnsVisible ? '隐藏全部字段' : '显示全部字段'}
            </button>
          </div>

          <div className="raw-column-list">
            {allColumns.map((column) => {
              const checked = activeColumnNames.includes(column.name);

              return (
                <label key={column.name} className={`raw-column-option${checked ? ' active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleColumnVisibility(column.name)}
                  />
                  <span>{column.name}</span>
                </label>
              );
            })}
          </div>

          {loadingData ? <p className="muted">正在加载表数据...</p> : null}

          {renderedRows.length > 0 && visibleColumns.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="member-table raw-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((column) => {
                        const isSorted = sortState.columnName === column.name && sortState.direction !== null;
                        const sortLabel = !isSorted
                          ? '未排序'
                          : sortState.direction === 'asc'
                            ? '升序'
                            : '降序';

                        return (
                          <th key={column.name}>
                            <button
                              type="button"
                              className={`raw-header-button${isSorted ? ' active' : ''}`}
                              onClick={() => toggleSort(column.name)}
                              title={`点击切换排序：${column.name}`}
                            >
                              <div>{column.name}</div>
                              <small className="raw-head-meta">
                                {column.dataType}
                                {column.nullable ? ' · 可空' : ''}
                                {' · '}
                                {sortLabel}
                              </small>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {renderedRows.map((row, rowIndex) => (
                      <tr key={`${data.table.fullName}-${visibleStart + rowIndex}`}>
                        {visibleColumns.map((column) => {
                          const preview = getCellPreview(row[column.name], column.dataType);

                          return (
                            <td key={`${visibleStart + rowIndex}-${column.name}`} className="raw-cell">
                              <button
                                type="button"
                                className="raw-cell-button"
                                onClick={() => openExpandedCell(row[column.name], column.name, rowIndex, column.dataType)}
                                title={preview}
                              >
                                {preview}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="report-pagination">
                <span className="muted">第 {currentPage} / {totalPages} 页</span>
                <div className="button-row">
                  <button className="ghost" disabled={currentPage <= 1} onClick={() => changePage(1)}>
                    首页
                  </button>
                  <button className="ghost" disabled={currentPage <= 1} onClick={() => changePage(currentPage - 1)}>
                    上一页
                  </button>
                  <button className="ghost" disabled={currentPage >= totalPages} onClick={() => changePage(currentPage + 1)}>
                    下一页
                  </button>
                  <button className="ghost" disabled={currentPage >= totalPages} onClick={() => changePage(totalPages)}>
                    末页
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-card">
              <p>{emptyMessage}</p>
              <p>{emptyHint}</p>
            </div>
          )}
        </section>
      ) : selectedTableKey && loadingData ? (
        <section className="section">
          <p className="muted">正在加载表数据...</p>
        </section>
      ) : (
        <section className="section">
          <div className="empty-card">
            <p>先从上方选择一个数据表。</p>
            <p>页面会直接展示表中的原始记录和字段。</p>
          </div>
        </section>
      )}

      {expandedCell ? (
        <div className="raw-modal-backdrop" onClick={closeExpandedCell}>
          <div className="raw-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Cell Value</p>
                <h3>{expandedCell.columnName}</h3>
              </div>
              <button className="ghost" onClick={closeExpandedCell}>
                关闭
              </button>
            </div>
            <p className="muted">第 {expandedCell.rowNumber} 行的完整内容</p>
            <pre className="raw-modal-content">{expandedCell.value}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
