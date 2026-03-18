import { DatabaseTablePanel } from './components/DatabaseTablePanel';
import { useEffect, useState } from 'react';
import { formatTimeToShanghai } from './lib/time';
import { ProjectReportPanel } from './components/ProjectReportPanel';
import { ProjectTopicStatsPanel } from './components/ProjectTopicStatsPanel';
import { api } from './lib/api';
import type {
  ActorContext,
  AgentOption,
  JobDetail,
  JobItem,
  ProjectMember,
  ProjectMemberAssistant,
  ProjectSummary,
  ProjectTemplate,
  UserOption,
} from './types';

type TabKey = 'members' | 'assistant' | 'data' | 'topic' | 'browser';
type PortalMode = 'system' | 'workspace' | 'empty';
type WorkbenchMode = 'system' | 'workspace';
type SystemPage = 'project-list' | 'project-create' | 'project-detail';

function formatTime(value?: string | null) {
  return formatTimeToShanghai(value);
}

function normalizeProject(project: ProjectSummary) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt ?? project.created_at ?? '',
    updatedAt: project.updatedAt ?? project.updated_at ?? '',
    adminCount: project.adminCount ?? Number(project.admin_count ?? 0),
    memberCount: project.memberCount ?? Number(project.member_count ?? 0),
  };
}

function getAssistantLabel(assistant: ProjectMemberAssistant) {
  return assistant.title?.trim() || assistant.slug?.trim() || assistant.id;
}

function getMemberStatusText(member: ProjectMember) {
  if (member.role === 'admin') {
    return '项目管理员，仅展示当前助手';
  }

  if (member.projectManagedStatus === 'provisioned') {
    return `项目助手：${member.projectManagedAssistantTitle ?? '已配置'}`;
  }

  if (member.projectManagedStatus === 'failed') {
    return member.projectManagedMessage
      ? `项目助手配置失败：${member.projectManagedMessage}`
      : '项目助手配置失败';
  }

  if (member.projectManagedStatus === 'skipped') {
    return '项目助手最近一次任务被跳过';
  }

  return '未配置项目助手';
}

function getStatusClass(member: ProjectMember) {
  if (member.projectManagedStatus === 'provisioned') return 'managed';
  if (member.projectManagedStatus === 'failed') return 'failed';
  return '';
}

function getRoleLabel(role: ProjectMember['role']) {
  return role === 'admin' ? '管理员' : '成员';
}

type WorkbenchProps = {
  actorId: string;
  mode: WorkbenchMode;
  projectDetail: ProjectSummary;
  selectedTab: TabKey;
  setSelectedTab: (tab: TabKey) => void;
  admins: ProjectMember[];
  members: ProjectMember[];
  memberEmails: string;
  setMemberEmails: (value: string) => void;
  memberRole: 'admin' | 'member';
  setMemberRole: (value: 'admin' | 'member') => void;
  handleAddMembers: () => Promise<void>;
  handleUpdateMemberRole: (userId: string, role: 'admin' | 'member') => Promise<void>;
  handleRemoveMember: (userId: string) => Promise<void>;
  loadingDetail: boolean;
  template: ProjectTemplate | null;
  templateAdminId: string;
  handleTemplateAdminChange: (value: string) => void;
  agents: AgentOption[];
  loadingAgentOptions: boolean;
  selectedAgentId: string;
  setSelectedAgentId: (value: string) => void;
  copySkills: boolean;
  setCopySkills: (value: boolean) => void;
  setDefaultAgent: boolean;
  setSetDefaultAgent: (value: boolean) => void;
  templateDirty: boolean;
  hasSavedTemplate: boolean;
  handleSaveTemplate: () => Promise<void>;
  handleRunProvision: (jobType: 'configure' | 'refresh') => Promise<void>;
  job: JobDetail | null;
  jobItems: JobItem[];
  setFeedback: (value: string) => void;
  handleDeleteProject?: () => Promise<void>;
};

function ProjectWorkbench({
  actorId,
  mode,
  projectDetail,
  selectedTab,
  setSelectedTab,
  admins,
  members,
  memberEmails,
  setMemberEmails,
  memberRole,
  setMemberRole,
  handleAddMembers,
  handleUpdateMemberRole,
  handleRemoveMember,
  loadingDetail,
  template,
  templateAdminId,
  handleTemplateAdminChange,
  agents,
  loadingAgentOptions,
  selectedAgentId,
  setSelectedAgentId,
  copySkills,
  setCopySkills,
  setDefaultAgent,
  setSetDefaultAgent,
  templateDirty,
  hasSavedTemplate,
  handleSaveTemplate,
  handleRunProvision,
  job,
  jobItems,
  setFeedback,
  handleDeleteProject,
}: WorkbenchProps) {
  const rows = [...admins, ...members];
  const hasCurrentAgentSelection = agents.some((agent) => agent.id === selectedAgentId);

  return (
    <>
      <div className="hero-card">
        <div>
          <p className="eyebrow">{mode === 'system' ? 'Project' : 'Workspace'}</p>
          <h2>{projectDetail.name}</h2>
          <p>{projectDetail.description || '暂无项目描述'}</p>
        </div>
        <div className="hero-side">
          <span>管理员 {projectDetail.adminCount}</span>
          <span>成员 {projectDetail.memberCount}</span>
          <span>更新时间 {formatTime(projectDetail.updatedAt)}</span>
          {handleDeleteProject ? (
            <button className="danger" onClick={() => void handleDeleteProject()}>
              删除项目
            </button>
          ) : null}
        </div>
      </div>

      <div className="tabs">
        <button className={selectedTab === 'members' ? 'active' : ''} onClick={() => setSelectedTab('members')}>
          成员管理
        </button>
        <button className={selectedTab === 'assistant' ? 'active' : ''} onClick={() => setSelectedTab('assistant')}>
          助手配置
        </button>
        <button className={selectedTab === 'browser' ? 'active' : ''} onClick={() => setSelectedTab('browser')}>
          数据查看
        </button>
        <button className={selectedTab === 'data' ? 'active' : ''} onClick={() => setSelectedTab('data')}>
          数据报表
        </button>
        <button className={selectedTab === 'topic' ? 'active' : ''} onClick={() => setSelectedTab('topic')}>
          对话统计
        </button>
      </div>

      {loadingDetail ? <p className="muted">正在加载项目详情...</p> : null}

      {selectedTab === 'members' ? (
        <div className="member-page">
          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Members</p>
                <h3>成员变更</h3>
              </div>
            </div>

            <div className="member-form-grid">
              <label className="field field-grow">
                <span>邮箱列表</span>
                <textarea
                  rows={5}
                  value={memberEmails}
                  onChange={(event) => setMemberEmails(event.target.value)}
                  placeholder={'一行一个邮箱\nexample@company.com'}
                />
              </label>

              <div className="member-form-side">
                <label className="field">
                  <span>角色</span>
                  <select
                    value={memberRole}
                    onChange={(event) => setMemberRole(event.target.value as 'admin' | 'member')}
                  >
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
                <button className="primary wide" onClick={() => void handleAddMembers()}>
                  提交成员变更
                </button>
              </div>
            </div>
          </section>

          <section className="section section-wide">
            <div className="section-head">
              <div>
                <p className="eyebrow">Roster</p>
                <h3>项目成员表</h3>
              </div>
              <span className="muted">共 {rows.length} 人</span>
            </div>

            <div className="table-wrap">
              <table className="member-table">
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>角色</th>
                    <th>加入时间</th>
                    <th>项目助手状态</th>
                    <th>当前助手</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((member) => (
                    <tr key={member.userId}>
                      <td className="member-name-cell">
                        <strong>{member.displayName}</strong>
                        <span className="member-subtext">{member.email ?? member.userId}</span>
                      </td>
                      <td>
                        <span className={`role-pill${member.role === 'admin' ? ' admin' : ''}`}>
                          {getRoleLabel(member.role)}
                        </span>
                      </td>
                      <td>{formatTime(member.joinedAt)}</td>
                      <td>
                        <div className={`member-status${getStatusClass(member) ? ` ${getStatusClass(member)}` : ''}`}>
                          {getMemberStatusText(member)}
                        </div>
                      </td>
                      <td>
                        <div className="assistant-summary">
                          <span className="member-subtext">共 {member.assistantCount} 个</span>
                          {member.assistants.length > 0 ? (
                            <div className="assistant-chips">
                              {member.assistants.map((assistant) => (
                                <span
                                  key={assistant.id}
                                  className={`assistant-chip${assistant.isProjectManaged ? ' managed' : ''}`}
                                >
                                  {getAssistantLabel(assistant)}
                                  {assistant.isProjectManaged ? <small>项目</small> : null}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="member-empty">暂无助手</span>
                          )}
                        </div>
                      </td>
                      <td className="member-table-actions">
                        <div className="button-row member-action-row">
                          {member.role === 'member' ? (
                            <>
                              <button className="secondary" onClick={() => void handleUpdateMemberRole(member.userId, 'admin')}>
                                设为管理员
                              </button>
                              <button className="ghost" onClick={() => void handleRemoveMember(member.userId)}>
                                移除
                              </button>
                            </>
                          ) : template?.template_user_id === member.userId ? (
                            <span className="muted">当前模板管理员</span>
                          ) : admins.length > 1 ? (
                            <>
                              <button className="secondary" onClick={() => void handleUpdateMemberRole(member.userId, 'member')}>
                                降为成员
                              </button>
                              <button className="ghost" onClick={() => void handleRemoveMember(member.userId)}>
                                移除
                              </button>
                            </>
                          ) : (
                            <span className="muted">需保留至少一名管理员</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {selectedTab === 'assistant' ? (
        <div className="detail-grid">
          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Template</p>
                <h3>模板选择</h3>
              </div>
            </div>

            <label className="field">
              <span>模板管理员</span>
              <select value={templateAdminId} onChange={(event) => handleTemplateAdminChange(event.target.value)}>
                <option value="">请选择管理员</option>
                {admins.map((admin) => (
                  <option key={admin.userId} value={admin.userId}>
                    {admin.displayName} ({admin.email ?? admin.userId})
                  </option>
                ))}
              </select>
            </label>
            {loadingAgentOptions ? <p className="muted">Loading template agents...</p> : null}
            {!loadingAgentOptions && templateAdminId && agents.length === 0 ? (
              <p className="muted">No template agents available for this admin.</p>
            ) : null}

            <div className="agent-list">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className={`agent-card${selectedAgentId === agent.id ? ' active' : ''}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <strong>{agent.title || agent.slug || agent.id}</strong>
                  <span>技能 {agent.skillCount}</span>
                  <small>更新于 {formatTime(agent.updatedAt)}</small>
                </button>
              ))}
            </div>

            <label className="toggle-row">
              <input type="checkbox" checked={copySkills} onChange={(event) => setCopySkills(event.target.checked)} />
              <span>复制模板管理员的全部技能</span>
            </label>

            <button
              className="primary wide"
              disabled={loadingAgentOptions || !templateAdminId || !selectedAgentId || !hasCurrentAgentSelection}
              onClick={() => void handleSaveTemplate()}
            >
              保存模板配置
            </button>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <p className="eyebrow">Provision</p>
                <h3>批量助手配置</h3>
              </div>
            </div>

            <div className="template-summary">
              <p>当前模板助手：{template?.template_agent_title ?? '未配置'}</p>
              <p>
                模板用户：
                {template?.template_user_display_name
                  ? `${template.template_user_display_name} (${template?.template_user_email ?? template?.template_user_id ?? ''})`
                  : (template?.template_user_email ?? template?.template_user_id ?? '未配置')}
              </p>
              <p>技能数：{template?.template_skill_count ?? 0}</p>
              <p>更新时间：{formatTime(template?.updated_at)}</p>
              {!hasSavedTemplate ? <p className="danger-text">当前项目还没有已保存模板。</p> : null}
              {templateDirty ? <p className="danger-text">当前模板选择有未保存变更。</p> : null}
            </div>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={setDefaultAgent}
                onChange={(event) => setSetDefaultAgent(event.target.checked)}
              />
              <span>目标用户若没有默认助手，则写入默认助手</span>
            </label>

            <div className="button-row">
              <button
                className="primary"
                disabled={!hasSavedTemplate || templateDirty}
                onClick={() => void handleRunProvision('configure')}
              >
                为成员配置助手
              </button>
              <button
                className="secondary"
                disabled={!hasSavedTemplate || templateDirty}
                onClick={() => void handleRunProvision('refresh')}
              >
                刷新成员助手
              </button>
            </div>

            <div className="job-panel">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Job</p>
                  <h3>最近任务</h3>
                </div>
              </div>

              {job ? (
                <>
                  <p>状态：{job.status}</p>
                  <p>
                    总数 {job.total_count} / 成功 {job.success_count} / 失败 {job.failed_count} / 跳过 {job.skipped_count}
                  </p>
                  <p>开始：{formatTime(job.started_at)}</p>
                  <p>结束：{formatTime(job.finished_at)}</p>
                  {job.error_message ? <p className="danger-text">{job.error_message}</p> : null}

                  <div className="job-items">
                    {jobItems.map((item) => (
                      <div key={item.user_id} className="job-item">
                        <strong>
                          {item.user_display_name
                            ? `${item.user_display_name} (${item.user_email ?? item.user_id})`
                            : item.user_email ?? item.user_id}
                        </strong>
                        <span>{item.status}</span>
                        <small>{item.message ?? '-'}</small>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="muted">尚未触发任务</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {selectedTab === 'browser' ? (
        <DatabaseTablePanel
          actorId={actorId}
          onFeedback={setFeedback}
        />
      ) : null}

      {selectedTab === 'data' ? (
        <ProjectReportPanel
          actorId={actorId}
          projectId={projectDetail.id}
          projectMembers={rows}
          onFeedback={setFeedback}
        />
      ) : null}

      {selectedTab === 'topic' ? (
        <ProjectTopicStatsPanel
          actorId={actorId}
          projectId={projectDetail.id}
          onFeedback={setFeedback}
        />
      ) : null}
    </>
  );
}

type SystemHeaderProps = {
  currentPage: SystemPage;
  projectCount: number;
  activeProjectName?: string;
  onShowProjectList: () => void;
  onShowCreatePage: () => void;
};

function SystemHeader({
  currentPage,
  projectCount,
  activeProjectName,
  onShowProjectList,
  onShowCreatePage,
}: SystemHeaderProps) {
  return (
    <section className="section system-header">
      <div className="section-head">
        <div>
          <p className="eyebrow">System</p>
          <h2>Project Administration</h2>
        </div>
        <span className="muted">Projects {projectCount}</span>
      </div>

      <div className="tabs system-tabs">
        <button className={currentPage === 'project-list' ? 'active' : ''} onClick={onShowProjectList}>
          Project List
        </button>
        <button className={currentPage === 'project-create' ? 'active' : ''} onClick={onShowCreatePage}>
          New Project
        </button>
        {currentPage === 'project-detail' && activeProjectName ? (
          <span className="system-badge">Current: {activeProjectName}</span>
        ) : null}
      </div>
    </section>
  );
}

type SystemProjectListPageProps = {
  projects: ProjectSummary[];
  selectedProjectId: string;
  onRefresh: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
  onShowCreatePage: () => void;
};

function SystemProjectListPage({
  projects,
  selectedProjectId,
  onRefresh,
  onOpenProject,
  onShowCreatePage,
}: SystemProjectListPageProps) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>Project List</h2>
        </div>
        <div className="button-row">
          <button className="ghost" onClick={() => void onRefresh()}>
            Refresh
          </button>
          <button className="primary" onClick={onShowCreatePage}>
            New Project
          </button>
        </div>
      </div>

      {projects.length > 0 ? (
        <div className="project-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`project-card${selectedProjectId === project.id ? ' active' : ''}`}
              onClick={() => onOpenProject(project.id)}
            >
              <div>
                <strong>{project.name}</strong>
                <p>{project.description || 'No description'}</p>
              </div>
              <div className="project-meta">
                <span>Admins {project.adminCount}</span>
                <span>Members {project.memberCount}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-card">
          <p>No projects yet.</p>
          <p>Create the first project from the new project page.</p>
        </div>
      )}
    </section>
  );
}

type SystemProjectCreatePageProps = {
  createName: string;
  setCreateName: (value: string) => void;
  createDescription: string;
  setCreateDescription: (value: string) => void;
  userKeyword: string;
  setUserKeyword: (value: string) => void;
  userOptions: UserOption[];
  selectedAdmins: UserOption[];
  onSearchUsers: () => Promise<void>;
  onAddAdminCandidate: (user: UserOption) => void;
  onRemoveAdminCandidate: (userId: string) => void;
  onCreateProject: () => Promise<void>;
  onShowProjectList: () => void;
};

function SystemProjectCreatePage({
  createName,
  setCreateName,
  createDescription,
  setCreateDescription,
  userKeyword,
  setUserKeyword,
  userOptions,
  selectedAdmins,
  onSearchUsers,
  onAddAdminCandidate,
  onRemoveAdminCandidate,
  onCreateProject,
  onShowProjectList,
}: SystemProjectCreatePageProps) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <p className="eyebrow">Create</p>
          <h2>New Project</h2>
        </div>
        <button className="ghost" onClick={onShowProjectList}>
          Back to List
        </button>
      </div>

      <label className="field">
        <span>Project Name</span>
        <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="Customer Success" />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} rows={3} />
      </label>

      <div className="search-row">
        <label className="field grow">
          <span>Search Project Admins</span>
          <input value={userKeyword} onChange={(event) => setUserKeyword(event.target.value)} />
        </label>
        <button className="secondary" onClick={() => void onSearchUsers()}>
          Search
        </button>
      </div>

      <div className="result-list">
        {userOptions.map((user) => (
          <button key={user.id} className="result-item" onClick={() => onAddAdminCandidate(user)}>
            <strong>{user.displayName}</strong>
            <span>{user.email ?? user.id}</span>
          </button>
        ))}
      </div>

      <div className="chips">
        {selectedAdmins.map((user) => (
          <span key={user.id} className="chip">
            {user.displayName}
            <button onClick={() => onRemoveAdminCandidate(user.id)}>x</button>
          </span>
        ))}
      </div>

      <button className="primary wide" onClick={() => void onCreateProject()}>
        Create Project
      </button>
    </section>
  );
}

export default function App() {
  const [actorInput, setActorInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [actorId, setActorId] = useState('');
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [systemPage, setSystemPage] = useState<SystemPage>('project-list');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const [selectedTab, setSelectedTab] = useState<TabKey>('members');
  const [projectDetail, setProjectDetail] = useState<ProjectSummary | null>(null);
  const [admins, setAdmins] = useState<ProjectMember[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [templateAdminId, setTemplateAdminId] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgentOptions, setLoadingAgentOptions] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [copySkills, setCopySkills] = useState(true);
  const [setDefaultAgent, setSetDefaultAgent] = useState(false);
  const [latestJobId, setLatestJobId] = useState('');
  const [job, setJob] = useState<JobDetail | null>(null);
  const [jobItems, setJobItems] = useState<JobItem[]>([]);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [userKeyword, setUserKeyword] = useState('');
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedAdmins, setSelectedAdmins] = useState<UserOption[]>([]);
  const [memberEmails, setMemberEmails] = useState('');
  const [memberRole, setMemberRole] = useState<'admin' | 'member'>('member');
  const [feedback, setFeedback] = useState('准备就绪');
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [legacyStatus, setLegacyStatus] = useState<{
    triggerInstalled: boolean;
    triggerEnabled: boolean;
    configEnabled: boolean | null;
    templateUserId: string | null;
    templateAgentId: string | null;
    updatedAt: string | null;
  } | null>(null);

  useEffect(() => {
    const savedActorEmail = window.localStorage.getItem('lobehub-admin-last-email');
    if (savedActorEmail) {
      setActorInput(savedActorEmail);
    }

    void api
      .getActorContext()
      .then((result) => {
        setActorInput(result.actor.email ?? savedActorEmail ?? '');
        setActorId(result.actor.id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!actorId || !actorInput.trim()) return;
    window.localStorage.setItem('lobehub-admin-last-email', actorInput.trim());
  }, [actorId, actorInput]);

  useEffect(() => {
    void api
      .getSystemStatus()
      .then((result) => setLegacyStatus(result.legacyAutoProvision))
      .catch((error: Error) => setFeedback(error.message));
  }, []);

  useEffect(() => {
    if (!actorId) {
      setActorContext(null);
      setProjects([]);
      setSystemPage('project-list');
      setSelectedProjectId('');
      resetProjectWorkspace();
      return;
    }

    let cancelled = false;

    async function loadAccessBundle() {
      setLoadingAccess(true);
      setActorContext(null);
      setProjects([]);
      setSystemPage('project-list');
      setSelectedProjectId('');
      resetProjectWorkspace();

      try {
        const [contextResult, projectsResult] = await Promise.all([
          api.getActorContext(actorId),
          api.listProjects(actorId),
        ]);

        if (cancelled) return;

        const normalizedProjects = projectsResult.projects.map(normalizeProject);
        setActorContext(contextResult);
        setProjects(normalizedProjects);
        setSelectedProjectId(contextResult.isSystemAdmin ? '' : normalizedProjects[0]?.id ?? '');
        setFeedback(
          contextResult.isSystemAdmin
            ? `已进入系统管理员后台：${contextResult.actor.displayName}`
            : normalizedProjects.length > 0
              ? `已进入项目工作台：${contextResult.actor.displayName}`
              : `当前用户没有项目管理权限：${contextResult.actor.displayName}`,
        );
      } catch (error) {
        if (cancelled) return;
        setActorContext(null);
        setProjects([]);
        setSelectedProjectId('');
        setFeedback((error as Error).message);
      } finally {
        if (!cancelled) {
          setLoadingAccess(false);
        }
      }
    }

    void loadAccessBundle();

    return () => {
      cancelled = true;
    };
  }, [actorId]);

  useEffect(() => {
    if (!actorContext || !selectedProjectId || !actorId) return;

    let cancelled = false;

    async function loadProjectBundle() {
      setLoadingDetail(true);
      setLatestJobId('');
      setJob(null);
      setJobItems([]);
      setAgents([]);
      setLoadingAgentOptions(false);

      try {
        const [projectResult, membersResult, templateResult] = await Promise.all([
          api.getProject(actorId, selectedProjectId),
          api.getMembers(actorId, selectedProjectId),
          api.getTemplate(actorId, selectedProjectId),
        ]);

        if (cancelled) return;

        setProjectDetail(projectResult.project ? normalizeProject(projectResult.project) : null);
        setAdmins(membersResult.admins);
        setMembers(membersResult.members);
        setTemplate(templateResult.template);
        setTemplateAdminId(templateResult.template?.template_user_id ?? membersResult.admins[0]?.userId ?? '');
        setSelectedAgentId(templateResult.template?.template_agent_id ?? '');
        setCopySkills(templateResult.template?.copy_skills ?? true);
        setFeedback(`已加载项目 ${selectedProjectId}`);
      } catch (error) {
        if (cancelled) return;
        setFeedback((error as Error).message);
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadProjectBundle();

    return () => {
      cancelled = true;
    };
  }, [actorContext, actorId, selectedProjectId, projectReloadKey]);

  useEffect(() => {
    if (!actorId || !selectedProjectId || !templateAdminId) {
      setAgents([]);
      setLoadingAgentOptions(false);
      return;
    }

    let cancelled = false;
    setLoadingAgentOptions(true);

    void api
      .getAgents(actorId, selectedProjectId, templateAdminId)
      .then((result) => {
        if (cancelled) return;
        setAgents(result.agents);
        setSelectedAgentId((current) =>
          result.agents.some((agent) => agent.id === current) ? current : (result.agents[0]?.id ?? ''),
        );
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setAgents([]);
        setFeedback(error.message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAgentOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actorId, selectedProjectId, templateAdminId]);

  useEffect(() => {
    if (!actorId || !selectedProjectId || !latestJobId) return;

    let timer: number | undefined;

    const pull = async () => {
      const result = await api.getJob(actorId, selectedProjectId, latestJobId);
      setJob(result.job);
      setJobItems(result.items);
      if (result.job && ['pending', 'running'].includes(result.job.status)) {
        timer = window.setTimeout(() => void pull(), 2000);
      }
    };

    void pull().catch((error: Error) => setFeedback(error.message));

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [actorId, selectedProjectId, latestJobId]);

  const hasSavedTemplate = Boolean(template?.template_user_id && template?.template_agent_id);
  const templateDirty =
    hasSavedTemplate &&
    (template?.template_user_id !== templateAdminId ||
      template?.template_agent_id !== selectedAgentId ||
      (template?.copy_skills ?? true) !== copySkills);

  const portalMode: PortalMode = actorContext?.isSystemAdmin
    ? 'system'
    : projects.length > 0
      ? 'workspace'
      : 'empty';

  useEffect(() => {
    if (portalMode === 'system' && systemPage === 'project-detail' && !selectedProjectId) {
      setSystemPage('project-list');
    }
  }, [portalMode, selectedProjectId, systemPage]);

  function resetProjectWorkspace() {
    setProjectDetail(null);
    setAdmins([]);
    setMembers([]);
    setTemplate(null);
    setTemplateAdminId('');
    setSelectedAgentId('');
    setAgents([]);
    setLoadingAgentOptions(false);
    setLatestJobId('');
    setJob(null);
    setJobItems([]);
  }

  function openSystemProject(projectId: string) {
    setSelectedTab('members');
    resetProjectWorkspace();
    setSelectedProjectId(projectId);
    setProjectReloadKey((current) => current + 1);
    setSystemPage('project-detail');
  }

  async function refreshAccessBundle() {
    if (!actorId) return;

    setLoadingAccess(true);
    try {
      const [contextResult, projectsResult] = await Promise.all([
        api.getActorContext(actorId),
        api.listProjects(actorId),
      ]);

      const normalizedProjects = projectsResult.projects.map(normalizeProject);
      setActorContext(contextResult);
      setProjects(normalizedProjects);
      setSelectedProjectId((current) => {
        if (current && normalizedProjects.some((project) => project.id === current)) {
          return current;
        }

        return contextResult.isSystemAdmin ? '' : normalizedProjects[0]?.id ?? '';
      });
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setLoadingAccess(false);
    }
  }

  async function refreshProjectMembershipState(projectId: string) {
    if (!actorId) return;

    const [projectResult, membersResult] = await Promise.all([
      api.getProject(actorId, projectId),
      api.getMembers(actorId, projectId),
    ]);

    setProjectDetail(projectResult.project ? normalizeProject(projectResult.project) : null);
    setAdmins(membersResult.admins);
    setMembers(membersResult.members);
  }

  async function handleSearchUsers() {
    if (!actorId) {
      setFeedback('请先载入当前操作者');
      return;
    }

    try {
      const result = await api.searchUsers(actorId, userKeyword);
      setUserOptions(result.users);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  function addAdminCandidate(user: UserOption) {
    if (selectedAdmins.some((item) => item.id === user.id)) return;
    setSelectedAdmins((prev) => [...prev, user]);
  }

  function removeAdminCandidate(userId: string) {
    setSelectedAdmins((prev) => prev.filter((item) => item.id !== userId));
  }

  async function handleCreateProject() {
    if (!actorId) return setFeedback('请先载入当前操作者');
    if (!createName.trim()) return setFeedback('项目名称不能为空');
    if (selectedAdmins.length === 0) return setFeedback('至少选择一个项目管理员');

    try {
      const result = await api.createProject(actorId, {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        adminUserIds: selectedAdmins.map((item) => item.id),
      });

      setCreateName('');
      setCreateDescription('');
      setSelectedAdmins([]);
      setUserOptions([]);
      setUserKeyword('');

      await refreshAccessBundle();
      openSystemProject(result.projectId);
      setFeedback(`项目已创建：${result.projectId}`);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function handleDeleteProject() {
    if (!actorId || !projectDetail) return;
    if (!window.confirm(`确认删除项目「${projectDetail.name}」？`)) return;

    try {
      await api.deleteProject(actorId, projectDetail.id);
      await refreshAccessBundle();
      resetProjectWorkspace();
      setSelectedProjectId('');
      setSystemPage('project-list');
      setFeedback(`项目已删除：${projectDetail.name}`);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function handleAddMembers() {
    if (!actorId || !selectedProjectId) return setFeedback('请先选择项目并载入操作者');

    const emails = memberEmails
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    if (emails.length === 0) return setFeedback('请输入至少一个邮箱');

    try {
      const result = await api.addMembers(actorId, selectedProjectId, emails, memberRole);
      setMemberEmails('');
      setFeedback(`成员处理完成：${result.results.map((item) => `${item.email}:${item.status}`).join('，')}`);
      await refreshProjectMembershipState(selectedProjectId);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function handleUpdateMemberRole(userId: string, role: 'admin' | 'member') {
    if (!actorId || !selectedProjectId) return setFeedback('请先选择项目并载入操作者');

    const targetMember = [...admins, ...members].find((member) => member.userId === userId);
    const actionLabel = role === 'admin' ? '设为管理员' : '降为成员';
    const targetLabel = targetMember?.displayName ?? targetMember?.email ?? userId;

    if (!window.confirm(`确认将 ${targetLabel} ${actionLabel}？`)) return;

    try {
      await api.updateMemberRole(actorId, selectedProjectId, userId, role);
      setFeedback(`${targetLabel} 已${actionLabel}`);
      await refreshProjectMembershipState(selectedProjectId);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!actorId || !selectedProjectId) return setFeedback('请先选择项目并载入操作者');

    const targetMember = [...admins, ...members].find((member) => member.userId === userId);
    const targetLabel = targetMember?.displayName ?? targetMember?.email ?? userId;

    if (!window.confirm(`确认移除 ${targetLabel}？`)) return;

    try {
      await api.removeMember(actorId, selectedProjectId, userId);
      setFeedback(`成员已移除：${targetLabel}`);
      await refreshProjectMembershipState(selectedProjectId);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  function handleTemplateAdminChange(nextTemplateAdminId: string) {
    setTemplateAdminId(nextTemplateAdminId);
    setAgents([]);
    setSelectedAgentId('');
    setLoadingAgentOptions(Boolean(nextTemplateAdminId));
  }

  async function handleSaveTemplate() {
    if (!actorId || !selectedProjectId || !templateAdminId || !selectedAgentId) {
      return setFeedback('模板用户和模板助手都必须选择');
    }

    try {
      if (loadingAgentOptions) {
        return setFeedback('Template agent list is still loading. Please try again.');
      }

      if (!agents.some((agent) => agent.id === selectedAgentId)) {
        return setFeedback('The selected template agent does not belong to the current template admin.');
      }

      const result = await api.setTemplate(actorId, selectedProjectId, {
        templateUserId: templateAdminId,
        templateAgentId: selectedAgentId,
        copySkills,
      });

      setTemplate(result.template);
      setFeedback('模板已保存');
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function handleRunProvision(jobType: 'configure' | 'refresh') {
    if (!actorId || !selectedProjectId) return setFeedback('请先选择项目并载入操作者');
    if (!hasSavedTemplate) return setFeedback('请先保存模板配置，再执行批量助手配置');
    if (templateDirty) return setFeedback('当前模板选择有未保存变更，请先保存');

    try {
      const result = jobType === 'configure'
        ? await api.runProvision(actorId, selectedProjectId, setDefaultAgent)
        : await api.runRefresh(actorId, selectedProjectId, setDefaultAgent);
      setLatestJobId(result.jobId);
      setFeedback(`任务已启动：${result.jobId}`);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function applyActor() {
    const nextActorEmail = actorInput.trim().toLowerCase();

    if (!nextActorEmail) {
      setFeedback('请输入登录邮箱');
      return;
    }

    if (!passwordInput) {
      setFeedback('请输入登录密码');
      return;
    }

    try {
      const result = await api.login(nextActorEmail, passwordInput);
      setSelectedTab('members');
      setSystemPage('project-list');
      setActorInput(result.actor.email ?? nextActorEmail);
      setPasswordInput('');
      setActorId(result.actor.id);
      setFeedback(`已登录：${result.actor.displayName}`);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }

  async function clearActor() {
    try {
      await api.logout();
    } catch (error) {
      setFeedback((error as Error).message);
    }

    setActorId('');
    setActorContext(null);
    setProjects([]);
    setSystemPage('project-list');
    setSelectedProjectId('');
    resetProjectWorkspace();
    setPasswordInput('');
    setFeedback('已退出当前后台');
  }

  const statusTarget = portalMode === 'system'
    ? systemPage === 'project-list'
      ? 'Project list'
      : systemPage === 'project-create'
        ? 'New project'
        : projectDetail?.name ?? 'No project selected'
    : projectDetail?.name ?? 'No project selected';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LobeHub Admin Module</p>
          <h1>{actorContext?.isSystemAdmin ? '系统管理员后台' : portalMode === 'workspace' ? '项目工作台' : '管理后台入口'}</h1>
        </div>

        <div className="actor-box actor-actions">
          {!actorContext ? (
            <>
              <label>后台登录</label>
              <div className="actor-row actor-login-row">
                <input
                  value={actorInput}
                  onChange={(event) => setActorInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void applyActor();
                  }}
                  placeholder="name@example.com"
                />
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(event) => setPasswordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void applyActor();
                  }}
                  placeholder="请输入密码"
                />
                <button className="primary" onClick={() => void applyActor()}>
                  登录
                </button>
              </div>
            </>
          ) : (
            <div className="actor-session-card">
              <div>
                <label>当前账户</label>
                <strong>{actorContext.actor.displayName}</strong>
                <span className="muted">{actorContext.actor.email ?? actorContext.actor.id}</span>
                <span className="muted">
                  {actorContext.isSystemAdmin ? '系统管理员' : `项目管理员 · 管理项目 ${projects.length}`}
                </span>
              </div>
              <button className="ghost" onClick={() => void clearActor()}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      {legacyStatus?.triggerEnabled && legacyStatus.configEnabled ? (
        <div className="legacy-warning">
          <strong>旧的全局自动下发仍处于启用状态。</strong>
          <span>
            新用户注册后仍会自动复制模板助手，这会与当前项目级管理逻辑冲突。若要切到“注册后空白账号”，请执行
            `lobehub-admin-module/sql/002_disable_global_auto_provision.sql`。
          </span>
        </div>
      ) : null}

      {!actorId ? (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <div className="empty-state">
              <p className="eyebrow">Entry</p>
              <h2>先输入后台账号密码再进入管理台</h2>
              <p>系统管理员会进入平台管理台，项目管理员会进入自己的项目工作台。</p>
            </div>
          </section>
        </main>
      ) : loadingAccess ? (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <div className="empty-state">
              <p className="eyebrow">Loading</p>
              <h2>正在识别当前角色和项目权限</h2>
            </div>
          </section>
        </main>
      ) : portalMode === 'system' ? (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <SystemHeader
              currentPage={systemPage}
              projectCount={projects.length}
              activeProjectName={projectDetail?.name}
              onShowProjectList={() => setSystemPage('project-list')}
              onShowCreatePage={() => setSystemPage('project-create')}
            />

            {systemPage === 'project-list' ? (
              <SystemProjectListPage
                projects={projects}
                selectedProjectId={selectedProjectId}
                onRefresh={refreshAccessBundle}
                onOpenProject={openSystemProject}
                onShowCreatePage={() => setSystemPage('project-create')}
              />
            ) : null}

            {systemPage === 'project-create' ? (
              <SystemProjectCreatePage
                createName={createName}
                setCreateName={setCreateName}
                createDescription={createDescription}
                setCreateDescription={setCreateDescription}
                userKeyword={userKeyword}
                setUserKeyword={setUserKeyword}
                userOptions={userOptions}
                selectedAdmins={selectedAdmins}
                onSearchUsers={handleSearchUsers}
                onAddAdminCandidate={addAdminCandidate}
                onRemoveAdminCandidate={removeAdminCandidate}
                onCreateProject={handleCreateProject}
                onShowProjectList={() => setSystemPage('project-list')}
              />
            ) : null}

            {systemPage === 'project-detail' ? (
              !selectedProjectId || !projectDetail ? (
                <div className="empty-state">
                  <p className="eyebrow">Project</p>
                  <h2>Select a project from the list</h2>
                  <p>Project detail is now separated from the list and create views.</p>
                </div>
              ) : (
                <ProjectWorkbench
                  actorId={actorId}
                  mode="system"
                  projectDetail={projectDetail}
                  selectedTab={selectedTab}
                  setSelectedTab={setSelectedTab}
                  admins={admins}
                  members={members}
                  memberEmails={memberEmails}
                  setMemberEmails={setMemberEmails}
                  memberRole={memberRole}
                  setMemberRole={setMemberRole}
                  handleAddMembers={handleAddMembers}
                  handleUpdateMemberRole={handleUpdateMemberRole}
                  handleRemoveMember={handleRemoveMember}
                  loadingDetail={loadingDetail}
                  template={template}
                  templateAdminId={templateAdminId}
                  handleTemplateAdminChange={handleTemplateAdminChange}
                  agents={agents}
                  loadingAgentOptions={loadingAgentOptions}
                  selectedAgentId={selectedAgentId}
                  setSelectedAgentId={setSelectedAgentId}
                  copySkills={copySkills}
                  setCopySkills={setCopySkills}
                  setDefaultAgent={setDefaultAgent}
                  setSetDefaultAgent={setSetDefaultAgent}
                  templateDirty={templateDirty}
                  hasSavedTemplate={hasSavedTemplate}
                  handleSaveTemplate={handleSaveTemplate}
                  handleRunProvision={handleRunProvision}
                  job={job}
                  jobItems={jobItems}
                  setFeedback={setFeedback}
                  handleDeleteProject={handleDeleteProject}
                />
              )
            ) : null}
          </section>
        </main>
      ) : false ? (
        <main className="workspace workspace-system">
          <aside className="panel panel-left">
            <section className="section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Create</p>
                  <h2>新建项目</h2>
                </div>
              </div>

              <label className="field">
                <span>项目名称</span>
                <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="客户服务部" />
              </label>

              <label className="field">
                <span>项目描述</span>
                <textarea value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} rows={3} />
              </label>

              <div className="search-row">
                <label className="field grow">
                  <span>搜索项目管理员</span>
                  <input value={userKeyword} onChange={(event) => setUserKeyword(event.target.value)} />
                </label>
                <button className="secondary" onClick={handleSearchUsers}>
                  搜索
                </button>
              </div>

              <div className="result-list">
                {userOptions.map((user) => (
                  <button key={user.id} className="result-item" onClick={() => addAdminCandidate(user)}>
                    <strong>{user.displayName}</strong>
                    <span>{user.email ?? user.id}</span>
                  </button>
                ))}
              </div>

              <div className="chips">
                {selectedAdmins.map((user) => (
                  <span key={user.id} className="chip">
                    {user.displayName}
                    <button onClick={() => removeAdminCandidate(user.id)}>×</button>
                  </span>
                ))}
              </div>

              <button className="primary wide" onClick={handleCreateProject}>
                创建项目
              </button>
            </section>

            <section className="section">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Projects</p>
                  <h2>项目列表</h2>
                </div>
                <button className="ghost" onClick={() => void refreshAccessBundle()}>
                  刷新
                </button>
              </div>

              <div className="project-list">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={`project-card${selectedProjectId === project.id ? ' active' : ''}`}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <div>
                      <strong>{project.name}</strong>
                      <p>{project.description || '暂无描述'}</p>
                    </div>
                    <div className="project-meta">
                      <span>管理员 {project.adminCount}</span>
                      <span>成员 {project.memberCount}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </aside>

          <section className="panel panel-main">
            {!selectedProjectId || !projectDetail ? (
              <div className="empty-state">
                <p className="eyebrow">Project</p>
                <h2>从左侧选择一个项目</h2>
                <p>系统管理员在这里查看项目详情、成员和助手配置。</p>
              </div>
            ) : (
              <ProjectWorkbench
                actorId={actorId}
                mode="system"
                projectDetail={projectDetail!}
                selectedTab={selectedTab}
                setSelectedTab={setSelectedTab}
                admins={admins}
                members={members}
                memberEmails={memberEmails}
                setMemberEmails={setMemberEmails}
                memberRole={memberRole}
                setMemberRole={setMemberRole}
                handleAddMembers={handleAddMembers}
                handleUpdateMemberRole={handleUpdateMemberRole}
                handleRemoveMember={handleRemoveMember}
                loadingDetail={loadingDetail}
                template={template}
                templateAdminId={templateAdminId}
                handleTemplateAdminChange={handleTemplateAdminChange}
                agents={agents}
                loadingAgentOptions={loadingAgentOptions}
                selectedAgentId={selectedAgentId}
                setSelectedAgentId={setSelectedAgentId}
                copySkills={copySkills}
                setCopySkills={setCopySkills}
                setDefaultAgent={setDefaultAgent}
                setSetDefaultAgent={setSetDefaultAgent}
                templateDirty={templateDirty}
                hasSavedTemplate={hasSavedTemplate}
                handleSaveTemplate={handleSaveTemplate}
                handleRunProvision={handleRunProvision}
                job={job}
                jobItems={jobItems}
                setFeedback={setFeedback}
                handleDeleteProject={handleDeleteProject}
              />
            )}
          </section>
        </main>
      ) : portalMode === 'workspace' ? (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <section className="section workspace-switcher">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Workspace</p>
                  <h2>我的项目</h2>
                </div>
                {projects.length > 1 ? <span className="muted">共 {projects.length} 个项目</span> : null}
              </div>

              {projects.length > 1 ? (
                <label className="field">
                  <span>当前项目</span>
                  <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="muted">
                  当前项目：{projects[0]?.name}，项目管理员后台不展示全局项目列表和新建项目入口。
                </p>
              )}
            </section>

            {!selectedProjectId || !projectDetail ? (
              <div className="empty-state">
                <p className="eyebrow">Workspace</p>
                <h2>当前没有可用项目</h2>
              </div>
            ) : (
              <ProjectWorkbench
                actorId={actorId}
                mode="workspace"
                projectDetail={projectDetail!}
                selectedTab={selectedTab}
                setSelectedTab={setSelectedTab}
                admins={admins}
                members={members}
                memberEmails={memberEmails}
                setMemberEmails={setMemberEmails}
                memberRole={memberRole}
                setMemberRole={setMemberRole}
                handleAddMembers={handleAddMembers}
                handleUpdateMemberRole={handleUpdateMemberRole}
                handleRemoveMember={handleRemoveMember}
                loadingDetail={loadingDetail}
                template={template}
                templateAdminId={templateAdminId}
                handleTemplateAdminChange={handleTemplateAdminChange}
                agents={agents}
                loadingAgentOptions={loadingAgentOptions}
                selectedAgentId={selectedAgentId}
                setSelectedAgentId={setSelectedAgentId}
                copySkills={copySkills}
                setCopySkills={setCopySkills}
                setDefaultAgent={setDefaultAgent}
                setSetDefaultAgent={setSetDefaultAgent}
                templateDirty={templateDirty}
                hasSavedTemplate={hasSavedTemplate}
                handleSaveTemplate={handleSaveTemplate}
                handleRunProvision={handleRunProvision}
                job={job}
                jobItems={jobItems}
                setFeedback={setFeedback}
              />
            )}
          </section>
        </main>
      ) : (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <div className="empty-state">
              <p className="eyebrow">No Access</p>
              <h2>当前用户没有项目管理权限</h2>
              <p>如果这是项目管理员账号，请先把它加入项目管理员列表；如果这是系统管理员账号，请加入 system_admins。</p>
            </div>
          </section>
        </main>
      )}

      <footer className="statusbar">
        <span>{feedback}</span>
        <span>{statusTarget}</span>
      </footer>
    </div>
  );
}
