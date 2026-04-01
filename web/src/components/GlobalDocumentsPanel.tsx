import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type { GlobalDocument, GlobalDocumentListItem, ProjectDocumentStatus } from '../types';

type GlobalDocumentsPanelProps = {
  actorId: string;
  editable?: boolean;
  onFeedback: (message: string) => void;
};

type DocumentDraft = {
  slug: string;
  title: string;
  description: string;
  contentMd: string;
  status: ProjectDocumentStatus;
  sortOrder: number;
  isEntry: boolean;
};

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function buildListSummary(description?: string | null, excerpt?: string | null) {
  const source = (description?.trim() || excerpt?.trim() || '暂无摘要').replace(/\s+/g, ' ');
  return source.length > 30 ? `${source.slice(0, 30)}...` : source;
}

function createEmptyDraft(): DocumentDraft {
  return {
    slug: '',
    title: '',
    description: '',
    contentMd: '',
    status: 'draft',
    sortOrder: 0,
    isEntry: false,
  };
}

function mapDocumentToDraft(document: GlobalDocument): DocumentDraft {
  return {
    slug: document.slug,
    title: document.title,
    description: document.description ?? '',
    contentMd: document.contentMd,
    status: document.status,
    sortOrder: document.sortOrder,
    isEntry: document.isEntry,
  };
}

function getStatusLabel(status: ProjectDocumentStatus) {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'published':
      return '已发布';
    case 'archived':
      return '已归档';
    default:
      return status;
  }
}

export function GlobalDocumentsPanel({
  actorId,
  editable = true,
  onFeedback,
}: GlobalDocumentsPanelProps) {
  const [documents, setDocuments] = useState<GlobalDocumentListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectDocumentStatus>('all');
  const [loadingList, setLoadingList] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [documentDetail, setDocumentDetail] = useState<GlobalDocument | null>(null);
  const [draft, setDraft] = useState<DocumentDraft>(() => createEmptyDraft());
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function loadDocuments(nextSelectedDocumentId?: string) {
    setLoadingList(true);

    try {
      const response = await api.listGlobalDocuments(actorId, statusFilter);
      setDocuments(response.documents);

      const preferredId = nextSelectedDocumentId ?? selectedDocumentId;
      const hasPreferred = preferredId && response.documents.some((item) => item.id === preferredId);

      if (hasPreferred) {
        setSelectedDocumentId(preferredId);
        return;
      }

      const firstId = response.documents[0]?.id ?? '';
      setSelectedDocumentId(firstId);

      if (!firstId) {
        setDocumentDetail(null);
        setDraft(createEmptyDraft());
      }
    } catch (error) {
      onFeedback((error as Error).message || '全局文档列表加载失败');
    } finally {
      setLoadingList(false);
    }
  }

  async function loadDocument(documentId: string) {
    if (!documentId) {
      setDocumentDetail(null);
      setDraft(createEmptyDraft());
      return;
    }

    setLoadingDetail(true);

    try {
      const response = await api.getGlobalDocument(actorId, documentId);
      setDocumentDetail(response.document);
      setDraft(mapDocumentToDraft(response.document));
    } catch (error) {
      onFeedback((error as Error).message || '全局文档详情加载失败');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    setSelectedDocumentId('');
    setDocumentDetail(null);
    setDraft(createEmptyDraft());
    void loadDocuments('');
  }, [actorId, statusFilter]);

  useEffect(() => {
    void loadDocument(selectedDocumentId);
  }, [selectedDocumentId]);

  async function handleSave() {
    if (!editable) return;
    if (!draft.title.trim()) {
      onFeedback('请先填写文档标题');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        slug: draft.slug.trim() || undefined,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        contentMd: draft.contentMd,
        status: draft.status,
        sortOrder: draft.sortOrder,
        isEntry: draft.isEntry,
      };

      const response = documentDetail
        ? await api.updateGlobalDocument(actorId, documentDetail.id, payload)
        : await api.createGlobalDocument(actorId, payload);

      setDocumentDetail(response.document);
      setDraft(mapDocumentToDraft(response.document));
      setSelectedDocumentId(response.document.id);
      await loadDocuments(response.document.id);
      onFeedback(documentDetail ? '全局文档已保存' : '全局文档已创建');
    } catch (error) {
      onFeedback((error as Error).message || '全局文档保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editable) return;
    if (!documentDetail) {
      setDraft(createEmptyDraft());
      onFeedback('已清空新文档草稿');
      return;
    }

    const confirmed = window.confirm(`确认删除全局文档「${documentDetail.title}」吗？`);
    if (!confirmed) return;

    setDeleting(true);

    try {
      await api.deleteGlobalDocument(actorId, documentDetail.id);
      setSelectedDocumentId('');
      setDocumentDetail(null);
      setDraft(createEmptyDraft());
      await loadDocuments('');
      onFeedback('全局文档已删除');
    } catch (error) {
      onFeedback((error as Error).message || '全局文档删除失败');
    } finally {
      setDeleting(false);
    }
  }

  function handleCreateDraft() {
    setSelectedDocumentId('');
    setDocumentDetail(null);
    setDraft(createEmptyDraft());
  }

  return (
    <div className="documents-workbench">
      <section className="section documents-sidebar">
        <div className="section-head">
          <div>
            <p className="eyebrow">Global Docs</p>
            <h3>全局知识文档</h3>
          </div>
          {editable ? (
            <button className="secondary" type="button" onClick={handleCreateDraft}>
              新建文档
            </button>
          ) : (
            <span className="muted">项目管理员只读</span>
          )}
        </div>

        <label className="field">
          <span>状态筛选</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ProjectDocumentStatus)}>
            <option value="all">全部</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="archived">已归档</option>
          </select>
        </label>

        <div className="documents-list">
          {loadingList ? (
            <p className="muted">正在加载全局文档列表...</p>
          ) : documents.length === 0 ? (
            <div className="empty-card">
              <p>当前筛选条件下还没有全局文档。</p>
            </div>
          ) : (
            documents.map((document) => (
              <button
                key={document.id}
                type="button"
                className={`documents-list-item${selectedDocumentId === document.id ? ' active' : ''}`}
                onClick={() => setSelectedDocumentId(document.id)}
              >
                <div className="documents-list-head">
                  <strong>{document.title}</strong>
                  <span className={`report-pill${document.isEntry ? ' active' : ''}`}>
                    {document.isEntry ? '入口文档' : getStatusLabel(document.status)}
                  </span>
                </div>
                <span className="member-subtext">{document.slug}</span>
                <p className="muted documents-list-summary">
                  {buildListSummary(document.description, document.excerpt)}
                </p>
                <div className="documents-list-meta">
                  <span>{getStatusLabel(document.status)}</span>
                  <span>{document.contentLength} 字</span>
                  <span>{formatTime(document.updatedAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="section documents-editor">
        <div className="section-head">
          <div>
            <p className="eyebrow">Markdown</p>
            <h3>{documentDetail ? `编辑全局文档 · ${documentDetail.title}` : '新建全局文档'}</h3>
          </div>
          {editable ? (
            <div className="button-row">
              <button className="secondary" type="button" onClick={handleDelete} disabled={saving || deleting}>
                {documentDetail ? (deleting ? '删除中...' : '删除文档') : '清空草稿'}
              </button>
              <button className="primary" type="button" onClick={handleSave} disabled={saving || loadingDetail}>
                {saving ? '保存中...' : documentDetail ? '保存修改' : '创建文档'}
              </button>
            </div>
          ) : (
            <span className="muted">只读模式</span>
          )}
        </div>

        {loadingDetail ? <p className="muted">正在加载全局文档详情...</p> : null}

        <div className="documents-meta-grid">
          <label className="field">
            <span>标题</span>
            <input
              value={draft.title}
              disabled={!editable}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="例如：全局学校合规口径"
            />
          </label>

          <label className="field">
            <span>Slug</span>
            <input
              value={draft.slug}
              disabled={!editable}
              onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
              placeholder="global-school-compliance"
            />
          </label>

          <label className="field">
            <span>状态</span>
            <select
              value={draft.status}
              disabled={!editable}
              onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as ProjectDocumentStatus }))}
            >
              <option value="draft">草稿</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </label>

          <label className="field">
            <span>排序</span>
            <input
              type="number"
              value={draft.sortOrder}
              disabled={!editable}
              onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))}
            />
          </label>
        </div>

        <label className="field">
          <span>描述</span>
          <textarea
            rows={3}
            value={draft.description}
            disabled={!editable}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="给系统和管理员看的简短描述"
          />
        </label>

        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={draft.isEntry}
            disabled={!editable}
            onChange={(event) => setDraft((current) => ({ ...current, isEntry: event.target.checked }))}
          />
          <span>作为全局默认入口文档</span>
        </label>

        <label className="field">
          <span>Markdown 正文</span>
          <textarea
            className="documents-markdown-input"
            rows={20}
            value={draft.contentMd}
            disabled={!editable}
            onChange={(event) => setDraft((current) => ({ ...current, contentMd: event.target.value }))}
            placeholder={'# 全局知识文档\n\n这里填写全局规则、话术和方法论。'}
          />
        </label>

        <details className="documents-preview">
          <summary>查看原文预览</summary>
          <pre className="raw-modal-content">{draft.contentMd || '暂无内容'}</pre>
        </details>
      </section>
    </div>
  );
}
