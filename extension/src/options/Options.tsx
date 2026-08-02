import { useEffect, useState } from 'react';
import { DEFAULT_COPILOT_ORIGINS, DEFAULT_SETTINGS } from '../config/defaults';
import {
  getModeDescription,
  getModeLabel,
  SESSION_MODES,
  type SessionMode,
} from '../session/modes';
import { sendUi, useBackgroundState } from '../popup/useBackgroundState';

export function Options(): JSX.Element {
  const { state, loading, error, refresh } = useBackgroundState();
  const [companionBaseUrl, setCompanionBaseUrl] = useState(DEFAULT_SETTINGS.companionBaseUrl);
  const [mode, setMode] = useState<SessionMode>(DEFAULT_SETTINGS.mode);
  const [suggestOnCopilotOpen, setSuggestOnCopilotOpen] = useState(
    DEFAULT_SETTINGS.suggestOnCopilotOpen,
  );
  const [copilotEnabled, setCopilotEnabled] = useState(DEFAULT_SETTINGS.copilotEnabled);
  const [showDeveloperLogs, setShowDeveloperLogs] = useState(DEFAULT_SETTINGS.showDeveloperLogs);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [permissionError, setPermissionError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setCompanionBaseUrl(state.settings.companionBaseUrl);
    setMode(state.settings.mode);
    setSuggestOnCopilotOpen(state.settings.suggestOnCopilotOpen);
    setCopilotEnabled(state.settings.copilotEnabled);
    setShowDeveloperLogs(state.settings.showDeveloperLogs);
  }, [state]);

  async function handleSave(): Promise<void> {
    setSaveState('saving');
    try {
      await sendUi({
        type: 'ui/set-settings',
        patch: {
          companionBaseUrl: companionBaseUrl.trim(),
          mode,
          suggestOnCopilotOpen,
          showDeveloperLogs,
        },
      });
      setSaveState('saved');
      refresh();
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
    }
  }

  async function handleCopilotToggle(checked: boolean): Promise<void> {
    setPermissionError(null);
    try {
      if (checked) {
        const granted = await chrome.permissions.request({ origins: [...DEFAULT_COPILOT_ORIGINS] });
        if (!granted) {
          setPermissionError('Permission to access Copilot Chat sites was not granted.');
          return;
        }
      } else {
        await chrome.permissions.remove({ origins: [...DEFAULT_COPILOT_ORIGINS] });
      }
      setCopilotEnabled(checked);
      await sendUi({ type: 'ui/set-settings', patch: { copilotEnabled: checked } });
      refresh();
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : 'Failed to update permission.');
    }
  }

  async function handleForgetPairing(): Promise<void> {
    await sendUi({ type: 'ui/forget-pairing' });
    refresh();
  }

  if (loading && !state) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div>
      <div className="header">
        <div>
          <h1>Local Context Bridge — Settings</h1>
          <p className="muted">
            Configure the companion connection, default session mode, and Copilot access.
          </p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <section className="card">
        <h2>Companion</h2>
        <label htmlFor="base-url">Companion base URL</label>
        <input
          id="base-url"
          type="url"
          value={companionBaseUrl}
          onChange={(e) => setCompanionBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:32178"
        />
        <div className="status-line" style={{ marginTop: 8 }}>
          <span className={`status-dot ${state?.health.reachable ? 'ok' : 'danger'}`} />
          {state?.health.reachable ? 'Reachable' : 'Unreachable'}
          {state?.paired ? ' · Paired' : ' · Not paired'}
        </div>
        {state?.paired && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="danger" onClick={() => void handleForgetPairing()}>
              Forget pairing
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Default session mode</h2>
        <div className="mode-options">
          {SESSION_MODES.map((m) => (
            <label key={m} className={`mode-option${mode === m ? ' selected' : ''}`}>
              <input
                type="radio"
                name="default-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span>
                <span className="label">{getModeLabel(m)}</span>
                <br />
                <span className="desc">{getModeDescription(m)}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Microsoft 365 Copilot Chat</h2>
        <div className="toggle-row">
          <div>
            <div>Enable on Copilot Chat sites</div>
            <div className="muted">
              Grants access to m365.cloud.microsoft and copilot.microsoft.com so the extension can
              offer sessions there.
            </div>
          </div>
          <input
            type="checkbox"
            checked={copilotEnabled}
            onChange={(e) => void handleCopilotToggle(e.target.checked)}
          />
        </div>
        <div className="toggle-row">
          <div>
            <div>Suggest starting a session automatically</div>
            <div className="muted">
              Show a prompt when a Copilot Chat tab is open, paired, and idle.
            </div>
          </div>
          <input
            type="checkbox"
            checked={suggestOnCopilotOpen}
            disabled={!copilotEnabled}
            onChange={(e) => setSuggestOnCopilotOpen(e.target.checked)}
          />
        </div>
        {permissionError && <div className="banner error">{permissionError}</div>}
      </section>

      <section className="card">
        <h2>Developer</h2>
        <div className="toggle-row">
          <div>
            <div>Show developer logs on chat pages</div>
            <div className="muted">
              Adds a small “Dev logs” control on Copilot/mock chat for troubleshooting. Off by
              default.
            </div>
          </div>
          <input
            type="checkbox"
            checked={showDeveloperLogs}
            onChange={(e) => setShowDeveloperLogs(e.target.checked)}
          />
        </div>
      </section>

      <div className="row">
        <button className="primary" onClick={() => void handleSave()}>
          Save settings
        </button>
        {saveState === 'saved' && <span className="muted">Saved.</span>}
        {saveState === 'error' && <span className="banner error">Failed to save settings.</span>}
      </div>
    </div>
  );
}
