import type { CompanionStatusRoot } from '../background/companion-client';
import type { LocalToolRequest, LocalToolResult } from '../protocol/types';

const HOST_ID = 'local-context-bridge-suggestion-root';

const STYLES = `
:host { all: initial; }
.panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  width: 360px;
  max-width: calc(100vw - 40px);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #0f1419;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  background: #ffffff;
  border: 1px solid #d7dee7;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 20, 25, 0.16);
  padding: 14px 16px;
}
.card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #0f1419; }
.card p { margin: 0 0 10px; color: #46525f; }
.card .note {
  margin: 0 0 12px;
  padding: 8px 10px;
  background: #f4f7fb;
  border-radius: 8px;
  color: #3a4654;
  font-size: 12px;
}
.card .note strong { color: #0f1419; }
.card code { background: #f0f3f7; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit;
  border: 0;
  border-radius: 7px;
  padding: 7px 12px;
  cursor: pointer;
  font-weight: 600;
}
button.primary { background: #154ab8; color: #fff; }
button.primary:hover { background: #123f9c; }
button.secondary { background: #eef1f6; color: #0f1419; }
button.secondary:hover { background: #e2e7ef; }
button.link { background: transparent; color: #46525f; padding: 7px 4px; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #eef1f6; font-size: 11px; margin-left: 6px; }
.card pre {
  margin: 0 0 10px;
  max-height: 160px;
  overflow: auto;
  background: #f0f3f7;
  border-radius: 6px;
  padding: 8px;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: #0f1419;
}
.roots { margin: 0 0 10px; padding-left: 18px; color: #46525f; font-size: 12px; }
.roots li { margin: 0 0 4px; }
.error p { color: #9c2b2b; }
`;

export interface DetectionPromptCallbacks {
  onStart: (projectAlias: string) => void;
  onNotNow: () => void;
  onNever: () => void;
}

export interface PendingToolCallCallbacks {
  onRun: () => void;
  /** Approve this call and switch the session to automatic mode. */
  onAlwaysAllow: () => void;
  onDecline: () => void;
}

export interface ToolResultCallbacks {
  onInsert: () => void;
  onDiscard: () => void;
}

/**
 * Minimal, dependency-free in-page overlay rendered in a shadow root so
 * host-page CSS can never bleed in (or be leaked into). Only one card is
 * shown at a time; callers are expected to sequence prompts sensibly (the
 * content script only ever has one open question for the user at once).
 */
export class SuggestionOverlay {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private readonly panel: HTMLDivElement;
  /** True while Run/Decline or Insert/Discard is on screen — don't clobber it. */
  private blocking = false;

  constructor(doc: Document = document) {
    this.host = doc.getElementById(HOST_ID) ?? doc.createElement('div');
    this.host.id = HOST_ID;
    if (!this.host.isConnected) doc.documentElement.appendChild(this.host);

    this.shadow = this.host.shadowRoot ?? this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = '';

    const style = doc.createElement('style');
    style.textContent = STYLES;
    this.shadow.appendChild(style);

    this.panel = doc.createElement('div');
    this.panel.className = 'panel';
    this.shadow.appendChild(this.panel);
  }

  clear(): void {
    this.blocking = false;
    this.panel.innerHTML = '';
  }

  isBlocking(): boolean {
    return this.blocking;
  }

  showDetectionPrompt(
    projectAlias: string,
    roots: CompanionStatusRoot[],
    callbacks: DetectionPromptCallbacks,
    readiness: 'ready' | 'needs-companion' | 'needs-pairing' | 'needs-folder' = 'ready',
  ): void {
    this.clear();
    const card = document.createElement('div');
    card.className = 'card';

    let headline = 'Local Context Bridge';
    let body = 'Let Copilot use read-only tools on your approved project folder?';
    let primaryLabel = 'Start';
    if (readiness === 'needs-companion') {
      body =
        'Start Local Context Bridge on this Mac? The companion will launch, then the session can begin.';
      primaryLabel = 'Start';
    } else if (readiness === 'needs-pairing') {
      body = 'Connect this extension to the local companion, then start a session?';
      primaryLabel = 'Start';
    } else if (readiness === 'needs-folder') {
      body = 'Approve a project folder, then start a read-only session with Copilot?';
      primaryLabel = 'Start';
    }

    card.innerHTML = `
      <h3>${escapeHtml(headline)}</h3>
      <p>${escapeHtml(body)}</p>
      <div class="note">
        <strong>Access is limited.</strong> The bridge only sees folders you explicitly
        approved (a project path, or optionally your home folder) — not the entire disk.
        Tools cannot write or delete files.
      </div>
      <div class="row"></div>
    `;
    const row = card.querySelector('.row')!;

    if (roots.length > 0 && readiness === 'ready') {
      const list = document.createElement('ul');
      list.className = 'roots';
      for (const root of roots) {
        const li = document.createElement('li');
        li.innerHTML = `<code>${escapeHtml(root.alias)}</code>${
          root.path ? ` — ${escapeHtml(shortenPath(root.path))}` : ''
        }${root.primary ? ' (primary)' : ''}`;
        list.appendChild(li);
      }
      card.insertBefore(list, row);
    }

    row.appendChild(makeButton(primaryLabel, 'primary', () => callbacks.onStart(projectAlias)));

    if (roots.length > 1 && readiness === 'ready') {
      const select = document.createElement('select');
      for (const root of roots) {
        const option = document.createElement('option');
        option.value = root.alias;
        option.textContent = root.path ? `${root.alias} — ${shortenPath(root.path)}` : root.alias;
        if (root.alias === projectAlias) option.selected = true;
        select.appendChild(option);
      }
      row.appendChild(select);
      row.appendChild(
        makeButton('Use selected', 'secondary', () => callbacks.onStart(select.value)),
      );
    }

    row.appendChild(makeButton('Not now', 'link', callbacks.onNotNow));
    row.appendChild(makeButton('Do not ask again', 'link', callbacks.onNever));

    this.panel.appendChild(card);
  }

  hideDetectionPrompt(): void {
    this.clear();
  }

  showPendingToolCall(
    request: LocalToolRequest,
    projectAlias: string,
    callbacks: PendingToolCallCallbacks,
  ): void {
    this.clear();
    this.blocking = true;
    const argsPreview = formatArgsPreview(request.arguments);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Allow local tool?<span class="badge">${escapeHtml(request.tool)}</span></h3>
      <p>Copilot wants a <strong>read-only</strong> look inside <code>${escapeHtml(projectAlias || 'your project')}</code>.</p>
      <div class="note">Only the approved folder for this session is visible (project or home) — not the entire disk.</div>
      ${argsPreview ? `<p><code>${escapeHtml(argsPreview)}</code></p>` : ''}
      <div class="row"></div>
    `;
    const row = card.querySelector('.row')!;
    row.appendChild(
      makeButton('Run once', 'primary', () => {
        this.blocking = false;
        callbacks.onRun();
      }),
    );
    row.appendChild(
      makeButton('Always allow', 'secondary', () => {
        this.blocking = false;
        callbacks.onAlwaysAllow();
      }),
    );
    row.appendChild(
      makeButton('Decline', 'link', () => {
        this.blocking = false;
        callbacks.onDecline();
      }),
    );
    this.panel.appendChild(card);
  }

  showToolResultConfirmation(result: LocalToolResult, callbacks: ToolResultCallbacks): void {
    this.clear();
    this.blocking = true;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Result ready<span class="badge">${escapeHtml(result.tool)}</span></h3>
      <p>${result.success ? 'The tool ran successfully.' : 'The tool call failed.'} Insert the result into the composer and send it?</p>
      <div class="row"></div>
    `;
    const row = card.querySelector('.row')!;
    row.appendChild(
      makeButton('Insert & send', 'primary', () => {
        this.blocking = false;
        callbacks.onInsert();
      }),
    );
    row.appendChild(
      makeButton('Discard', 'secondary', () => {
        this.blocking = false;
        callbacks.onDiscard();
      }),
    );
    this.panel.appendChild(card);
  }

  /** When the host chat composer cannot be located, let the user paste bootstrap manually. */
  showBootstrapManual(bootstrapMessage: string): void {
    this.clear();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Paste bootstrap manually</h3>
      <p>Could not find the chat input on this page. Copy the message below, paste it into Copilot/mock chat, and send it.</p>
      <pre></pre>
      <div class="row"></div>
    `;
    const pre = card.querySelector('pre')!;
    pre.textContent = bootstrapMessage;
    const row = card.querySelector('.row')!;
    row.appendChild(
      makeButton('Copy message', 'primary', () => {
        void navigator.clipboard.writeText(bootstrapMessage).then(
          () => this.showTransientNotice('Bootstrap message copied — paste it into the chat and send.'),
          () => this.showTransientNotice('Copy failed — select the text in the panel and copy it yourself.', 'error'),
        );
      }),
    );
    row.appendChild(makeButton('Dismiss', 'secondary', () => this.clear()));
    this.panel.appendChild(card);
  }

  /** Sticky status while waiting for Copilot to put the chat id in the URL. */
  showSetupProgress(message: string): void {
    // Don't use blocking — tool approvals / scans must still work during this wait.
    this.panel.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Setup in progress</h3>
      <p class="note"><strong>Local Context Bridge</strong> is finishing session setup.</p>
      <p>${escapeHtml(message)}</p>
    `;
    this.panel.appendChild(card);
  }

  clearSetupProgress(): void {
    this.clear();
  }

  showTransientNotice(message: string, kind: 'info' | 'error' = 'info', timeoutMs = 6000): void {
    // Never replace an active Run / Insert confirmation — rescans were wiping it.
    if (this.blocking) return;
    this.clear();
    const card = document.createElement('div');
    card.className = kind === 'error' ? 'card error' : 'card';
    card.innerHTML = `<p>${escapeHtml(message)}</p>`;
    this.panel.appendChild(card);
    setTimeout(() => {
      if (card.isConnected) card.remove();
    }, timeoutMs);
  }

  dispose(): void {
    this.host.remove();
  }
}

function formatArgsPreview(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  try {
    const raw = JSON.stringify(args);
    return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
  } catch {
    return '';
  }
}

function shortenPath(path: string): string {
  const home = path.match(/^(\/Users\/[^/]+)/);
  const prefix = home?.[1];
  if (prefix) return path.replace(prefix, '~');
  return path.length > 64 ? `…${path.slice(-60)}` : path;
}

function makeButton(
  label: string,
  variant: 'primary' | 'secondary' | 'link',
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = variant;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
