import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { DatabaseTablePanel } from './components/DatabaseTablePanel';
import { api } from './lib/api';
import './styles.css';

type ViewerActorState = {
  actorId: string;
  displayName: string;
  isSystemAdmin: boolean;
  managedProjectCount: number;
};

function DatabaseViewerApp() {
  const [actorInput, setActorInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [actor, setActor] = useState<ViewerActorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('准备就绪');

  useEffect(() => {
    const savedActorEmail = window.localStorage.getItem('lobehub-database-viewer-last-email');

    if (savedActorEmail) {
      setActorInput(savedActorEmail);
    }

    void api
      .getActorContext()
      .then((result) => {
        if (!result.isSystemAdmin && result.managedProjectCount <= 0) {
          setActor(null);
          return;
        }

        setActor({
          actorId: result.actor.id,
          displayName: result.actor.displayName,
          isSystemAdmin: result.isSystemAdmin,
          managedProjectCount: result.managedProjectCount,
        });
        setActorInput(result.actor.email ?? savedActorEmail ?? '');
      })
      .catch(() => undefined);
  }, []);

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

    setLoading(true);

    try {
      const result = await api.login(nextActorEmail, passwordInput);

      if (!result.isSystemAdmin && result.managedProjectCount <= 0) {
        setActor(null);
        setFeedback('当前账号既不是系统管理员，也不是项目管理员，不能查看数据库表数据');
        return;
      }

      setActor({
        actorId: result.actor.id,
        displayName: result.actor.displayName,
        isSystemAdmin: result.isSystemAdmin,
        managedProjectCount: result.managedProjectCount,
      });
      setActorInput(result.actor.email ?? nextActorEmail);
      setPasswordInput('');
      window.localStorage.setItem('lobehub-database-viewer-last-email', result.actor.email ?? nextActorEmail);
      setFeedback(
        result.isSystemAdmin
          ? `已进入数据查看页：${result.actor.displayName}`
          : `已进入项目管理员数据查看页：${result.actor.displayName}`,
      );
    } catch (error) {
      setActor(null);
      setFeedback((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function clearActor() {
    try {
      await api.logout();
    } catch (error) {
      setFeedback((error as Error).message);
    }

    setActor(null);
    setPasswordInput('');
    setFeedback('已退出当前数据查看页');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LobeHub Database Viewer</p>
          <h1>独立数据查看页</h1>
          <p className="muted">这个页面不依赖首页入口，只用于直接查看数据库表数据。</p>
        </div>

        <div className="actor-box actor-actions">
          {!actor ? (
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
                <button className="primary" disabled={loading} onClick={() => void applyActor()}>
                  进入
                </button>
              </div>
            </>
          ) : (
            <div className="actor-session-card">
              <div>
                <label>当前账户</label>
                <strong>{actor.displayName}</strong>
                <span className="muted">
                  {actor.isSystemAdmin ? '系统管理员' : `项目管理员 · 项目数 ${actor.managedProjectCount}`}
                </span>
              </div>
              <button className="ghost" onClick={() => void clearActor()}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      {actor ? (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <DatabaseTablePanel actorId={actor.actorId} onFeedback={setFeedback} />
          </section>
        </main>
      ) : (
        <main className="workspace workspace-single">
          <section className="panel panel-main">
            <div className="empty-state">
              <p className="eyebrow">Entry</p>
              <h2>先输入系统管理员或项目管理员账号密码</h2>
              <p>登录后会直接进入原始表数据查看页面，不经过首页。</p>
            </div>
          </section>
        </main>
      )}

      <footer className="statusbar">
        <span>{feedback}</span>
        <span>{actor ? '当前模式：数据查看' : '当前模式：未登录'}</span>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DatabaseViewerApp />
  </React.StrictMode>,
);
