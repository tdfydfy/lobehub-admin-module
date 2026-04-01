import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTimeToShanghai } from '../lib/time';
import type { ProjectDocument, ProjectDocumentListItem, ProjectDocumentStatus } from '../types';

type ProjectDocumentsPanelProps = {
  actorId: string;
  projectId: string;
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

function mapDocumentToDraft(document: ProjectDocument): DocumentDraft {
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

export function ProjectDocumentsPanel({
  actorId,
  projectId,
  onFeedback,
}: ProjectDocumentsPanelProps) {
  const [documents, setDocuments] = useState<ProjectDocumentListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectDocumentStatus>('all');
  const [loadingList, setLoadingList] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [documentDetail, setDocumentDetail] = useState<ProjectDocument | null>(null);
  const [draft, setDraft] = useState<DocumentDraft>(() => createEmptyDraft());
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  async function loadDocuments(nextSelectedDocumentId?: string) {
    setLoadingList(true);

    try {
      const response = await api.listProjectDocuments(actorId, projectId, statusFilter);
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
      onFeedback((error as Error).message || '项目文档列表加载失败');
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
      const response = await api.getProjectDocument(actorId, projectId, documentId);
      setDocumentDetail(response.document);
      setDraft(mapDocumentToDraft(response.document));
    } catch (error) {
      onFeedback((error as Error).message || '项目文档详情加载失败');
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    setSelectedDocumentId('');
    setDocumentDetail(null);
    setDraft(createEmptyDraft());
    void loadDocuments('');
  }, [actorId, projectId, statusFilter]);

  useEffect(() => {
    void loadDocument(selectedDocumentId);
  }, [selectedDocumentId]);

  async function handleSave() {
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
        ? await api.updateProjectDocument(actorId, projectId, documentDetail.id, payload)
        : await api.createProjectDocument(actorId, projectId, payload);

      setDocumentDetail(response.document);
      setDraft(mapDocumentToDraft(response.document));
      setSelectedDocumentId(response.document.id);
      await loadDocuments(response.document.id);
      onFeedback(documentDetail ? '项目文档已保存' : '项目文档已创建');
    } catch (error) {
      onFeedback((error as Error).message || '项目文档保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!documentDetail) {
      setDraft(createEmptyDraft());
      onFeedback('已清空新文档草稿');
      return;
    }

    const confirmed = window.confirm(`确认删除文档「${documentDetail.title}」吗？`);
    if (!confirmed) return;

    setDeleting(true);

    try {
      await api.deleteProjectDocument(actorId, projectId, documentDetail.id);
      setSelectedDocumentId('');
      setDocumentDetail(null);
      setDraft(createEmptyDraft());
      await loadDocuments('');
      onFeedback('项目文档已删除');
    } catch (error) {
      onFeedback((error as Error).message || '项目文档删除失败');
    } finally {
      setDeleting(false);
    }
  }

  function handleCreateDraft() {
    setSelectedDocumentId('');
    setDocumentDetail(null);
    setDraft(createEmptyDraft());
  }

  async function handleSeedDefaults() {
    setSeedingDefaults(true);

    try {
      const response = await api.seedDefaultProjectDocuments(actorId, projectId);
      await loadDocuments(selectedDocumentId || '');
      onFeedback(
        response.seededDocumentCount > 0
          ? `已补齐 ${response.seededDocumentCount} 篇默认项目模板`
          : '当前项目默认模板已齐全，无需补齐',
      );
    } catch (error) {
      onFeedback((error as Error).message || '补齐默认项目模板失败');
    } finally {
      setSeedingDefaults(false);
    }
  }

  return (
    <div className="documents-workbench">
      <section className="section documents-sidebar">
        <div className="section-head">
          <div>
            <p className="eyebrow">Project Docs</p>
            <h3>项目文档</h3>
          </div>
          <div className="button-row">
            <button className="ghost" type="button" onClick={handleSeedDefaults} disabled={seedingDefaults || saving || deleting}>
              {seedingDefaults ? '补齐中...' : '补齐默认模板'}
            </button>
            <button className="secondary" type="button" onClick={handleCreateDraft}>
            新建文档
            </button>
          </div>
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
            <p className="muted">正在加载文档列表...</p>
          ) : documents.length === 0 ? (
            <div className="empty-card">
              <p>当前筛选条件下还没有文档。</p>
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
            <h3>{documentDetail ? `编辑文档 · ${documentDetail.title}` : '新建文档'}</h3>
          </div>
          <div className="button-row">
            <button className="secondary" type="button" onClick={handleDelete} disabled={saving || deleting}>
              {documentDetail ? (deleting ? '删除中...' : '删除文档') : '清空草稿'}
            </button>
            <button className="primary" type="button" onClick={handleSave} disabled={saving || loadingDetail}>
              {saving ? '保存中...' : documentDetail ? '保存修改' : '创建文档'}
            </button>
          </div>
        </div>

        {loadingDetail ? <p className="muted">正在加载文档详情...</p> : null}

        <div className="documents-meta-grid">
          <label className="field">
            <span>标题</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="例如：销售标准话术"
            />
          </label>

          <label className="field">
            <span>Slug</span>
            <input
              value={draft.slug}
              onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
              placeholder="sales-script"
            />
          </label>

          <label className="field">
            <span>状态</span>
            <select
              value={draft.status}
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
              onChange={(event) => setDraft((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))}
            />
          </label>
        </div>

        <label className="field">
          <span>描述</span>
          <textarea
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="给管理员和工具检索看的简短描述"
          />
        </label>

        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={draft.isEntry}
            onChange={(event) => setDraft((current) => ({ ...current, isEntry: event.target.checked }))}
          />
          <span>作为项目默认入口文档</span>
        </label>

        <label className="field">
          <span>Markdown 正文</span>
          <textarea
            className="documents-markdown-input"
            rows={20}
            value={draft.contentMd}
            onChange={(event) => setDraft((current) => ({ ...current, contentMd: event.target.value }))}
            placeholder={'# 文档标题\n\n这里填写项目知识正文。'}
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
