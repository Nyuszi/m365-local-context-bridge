import { useEffect, useMemo, useState } from 'react';
import { selectAdapter } from '../adapters';
import { PROTOCOL_LIMITS } from '../config/defaults';
import { DEFAULT_EXPLORE_TASK } from '../protocol/bootstrap';
import {
  getModeDescription,
  getModeLabel,
  SESSION_MODES,
  type SessionMode,
} from '../session/modes';
import { sendUi, useBackgroundState } from './useBackgroundState';

interface ActiveTab {
  id: number;
  url: string;
}

type ContextScope = 'project' | 'home';

function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const first = tabs[0];
        if (first?.id !== undefined && first.url) {
          setTab({ id: first.id, url: first.url });
        }
      })
      .catch(() => undefined);
  }, []);
  return tab;
}

function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function shortenPath(path: string): string {
  const home = path.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
  const prefix = home?.[1];
  if (prefix) return path.replace(prefix, '~');
  return path;
}

function openLocalUi(baseUrl: string): void {
  chrome.tabs.create({ url: `${baseUrl.replace(/\/+$/, '')}/local` }).catch(() => undefined);
}

function aliasFromPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? 'project';
  return last.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase() || 'project';
}

export function Popup(): JSX.Element {
  const { state, loading, error, pairingProgress, refresh } = useBackgroundState();
  const activeTab = useActiveTab();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [selectedAlias, setSelectedAlias] = useState<string>('');
  const [selectedMode, setSelectedMode] = useState<SessionMode>('assisted');
  const [contextScope, setContextScope] = useState<ContextScope>('project');
  const [projectPath, setProjectPath] = useState('');
  const [projectAlias, setProjectAlias] = useState('');
  const [homeConfirmed, setHomeConfirmed] = useState(false);

  useEffect(() => {
    if (state?.primaryAlias && !selectedAlias) setSelectedAlias(state.primaryAlias);
    if (state?.settings.mode) setSelectedMode(state.settings.mode);
    if (state?.pendingPickedPath) {
      const picked = state.pendingPickedPath;
      setProjectPath(picked);
      setProjectAlias(aliasFromPath(picked));
      setContextScope('project');
      setActionOk(`Selected ${shortenPath(picked)} — click Approve folder.`);
      void sendUi({ type: 'ui/clear-picked-path' }).catch(() => undefined);
    } else if (state?.homePath && !projectPath) {
      setProjectPath(`${state.homePath}/Documents/projects/`);
    }
  }, [state, selectedAlias, projectPath]);

  const isSupportedTab = useMemo(
    () => (activeTab ? selectAdapter(activeTab.url) !== null : false),
    [activeTab],
  );
  const sessionActive = state?.session.status === 'active';
  const now = useNow(1000, sessionActive === true);
  const homeAlreadyApproved = useMemo(() => {
    if (!state) return false;
    return state.roots.some(
      (r) =>
        r.alias.toLowerCase() === 'home' ||
        (state.homePath !== null && r.path === state.homePath),
    );
  }, [state]);

  async function run(action: () => Promise<unknown>, okMessage?: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    try {
      await action();
      if (okMessage) setActionOk(okMessage);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) {
    return (
      <div className="header">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (error || !state) {
    return (
      <div>
        <div className="header">
          <h1>Local Context Bridge</h1>
        </div>
        <div className="banner error">{error ?? 'Could not reach the extension background.'}</div>
        <button onClick={() => refresh()}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1>Local Context Bridge</h1>
        <button className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
          Settings
        </button>
      </div>

      <div className="status-line" style={{ marginBottom: 12 }}>
        <span className={`status-dot ${state.health.reachable ? 'ok' : 'danger'}`} />
        {state.health.reachable
          ? `Companion online${state.health.version ? ` · v${state.health.version}` : ''}`
          : 'Companion unreachable'}
      </div>

      {!state.health.reachable && (
        <section className="card">
          <h2>Local companion</h2>
          <p className="muted">
            Open <strong>Local Context Bridge.app</strong> once to register the launcher and start
            the companion (no Terminal). Or try Start companion below if the app is already
            installed.
          </p>
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await sendUi({
                    type: 'ui/start-companion',
                    project: projectPath.trim() || undefined,
                    alias: projectAlias.trim() || selectedAlias || 'project',
                  });
                  if (!result.ok) {
                    throw new Error(
                      `${result.error ?? 'Could not start'}${
                        result.installHint
                          ? `\n\n${result.installHint}`
                          : '\n\nOpen Local Context Bridge.app, then try again.'
                      }`,
                    );
                  }
                }, 'Companion started')
              }
            >
              Start companion
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void chrome.tabs
                  .create({ url: 'http://127.0.0.1:32178/setup' })
                  .catch(() => undefined);
                setActionOk('If the companion is offline, open Local Context Bridge.app first.');
              }}
            >
              Open setup
            </button>
          </div>
        </section>
      )}

      {actionError && <div className="banner error" style={{ whiteSpace: 'pre-wrap' }}>{actionError}</div>}
      {actionOk && <div className="banner">{actionOk}</div>}

      {!state.paired ? (
        <section className="card">
          <h2>Pairing</h2>
          {pairingProgress ? (
            <p className="muted">{pairingProgress.message}</p>
          ) : (
            <p className="muted">Pair this extension with your local companion to get started.</p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => void run(() => sendUi({ type: 'ui/start-pairing' }))}
            >
              Start pairing
            </button>
            <button onClick={() => openLocalUi(state.settings.companionBaseUrl)}>
              Open local UI
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>Approved folders</h2>
            <p className="muted" style={{ marginBottom: 8 }}>
              Click <strong>Browse…</strong> to pick a folder on this Mac (opened by the local
              companion). You can still paste a path if you prefer.
            </p>

            <label>Context scope</label>
            <div className="mode-options">
              <label className={`mode-option${contextScope === 'project' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="context-scope"
                  checked={contextScope === 'project'}
                  onChange={() => setContextScope('project')}
                />
                <span>
                  <span className="label">Project folder</span>
                  <br />
                  <span className="desc">Approve one folder Copilot may read.</span>
                </span>
              </label>
              <label className={`mode-option${contextScope === 'home' ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="context-scope"
                  checked={contextScope === 'home'}
                  onChange={() => setContextScope('home')}
                />
                <span>
                  <span className="label">Home folder (broader)</span>
                  <br />
                  <span className="desc">
                    Your user home
                    {state.homePath ? ` (${shortenPath(state.homePath)})` : ''} — not the whole
                    disk.
                  </span>
                </span>
              </label>
            </div>

            {contextScope === 'project' ? (
              <div className="context-panel">
                <label htmlFor="project-path">Folder path</label>
                <div className="row" style={{ marginBottom: 8 }}>
                  <input
                    id="project-path"
                    type="text"
                    placeholder="~/Documents/projects/my-app"
                    value={projectPath}
                    onChange={(e) => {
                      const next = e.target.value;
                      setProjectPath(next);
                      if (!projectAlias || projectAlias === aliasFromPath(projectPath)) {
                        setProjectAlias(aliasFromPath(next));
                      }
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setActionOk('Opening folder dialog… (reopen the popup after you choose)');
                        const { path } = await sendUi({ type: 'ui/pick-folder' });
                        setProjectPath(path);
                        setProjectAlias(aliasFromPath(path));
                        setContextScope('project');
                      }, 'Folder selected — click Approve folder')
                    }
                  >
                    Browse…
                  </button>
                </div>
                <label htmlFor="new-alias">Alias</label>
                <input
                  id="new-alias"
                  type="text"
                  placeholder="my-app"
                  value={projectAlias}
                  onChange={(e) => setProjectAlias(e.target.value)}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="primary"
                    disabled={busy || !projectPath.trim() || !projectAlias.trim()}
                    onClick={() =>
                      void run(async () => {
                        const result = await sendUi({
                          type: 'ui/register-root',
                          scope: 'project',
                          path: projectPath.trim(),
                          alias: projectAlias.trim(),
                          primary: true,
                        });
                        setSelectedAlias(result.alias);
                      }, `Approved ${projectAlias.trim()}`)
                    }
                  >
                    Approve folder
                  </button>
                </div>
              </div>
            ) : (
              <div className="context-panel">
                <div className="banner">
                  Read-only access under your home folder. Secrets like `.env` stay blocked.
                </div>
                {homeAlreadyApproved ? (
                  <p className="muted">Home folder is already approved.</p>
                ) : (
                  <>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={homeConfirmed}
                        onChange={(e) => setHomeConfirmed(e.target.checked)}
                      />
                      I understand this is broader than a single project.
                    </label>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="danger"
                        disabled={busy || !homeConfirmed}
                        onClick={() =>
                          void run(async () => {
                            const result = await sendUi({
                              type: 'ui/register-root',
                              scope: 'home',
                              alias: 'home',
                              primary: true,
                            });
                            setSelectedAlias(result.alias);
                            setHomeConfirmed(false);
                          }, 'Home folder approved')
                        }
                      >
                        Enable home access
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            <label htmlFor="project-alias" style={{ marginTop: 12 }}>
              Active folder
            </label>
            <select
              id="project-alias"
              value={selectedAlias}
              onChange={(e) => setSelectedAlias(e.target.value)}
            >
              {state.roots.length === 0 && <option value="">Approve a folder above first</option>}
              {state.roots.map((root) => (
                <option key={root.id} value={root.alias}>
                  {root.alias}
                  {root.primary ? ' (primary)' : ''}
                  {root.path ? ` — ${shortenPath(root.path)}` : ''}
                </option>
              ))}
            </select>
            {selectedAlias && (
              <div className="row" style={{ marginTop: 6 }}>
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => {
                    const root = state.roots.find((r) => r.alias === selectedAlias);
                    if (!root) return;
                    void run(async () => {
                      await sendUi({ type: 'ui/remove-root', id: root.id });
                      setSelectedAlias('');
                    }, 'Approval removed');
                  }}
                >
                  Remove selected approval
                </button>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Session</h2>
            {!sessionActive ? (
              <>
                {!isSupportedTab && (
                  <div className="banner">
                    Open a mock chat or Copilot Chat tab to start a session.
                  </div>
                )}

                <label>Mode</label>
                <div className="mode-options">
                  {SESSION_MODES.map((mode) => (
                    <label
                      key={mode}
                      className={`mode-option${selectedMode === mode ? ' selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={mode}
                        checked={selectedMode === mode}
                        onChange={() => setSelectedMode(mode)}
                      />
                      <span>
                        <span className="label">{getModeLabel(mode)}</span>
                        <br />
                        <span className="desc">{getModeDescription(mode)}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="primary"
                    disabled={busy || !isSupportedTab || !activeTab || !selectedAlias}
                    onClick={() =>
                      void run(async () => {
                        await sendUi({ type: 'ui/set-mode', mode: 'automatic' });
                        if (activeTab) {
                          await sendUi({
                            type: 'ui/start-session',
                            tabId: activeTab.id,
                            projectAlias: selectedAlias,
                            mode: 'automatic',
                            initialTask: DEFAULT_EXPLORE_TASK,
                          });
                        }
                      }, 'Starting — light structure peek, then four options')
                    }
                  >
                    Quick start
                  </button>
                  <button
                    disabled={busy || !isSupportedTab || !activeTab || !selectedAlias}
                    onClick={() =>
                      void run(async () => {
                        await sendUi({ type: 'ui/set-mode', mode: selectedMode });
                        if (activeTab) {
                          await sendUi({
                            type: 'ui/start-session',
                            tabId: activeTab.id,
                            projectAlias: selectedAlias,
                            mode: selectedMode,
                          });
                        }
                      })
                    }
                  >
                    Start session
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  <strong>Quick start</strong> uses Automatic mode for a light structure peek, then
                  offers four next-step options. Use Assisted if you want to approve each tool.
                </p>
              </>
            ) : (
              <>
                <div className="stat-grid">
                  <div className="stat">
                    <div className="value">{state.session.projectAlias}</div>
                    <div className="label">Folder</div>
                  </div>
                  <div className="stat">
                    <div className="value">{getModeLabel(state.session.mode)}</div>
                    <div className="label">Mode</div>
                  </div>
                  <div className="stat">
                    <div className="value">{state.session.iterationCount}</div>
                    <div className="label">Tool calls</div>
                  </div>
                  <div className="stat">
                    <div className="value">
                      {state.session.startedAt
                        ? formatElapsed(now - state.session.startedAt)
                        : '0:00'}
                    </div>
                    <div className="label">Elapsed</div>
                  </div>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>
                  No session call/time cap. A hung tool still times out after{' '}
                  {PROTOCOL_LIMITS.toolTimeoutSeconds}s. Stop the session when you are done.
                </p>
                <div className="row">
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => void run(() => sendUi({ type: 'ui/stop-session' }))}
                  >
                    Stop session
                  </button>
                </div>
              </>
            )}
          </section>
        </>
      )}

      <div className="footer-links">
        <span className="muted">Installation: {state.installationId.slice(0, 8)}…</span>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={state.settings.showDeveloperLogs}
            disabled={busy}
            onChange={(e) =>
              void run(() =>
                sendUi({
                  type: 'ui/set-settings',
                  patch: { showDeveloperLogs: e.target.checked },
                }),
              )
            }
          />
          Dev logs
        </label>
        {state.paired && (
          <button
            className="link"
            disabled={busy}
            onClick={() => void run(() => sendUi({ type: 'ui/forget-pairing' }))}
          >
            Forget pairing
          </button>
        )}
      </div>
    </div>
  );
}
