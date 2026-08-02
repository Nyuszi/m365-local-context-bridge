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
  pointer-events: none;
}
.panel > * { pointer-events: auto; }
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
button.primary { background: #0d6e6a; color: #fff; }
button.primary:hover { background: #0a5855; }
button.secondary { background: #eef1f6; color: #0f1419; }
button.secondary:hover { background: #e2e7ef; }
button.link { background: transparent; color: #46525f; padding: 7px 4px; }
button.danger {
  background: transparent;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.45);
  padding: 10px 18px;
  font-size: 13px;
  letter-spacing: 0.04em;
}
button.danger:hover { background: rgba(255, 255, 255, 0.12); }
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

/* ---- Compact working card (chat stays visible) ---- */
.veil {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  pointer-events: none;
  user-select: none;
  max-width: calc(100vw - 32px);
}
.veil.visible { display: flex; }
.working-box {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  width: min(340px, calc(100vw - 32px));
  padding: 18px 20px 16px;
  border-radius: 16px;
  background:
    radial-gradient(ellipse 120% 80% at 50% 0%, rgba(232, 93, 76, 0.35), transparent 55%),
    rgba(14, 24, 26, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.orbit {
  position: relative;
  width: 56px;
  height: 56px;
}
.orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
}
.orbit-ring.r2 { inset: 7px; border-color: rgba(43, 181, 174, 0.35); }
.orbit-ring.r3 { inset: 14px; border-color: rgba(240, 163, 90, 0.4); }
.orbit-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: #f0a35a;
  box-shadow: 0 0 10px rgba(240, 163, 90, 0.8);
  animation: orbit-spin 1.6s linear infinite;
}
.orbit-dot.d2 {
  background: #2bb5ae;
  box-shadow: 0 0 10px rgba(43, 181, 174, 0.8);
  animation: orbit-spin-inner 2.2s linear infinite reverse;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
}
.orbit-core {
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: linear-gradient(145deg, #e85d4c, #f0a35a 55%, #2bb5ae);
  box-shadow: 0 0 18px rgba(232, 93, 76, 0.45);
  animation: core-pulse 1.4s ease-in-out infinite;
}
@keyframes orbit-spin {
  from { transform: rotate(0deg) translateX(22px); }
  to { transform: rotate(360deg) translateX(22px); }
}
@keyframes orbit-spin-inner {
  from { transform: rotate(0deg) translateX(14px); }
  to { transform: rotate(360deg) translateX(14px); }
}
@keyframes core-pulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.08); filter: brightness(1.15); }
}
.working-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-indent: 0.22em;
  line-height: 1;
}
.working-title .dot {
  display: inline-block;
  width: 0.28em;
  opacity: 0;
  animation: blink-dot 1.4s infinite;
}
.working-title .dot:nth-child(1) { animation-delay: 0s; }
.working-title .dot:nth-child(2) { animation-delay: 0.2s; }
.working-title .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink-dot {
  0%, 20% { opacity: 0; }
  30%, 70% { opacity: 1; }
  80%, 100% { opacity: 0; }
}
.working-detail {
  margin: 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  line-height: 1.4;
  min-height: 1.4em;
}
.working-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
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

export interface WorkingOptions {
  detail?: string;
  onCancel?: () => void;
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
  private readonly veil: HTMLDivElement;
  private readonly workingDetail: HTMLParagraphElement;
  private readonly cancelButton: HTMLButtonElement;
  /** True while Run/Decline or Insert/Discard is on screen — don't clobber it. */
  private blocking = false;
  private working = false;
  private onCancel: (() => void) | null = null;

  constructor(doc: Document = document) {
    this.host = doc.getElementById(HOST_ID) ?? doc.createElement('div');
    this.host.id = HOST_ID;
    if (!this.host.isConnected) doc.documentElement.appendChild(this.host);

    this.shadow = this.host.shadowRoot ?? this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = '';

    const style = doc.createElement('style');
    style.textContent = STYLES;
    this.shadow.appendChild(style);

    this.veil = doc.createElement('div');
    this.veil.className = 'veil';
    this.veil.setAttribute('role', 'status');
    this.veil.setAttribute('aria-live', 'polite');
    this.veil.setAttribute('aria-label', 'Local Context Bridge working');
    this.veil.innerHTML = `
      <div class="working-box">
        <div class="orbit" aria-hidden="true">
          <div class="orbit-ring"></div>
          <div class="orbit-ring r2"></div>
          <div class="orbit-ring r3"></div>
          <div class="orbit-core"></div>
          <div class="orbit-dot"></div>
          <div class="orbit-dot d2"></div>
        </div>
        <p class="working-title">WORKING<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>
        <p class="working-detail"></p>
        <p class="working-hint">You can still read the chat — Cancel stops the bridge.</p>
        <button type="button" class="danger" data-cancel>Cancel</button>
      </div>
    `;
    this.workingDetail = this.veil.querySelector('.working-detail')!;
    this.cancelButton = this.veil.querySelector('[data-cancel]')!;
    this.cancelButton.addEventListener('click', () => {
      const cb = this.onCancel;
      this.clearWorking();
      cb?.();
    });
    this.veil.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancelButton.click();
      }
    });
    this.shadow.appendChild(this.veil);

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

  isWorking(): boolean {
    return this.working;
  }

  /**
   * Compact floating “WORKING” card (chat stays readable and clickable).
   * Does not set `blocking` — tool scans can still proceed.
   */
  showWorking(detail: string, options: WorkingOptions = {}): void {
    this.working = true;
    this.onCancel = options.onCancel ?? null;
    this.workingDetail.textContent = detail || options.detail || 'Local Context Bridge is working…';
    this.cancelButton.hidden = !this.onCancel;
    this.veil.classList.add('visible');
  }

  updateWorking(detail: string): void {
    if (!this.working) return;
    this.workingDetail.textContent = detail;
  }

  clearWorking(): void {
    this.working = false;
    this.onCancel = null;
    this.veil.classList.remove('visible');
  }

  /**
   * Temporarily hide the veil (without dropping the cancel handler) so Lexical
   * can receive focus / Send clicks. Call {@link showWorking} again afterward.
   */
  unlockForComposer(): void {
    this.veil.classList.remove('visible');
  }

  relockWorking(): void {
    if (this.working) this.veil.classList.add('visible');
  }

  showDetectionPrompt(
    projectAlias: string,
    roots: CompanionStatusRoot[],
    callbacks: DetectionPromptCallbacks,
    readiness: 'ready' | 'needs-companion' | 'needs-pairing' | 'needs-folder' = 'ready',
  ): void {
    this.clearWorking();
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
    // Approval needs clicks — drop the working veil so the card is usable.
    this.clearWorking();
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
    this.clearWorking();
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
    this.clearWorking();
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
  showSetupProgress(message: string, onCancel?: () => void): void {
    this.clear();
    this.showWorking(message, { onCancel });
  }

  clearSetupProgress(): void {
    this.clearWorking();
    if (!this.blocking) this.clear();
  }

  /**
   * Bottom card when auto-Send fails — composer stays usable (no full veil).
   */
  showBootstrapSendFailed(
    _bootstrapMessage: string,
    callbacks: { onRetry: () => void; onCancel: () => void },
  ): void {
    this.clearWorking();
    this.clear();
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Could not auto-send</h3>
      <p>The setup message may be in the composer. Click <strong>Send</strong> in Copilot, or retry.</p>
      <div class="row"></div>
    `;
    const row = card.querySelector('.row')!;
    row.appendChild(makeButton('Retry send', 'primary', callbacks.onRetry));
    row.appendChild(makeButton('Cancel', 'secondary', callbacks.onCancel));
    this.panel.appendChild(card);
  }

  showTransientNotice(message: string, kind: 'info' | 'error' = 'info', timeoutMs = 6000): void {
    // Never replace an active Run / Insert confirmation — rescans were wiping it.
    if (this.blocking) return;
    this.clearWorking();
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
