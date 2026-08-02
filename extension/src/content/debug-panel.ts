const HOST_ID = 'local-context-bridge-debug-root';
const MAX_LINES = 80;

const STYLES = `
:host { all: initial; }
.fab {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483646;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  border: 1px solid #3a4a63;
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  color: #d7e6ff;
  background: rgba(12, 18, 28, 0.92);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
}
.fab:hover { background: rgba(24, 35, 52, 0.96); }
.wrap {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483646;
  width: min(420px, calc(100vw - 24px));
  max-height: min(42vh, 360px);
  display: none;
  flex-direction: column;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e8eef7;
  background: rgba(12, 18, 28, 0.94);
  border: 1px solid #3a4a63;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0,0,0,0.35);
  overflow: hidden;
}
.wrap.open { display: flex; }
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: #182334;
  border-bottom: 1px solid #314257;
  font-weight: 700;
  color: #9ec5ff;
}
.head button {
  font: inherit;
  border: 0;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  background: #2a3b55;
  color: #e8eef7;
}
.lines {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.line { margin: 0 0 4px; }
.line .t { color: #7f93b0; margin-right: 6px; }
.line.warn { color: #ffd28a; }
.line.error { color: #ff9b9b; }
.line.ok { color: #8dffb0; }
`;

export type DebugLevel = 'info' | 'ok' | 'warn' | 'error';

/**
 * Optional on-page diagnostic panel. Hidden by default; a small "Dev logs"
 * chip lets the user open it when troubleshooting.
 */
export class DebugPanel {
  private readonly host: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly fab: HTMLButtonElement;
  private readonly linesEl: HTMLElement;
  private readonly entries: string[] = [];
  private visible = false;
  private enabled = false;
  private onVisibilityChange: ((visible: boolean) => void) | null = null;

  constructor(doc: Document = document) {
    this.host = doc.getElementById(HOST_ID) ?? doc.createElement('div');
    this.host.id = HOST_ID;
    if (!this.host.isConnected) doc.documentElement.appendChild(this.host);

    const shadow = this.host.shadowRoot ?? this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    const style = doc.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    this.fab = doc.createElement('button');
    this.fab.type = 'button';
    this.fab.className = 'fab';
    this.fab.textContent = 'Dev logs';
    this.fab.title = 'Show Local Context Bridge developer logs';
    this.fab.addEventListener('click', () => this.setVisible(true, true));
    shadow.appendChild(this.fab);

    this.wrap = doc.createElement('div');
    this.wrap.className = 'wrap';
    this.wrap.innerHTML = `
      <div class="head">
        <span>LCB debug</span>
        <span>
          <button type="button" data-act="clear">Clear</button>
          <button type="button" data-act="hide">Hide</button>
        </span>
      </div>
      <div class="lines"></div>
    `;
    shadow.appendChild(this.wrap);
    this.linesEl = this.wrap.querySelector('.lines') as HTMLElement;

    this.wrap.querySelector('[data-act="clear"]')!.addEventListener('click', () => {
      this.entries.length = 0;
      this.linesEl.innerHTML = '';
    });
    this.wrap.querySelector('[data-act="hide"]')!.addEventListener('click', () => {
      // Collapse to the fab; the settings toggle turns the whole UI off.
      this.setVisible(false);
    });

    this.applyVisibility();
  }

  /** Called when the user expands the panel (optional persistence hook). */
  setVisibilityListener(listener: (visible: boolean) => void): void {
    this.onVisibilityChange = listener;
  }

  /** Master switch from settings — when off, nothing is shown on the page. */
  setEnabled(enabled: boolean, open = false): void {
    this.enabled = enabled;
    this.visible = enabled && open;
    this.applyVisibility();
  }

  setVisible(visible: boolean, notify = false): void {
    if (!this.enabled && visible) this.enabled = true;
    this.visible = visible;
    this.applyVisibility();
    if (notify) this.onVisibilityChange?.(this.visible);
  }

  isVisible(): boolean {
    return this.enabled && this.visible;
  }

  private applyVisibility(): void {
    if (!this.enabled) {
      this.host.style.display = 'none';
      return;
    }
    this.host.style.display = 'block';
    this.wrap.classList.toggle('open', this.visible);
    this.fab.style.display = this.visible ? 'none' : 'block';
  }

  log(message: string, level: DebugLevel = 'info'): void {
    const ts = new Date().toISOString().slice(11, 19);
    const line = document.createElement('div');
    line.className = `line ${level}`;
    line.innerHTML = `<span class="t">${ts}</span>${escapeHtml(message)}`;
    this.entries.push(`[${ts}] ${message}`);
    this.linesEl.appendChild(line);
    while (this.linesEl.childElementCount > MAX_LINES) {
      this.linesEl.firstElementChild?.remove();
    }
    this.linesEl.scrollTop = this.linesEl.scrollHeight;
    if (level === 'error') {
      console.error(`[LCB] ${message}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
