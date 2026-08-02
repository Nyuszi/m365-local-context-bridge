import { isAdapterUsable, selectAdapter, type SiteAdapter } from '../adapters';
import { reconstructMarkdownFromDom, stripCopilotCodeGutter } from '../adapters/markdown';
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from '../background/messages';
import { PROTOCOL_LIMITS } from '../config/defaults';
import { parseAssistantMessage } from '../protocol/parser';
import {
  FENCE_LANGUAGE_RESULT,
  type LocalToolResult,
  type ParseOutcome,
} from '../protocol/types';
import { DebugPanel } from './debug-panel';
import { watchAssistantMessages, type MessageWatcherHandle } from './dom-observer';
import { SuggestionOverlay } from './suggestion-ui';

function send(message: ContentToBackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // The service worker may be asleep/restarting; it will re-sync state on next wake.
  });
}

function formatToolResultFence(result: LocalToolResult): string {
  return `\`\`\`${FENCE_LANGUAGE_RESULT}\n${JSON.stringify(result, null, 2)}\n\`\`\``;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preview(text: string, max = 160): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** True when text likely contains a protocol payload (not ordinary chat prose). */
function looksLikeToolPayload(text: string): boolean {
  return /LOCAL_TOOL_REQUEST/.test(text);
}

/**
 * Parse tool requests from reconstructed DOM text / innerText / code boxes.
 * Only wrap prose in a synthetic fence when LOCAL_TOOL_REQUEST is already present —
 * otherwise wrapping every Copilot reply yields false `invalid-json` rejections.
 */
function parseLooseToolText(text: string): ParseOutcome {
  if (!text.trim()) return { kind: 'none' };
  const cleaned = stripCopilotCodeGutter(text);
  let outcome = parseAssistantMessage(cleaned);
  if (outcome.kind === 'request') return outcome;
  outcome = parseAssistantMessage(text);
  if (outcome.kind === 'request') return outcome;

  if (!looksLikeToolPayload(cleaned) && !looksLikeToolPayload(text)) {
    return outcome.kind === 'rejected' ? outcome : { kind: 'none' };
  }

  // Recover when a reconstructed fence kept a Copilot language badge (Dart/Kotlin/…).
  const wrapped = parseAssistantMessage('```local-tool-request\n' + cleaned + '\n```');
  if (wrapped.kind === 'request') return wrapped;
  if (outcome.kind === 'rejected') return outcome;
  if (wrapped.kind === 'rejected') return wrapped;
  return { kind: 'none' };
}

const CODE_BLOCK_SELECTOR = [
  '.scriptor-component-code-block',
  '.scriptor-codeblock-virtualized',
  '[class*="scriptor-component-code-block"]',
  '[class*="scriptor-codeblock"]',
  '[class*="CodeBlock"]',
  '[class*="code-block"]',
  'pre',
  'code',
].join(', ');

function describeEl(el: Element | null | undefined): string {
  if (!el) return 'no';
  const testid = el.getAttribute('data-testid');
  if (testid) return testid;
  const id = (el as HTMLElement).id;
  if (id) return `#${id}`;
  const cls = typeof el.className === 'string' ? el.className : '';
  const useful = cls
    .split(/\s+/)
    .find((c) => /copilot|message|chat|feed|list/i.test(c));
  if (useful) return `.${useful}`;
  return el.tagName;
}

async function waitForComposer(
  adapter: SiteAdapter,
  doc: Document,
  attempts = 40,
  intervalMs = 300,
): Promise<{ container: Element; composer: HTMLElement } | null> {
  for (let i = 0; i < attempts; i += 1) {
    const composer = adapter.getComposer(doc);
    if (composer) {
      const container = adapter.getMessageContainer(doc) ?? doc.body;
      return { container, composer };
    }
    await sleep(intervalMs);
  }
  return null;
}

/**
 * Prefer a real request; keep the first meaningful rejection only when the
 * source actually contained LOCAL_TOOL_REQUEST (schema/JSON errors).
 */
function preferOutcome(current: ParseOutcome, next: ParseOutcome): ParseOutcome {
  if (current.kind === 'request') return current;
  if (next.kind === 'request') return next;
  if (current.kind === 'rejected') return current;
  if (next.kind === 'rejected') return next;
  return current;
}

/** Try reconstructed markdown, full-message text, then each code block. */
function parseToolRequestFromMessage(adapter: SiteAdapter, el: Element, debug: DebugPanel): ParseOutcome {
  const reconstructed = adapter.getMessageText(el);
  const inner = (el as HTMLElement).innerText ?? '';
  const codeCount = el.querySelectorAll(CODE_BLOCK_SELECTOR).length;
  debug.log(
    `scan msg: len=${reconstructed.length} inner=${inner.length} code=${codeCount} hasLOCAL=${looksLikeToolPayload(reconstructed) || looksLikeToolPayload(inner)}`,
  );

  const tryText = (label: string, text: string): ParseOutcome => {
    const outcome = parseLooseToolText(text);
    if (outcome.kind === 'none') return outcome;
    debug.log(
      `parse via ${label} → ${outcome.kind}${outcome.kind === 'rejected' ? ` (${outcome.reason})` : ''}`,
      outcome.kind === 'request' ? 'ok' : 'warn',
    );
    return outcome;
  };

  let best = tryText('reconstructed markdown', reconstructed);
  if (best.kind === 'request') return best;

  // Full message node (not only .fai-CopilotMessage__content) — code boxes
  // sometimes sit outside the markdown content wrapper.
  best = preferOutcome(best, tryText('message innerText', inner));
  if (best.kind === 'request') return best;

  if (inner.length > 0 && inner !== reconstructed) {
    best = preferOutcome(best, tryText('full-message reconstruct', reconstructMarkdownFromDom(el)));
    if (best.kind === 'request') return best;
  }

  for (const block of Array.from(el.querySelectorAll(CODE_BLOCK_SELECTOR))) {
    const text = (block as HTMLElement).innerText || block.textContent || '';
    if (!looksLikeToolPayload(text)) continue;
    best = preferOutcome(best, tryText('code block', text));
    if (best.kind === 'request') return best;
  }

  if (best.kind === 'none') {
    debug.log(`parse=none preview="${preview(reconstructed || inner)}"`);
  }
  return best;
}

class BridgeContentController {
  private readonly overlay = new SuggestionOverlay(document);
  private readonly debug = new DebugPanel(document);
  private watcher: MessageWatcherHandle | null = null;
  private composer: HTMLElement | null = null;
  private watchContainer: Element | null = null;
  private heartbeatTimer: number | null = null;
  private chatPollTimer: number | null = null;
  private lastChatId: string | null = null;
  /** Waiting for Copilot to put conversationId in the URL after bootstrap. */
  private awaitingChatLink = false;
  private chatLinkWaitTimer: number | null = null;
  /**
   * Tool request ids already present when a session was resumed (or already
   * answered in the transcript). Never re-fire these — they are history.
   */
  private historicalToolRequestIds = new Set<string>();

  constructor(private readonly adapter: SiteAdapter) {}

  init(): void {
    this.debug.log(`content script loaded adapter=${this.adapter.id} url=${location.href}`, 'ok');
    this.debug.setEnabled(false);
    send({ type: 'cb/content-ready', url: location.href });
    this.reportDetection();
    this.startChatIdPolling();
    this.startPendingStartPolling();
    window.setTimeout(() => this.reportDetection(), 1500);
    window.setTimeout(() => this.reportDetection(), 4000);

    chrome.runtime.onMessage.addListener((message: unknown) => {
      if (isBackgroundMessage(message)) {
        if (message.type !== 'bc/debug') {
          this.debug.log(`← ${message.type}`);
        }
        this.handleBackgroundMessage(message);
      }
    });
  }

  /** Desktop START writes a pending start — poll briefly so we claim it even if
   * adapter detection was already done before the companion set the flag. */
  private startPendingStartPolling(): void {
    const forced = /[?&]lcb_start=/.test(location.href);
    let ticks = 0;
    const maxTicks = forced ? 30 : 15;
    const tick = () => {
      ticks += 1;
      send({ type: 'cb/check-pending-start' });
      if (ticks >= maxTicks) return;
      window.setTimeout(tick, forced ? 1000 : 2000);
    };
    window.setTimeout(tick, forced ? 300 : 800);
  }

  private reportDetection(): void {
    const confidence = this.adapter.computeConfidence(document);
    const composer = this.adapter.getComposer(document);
    const container = this.adapter.getMessageContainer(document);
    const assistants = container ? this.adapter.getAssistantMessageElements(container).length : 0;
    this.debug.log(
      `detect conf=${confidence.toFixed(2)} composer=${describeEl(composer)} container=${describeEl(container)} assistants=${assistants}`,
    );
    send({
      type: 'cb/adapter-detected',
      adapterId: this.adapter.id,
      confidence,
      url: location.href,
      hasComposer: composer !== null,
    });

    // If a session is watching, re-bind when the real transcript root appears
    // and scan any assistant messages that arrived while we were on the wrong node.
    if (this.watcher) {
      this.ensureWatcherContainer(`detect(assistants=${assistants})`);
      if (assistants > 0) this.scanLatestAssistant('detect');
    }
  }

  private handleBackgroundMessage(message: BackgroundToContentMessage): void {
    switch (message.type) {
      case 'bc/show-detection-prompt':
        if (this.awaitingChatLink || this.overlay.isBlocking()) {
          return;
        }
        this.overlay.showDetectionPrompt(
          message.projectAlias,
          message.roots,
          {
            onStart: (alias) => {
              send({ type: 'cb/ensure-ready-and-start', projectAlias: alias });
              this.overlay.hideDetectionPrompt();
            },
            onNotNow: () => {
              send({ type: 'cb/dismiss-prompt', kind: 'not-now' });
              this.overlay.hideDetectionPrompt();
            },
            onNever: () => {
              send({ type: 'cb/dismiss-prompt', kind: 'never' });
              this.overlay.hideDetectionPrompt();
            },
          },
          message.readiness,
        );
        return;
      case 'bc/hide-detection-prompt':
        this.overlay.hideDetectionPrompt();
        return;
      case 'bc/session-started':
        void this.onSessionStarted(
          message.bootstrapMessage,
          message.projectAlias,
          message.chatTitle,
        );
        return;
      case 'bc/session-resumed':
        void this.onSessionResumed(message.projectAlias, message.mode);
        return;
      case 'bc/pending-tool-call':
        this.debug.log(`pending tool ${message.request.tool} id=${message.request.id}`, 'ok');
        this.overlay.showPendingToolCall(message.request, message.projectAlias, {
          onRun: () => {
            this.overlay.clear();
            this.debug.log(`user approved ${message.request.tool}`, 'ok');
            send({ type: 'cb/run-approved', requestId: message.request.id });
          },
          onAlwaysAllow: () => {
            this.overlay.clear();
            this.debug.log(`user always-allow ${message.request.tool}`, 'ok');
            send({
              type: 'cb/run-approved',
              requestId: message.request.id,
              enableAutomatic: true,
            });
          },
          onDecline: () => {
            this.overlay.clear();
            send({ type: 'cb/run-declined', requestId: message.request.id });
          },
        });
        return;
      case 'bc/tool-result-ready':
        this.debug.log(
          `tool result ${message.result.tool} success=${message.result.success}`,
          message.result.success ? 'ok' : 'error',
        );
        // Drop any lingering Run card before insert/confirm UI.
        this.overlay.clear();
        this.onToolResultReady(message.result, message.requiresConfirmation, message.autoSubmit);
        return;
      case 'bc/tool-call-failed':
        this.overlay.clear();
        if (/replay|duplicate/i.test(message.message)) {
          this.historicalToolRequestIds.add(message.requestId);
          this.debug.log(
            `companion already handled id=${message.requestId} — not an error`,
            'warn',
          );
          return;
        }
        this.debug.log(`tool failed: ${message.message}`, 'error');
        this.overlay.showTransientNotice(`Tool call failed: ${message.message}`, 'error');
        return;
      case 'bc/session-stopped':
        this.debug.log(`session stopped (${message.reason})`, 'warn');
        this.overlay.showTransientNotice(
          `Local Context Bridge session stopped (${message.reason}).`,
        );
        this.watcher?.dispose();
        this.watcher = null;
        this.watchContainer = null;
        return;
      case 'bc/session-limit-warning':
        this.overlay.showTransientNotice(message.message);
        return;
      case 'bc/debug':
        this.debug.log(message.message, message.level ?? 'info');
        return;
      case 'bc/settings':
        this.debug.setEnabled(message.showDeveloperLogs, message.showDeveloperLogs);
        return;
    }
  }

  private async onSessionResumed(projectAlias: string, mode: string): Promise<void> {
    this.debug.log(`session-resumed project=${projectAlias} mode=${mode}`, 'ok');
    this.overlay.hideDetectionPrompt();
    this.overlay.clearSetupProgress();
    this.awaitingChatLink = false;
    if (this.chatLinkWaitTimer !== null) {
      window.clearInterval(this.chatLinkWaitTimer);
      this.chatLinkWaitTimer = null;
    }

    // Old LOCAL_TOOL_REQUEST fences stay in the chat DOM — mark them handled
    // so resume does not replay them against the companion.
    this.seedHistoricalToolRequests('resume');

    const found = await waitForComposer(this.adapter, document);
    if (found) {
      this.composer = found.composer;
      this.attachWatcher(found.container, 'session-resume');
    } else {
      const container = this.adapter.getMessageContainer(document) ?? document.body;
      this.attachWatcher(container, 'session-resume-no-composer');
    }
    // Watch for new assistant turns only; do not heartbeat-rescan the whole history.
    this.checkChatId();
    this.overlay.showTransientNotice(
      `Session resumed (${projectAlias}). Local tools are available for this chat.`,
      'info',
      5000,
    );
  }

  /** Collect request ids already in the transcript (requests and fulfilled results). */
  private seedHistoricalToolRequests(reason: string): void {
    const ids = collectHistoricalToolRequestIds(document);
    for (const id of ids) this.historicalToolRequestIds.add(id);
    this.debug.log(
      `${reason}: ignoring ${ids.length} historical tool request id(s) already in transcript`,
      'ok',
    );
  }

  private async onSessionStarted(
    bootstrapMessage: string,
    projectAlias: string,
    chatTitle?: string,
  ): Promise<void> {
    this.debug.log(`session-started project=${projectAlias} bootstrapChars=${bootstrapMessage.length}`);
    this.historicalToolRequestIds.clear();
    this.overlay.showSetupProgress('Sending setup message to Copilot…');

    const found = await waitForComposer(this.adapter, document);
    if (!found) {
      this.overlay.clearSetupProgress();
      if (this.adapter.getComposer(document) === null && this.adapter.computeConfidence(document) < 0.25) {
        this.debug.log('no composer in this frame — ignoring (likely shell frame)', 'warn');
        return;
      }
      this.debug.log('composer not found after wait — showing manual paste', 'error');
      this.overlay.showBootstrapManual(bootstrapMessage);
      return;
    }

    this.debug.log(
      `composer ok id=${found.composer.id || found.composer.tagName} container=${describeEl(found.container)}`,
      'ok',
    );

    this.composer = found.composer;
    let submitted = false;
    if (this.adapter.insertAndSubmit) {
      submitted = await this.adapter.insertAndSubmit(found.composer, bootstrapMessage);
    } else {
      this.adapter.setComposerText(found.composer, bootstrapMessage);
      await sleep(80);
      submitted = this.adapter.submit(document, found.composer);
    }
    this.debug.log(`bootstrap inserted+submit=${submitted}`, submitted ? 'ok' : 'warn');

    if (chatTitle && this.adapter.setConversationTitle) {
      window.setTimeout(() => {
        this.adapter.setConversationTitle?.(document, chatTitle);
      }, 1200);
    }

    this.attachWatcher(found.container, 'session-start');
    this.startHeartbeatScans();

    // Copilot adds a stable conversationId to the URL after the first turn —
    // wait for that (no page reload).
    this.overlay.showSetupProgress(
      submitted
        ? 'Setup message sent. Waiting for Copilot to assign a chat link…'
        : 'Setup message may need a Send click. Waiting for Copilot to assign a chat link…',
    );
    this.beginChatLinkWait();
  }

  /** Poll until conversationId appears in the URL (SPA updates it eventually). */
  private beginChatLinkWait(): void {
    this.awaitingChatLink = true;
    if (this.chatLinkWaitTimer !== null) {
      window.clearInterval(this.chatLinkWaitTimer);
      this.chatLinkWaitTimer = null;
    }

    const startedAt = Date.now();
    const maxMs = 90_000;
    let ticks = 0;

    const finish = (ok: boolean) => {
      this.awaitingChatLink = false;
      if (this.chatLinkWaitTimer !== null) {
        window.clearInterval(this.chatLinkWaitTimer);
        this.chatLinkWaitTimer = null;
      }
      // Don't wipe an active tool Run/Insert card.
      if (!this.overlay.isBlocking()) {
        this.overlay.clearSetupProgress();
        this.overlay.showTransientNotice(
          ok
            ? 'Setup complete — chat link saved. You can resume this session from the Bridge app.'
            : 'Setup message was sent, but the chat link did not appear yet. Keep this tab open — it may still update.',
          ok ? 'info' : 'error',
          8000,
        );
      }
      this.checkChatId();
    };

    const tick = () => {
      ticks += 1;
      this.checkChatId();
      const id = this.adapter.getConversationId(document);
      if (id) {
        this.debug.log(`chat link ready id=${id}`, 'ok');
        finish(true);
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxMs) {
        this.debug.log('chat link wait timed out', 'warn');
        finish(false);
        return;
      }
      if (this.overlay.isBlocking()) return;
      if (ticks === 1 || ticks % 4 === 0) {
        this.overlay.showSetupProgress(
          `Waiting for Copilot chat link… (${Math.round(elapsed / 1000)}s)`,
        );
      }
    };

    // First check soon; then every 750ms until URL updates.
    window.setTimeout(tick, 400);
    this.chatLinkWaitTimer = window.setInterval(tick, 750);
  }

  private startHeartbeatScans(): void {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    let ticks = 0;
    this.heartbeatTimer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 20) {
        if (this.heartbeatTimer !== null) {
          window.clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        return;
      }
      if (this.overlay.isBlocking()) return;
      if (ticks === 1 || ticks % 3 === 0) this.ensureWatcherContainer(`hb:${ticks * 3}s`);
      this.scanLatestAssistant(`heartbeat:${ticks * 3}s`);
    }, 3000);
  }

  private startChatIdPolling(): void {
    if (this.chatPollTimer !== null) window.clearInterval(this.chatPollTimer);
    this.checkChatId();
    this.chatPollTimer = window.setInterval(() => this.checkChatId(), 2000);
  }

  private checkChatId(): void {
    if (this.adapter.id !== 'copilot') return;
    const chatId = this.adapter.getConversationId(document);
    if (!chatId || chatId === this.lastChatId) return;
    this.lastChatId = chatId;
    const title =
      document.title?.replace(/\s*[|–-]\s*Microsoft.*$/i, '').trim() || undefined;
    send({
      type: 'cb/chat-changed',
      chatId,
      url: location.href,
      title,
    });
    this.debug.log(`chat-id → ${chatId}`, 'ok');
  }

  private attachWatcher(container: Element, reason: string): void {
    this.watchContainer = container;
    this.watcher?.dispose();
    this.watcher = watchAssistantMessages(this.adapter, container, {
      stableMs: PROTOCOL_LIMITS.messageStableMs,
      onFinalMessage: (_text, el) => this.onFinalAssistantMessage(_text, el),
    });
    this.debug.log(
      `watcher attached (${reason}) → ${describeEl(container)} assistants=${this.adapter.getAssistantMessageElements(container).length}`,
      'ok',
    );
  }

  private ensureWatcherContainer(reason: string): void {
    const best = this.adapter.getMessageContainer(document);
    if (!best) {
      this.debug.log(`ensureWatcher(${reason}): still no MessageListContainer`, 'warn');
      return;
    }
    const bestIsList =
      best.getAttribute('data-testid') === 'MessageListContainer' ||
      best.classList.contains('fai-CopilotChat');
    const currentIsList =
      this.watchContainer?.getAttribute('data-testid') === 'MessageListContainer' ||
      this.watchContainer?.classList.contains('fai-CopilotChat');

    if (this.watchContainer === best) {
      this.scanLatestAssistant(`ensure-same:${reason}`);
      return;
    }
    if (bestIsList && !currentIsList) {
      this.debug.log(
        `rebinding watcher (${reason}): ${describeEl(this.watchContainer)} → ${describeEl(best)}`,
        'ok',
      );
      this.attachWatcher(best, `rebind:${reason}`);
      this.scanLatestAssistant(`after-rebind:${reason}`);
      return;
    }
    if (this.watchContainer && best.contains(this.watchContainer) && best !== this.watchContainer) {
      this.debug.log(
        `rebinding watcher to ancestor (${reason}): ${describeEl(this.watchContainer)} → ${describeEl(best)}`,
        'ok',
      );
      this.attachWatcher(best, `ancestor:${reason}`);
      this.scanLatestAssistant(`after-ancestor:${reason}`);
    }
  }

  private handleParseOutcome(outcome: ParseOutcome): void {
    if (outcome.kind === 'none') return;
    if (outcome.kind === 'rejected') {
      // Other bubbles often fail parse (bootstrap prose, partial code). Log only —
      // showing a toast was clearing the Run button on the next rescan.
      this.debug.log(`rejected (ignored): ${outcome.reason}`);
      return;
    }
    if (this.historicalToolRequestIds.has(outcome.request.id)) {
      this.debug.log(`historical tool ignored id=${outcome.request.id}`);
      return;
    }
    // Already answered in this transcript (e.g. result fence still on screen).
    if (transcriptHasToolResult(document, outcome.request.id)) {
      this.historicalToolRequestIds.add(outcome.request.id);
      this.debug.log(`already-answered tool ignored id=${outcome.request.id}`);
      return;
    }
    if (this.overlay.isBlocking()) {
      this.debug.log(`already awaiting user action — skip re-notify for ${outcome.request.id}`);
      return;
    }
    this.debug.log(`→ tool-request-detected ${outcome.request.tool} id=${outcome.request.id}`, 'ok');
    send({ type: 'cb/tool-request-detected', request: outcome.request });
  }

  private scanLatestAssistant(reason: string): void {
    if (this.overlay.isBlocking()) {
      this.debug.log(`${reason} scan skipped — waiting for Run/Decline`);
      return;
    }
    const container =
      this.adapter.getMessageContainer(document) ?? this.watchContainer ?? document.body;
    if (
      this.watcher &&
      container !== this.watchContainer &&
      (container.getAttribute('data-testid') === 'MessageListContainer' ||
        container.classList.contains('fai-CopilotChat'))
    ) {
      this.attachWatcher(container, `scan-promote:${reason}`);
    }

    const messages = this.adapter.getAssistantMessageElements(container);
    this.debug.log(`${reason} scan: container=${describeEl(container)} assistants=${messages.length}`);
    if (messages.length === 0) return;

    // Only the newest assistant turn can request tools. Older LOCAL_TOOL_REQUEST
    // fences stay in the DOM forever after resume — never walk back into them.
    const latest = messages[messages.length - 1]!;
    const latestText = this.adapter.getMessageText(latest) || latest.textContent || '';
    const latestOutcome = parseToolRequestFromMessage(this.adapter, latest, this.debug);
    if (latestOutcome.kind === 'request') {
      this.handleParseOutcome(latestOutcome);
      return;
    }
    if (latestOutcome.kind === 'rejected') {
      this.handleParseOutcome(latestOutcome);
    }

    // Code blocks inside the latest message only (not the whole page history).
    for (const block of Array.from(latest.querySelectorAll(CODE_BLOCK_SELECTOR))) {
      const text = (block as HTMLElement).innerText || block.textContent || '';
      if (!looksLikeToolPayload(text)) continue;
      const outcome = parseLooseToolText(text);
      if (outcome.kind === 'request') {
        this.debug.log(`${reason} latest-msg code block → request`, 'ok');
        this.handleParseOutcome(outcome);
        return;
      }
    }

    if (!looksLikeToolPayload(latestText)) {
      this.debug.log(
        `${reason}: latest assistant has no tool request (ok if prose/options)`,
      );
    }
  }

  private onFinalAssistantMessage(text: string, el?: Element): void {
    this.debug.log(`watcher settled len=${text.length} el=${describeEl(el)}`);
    this.scanLatestAssistant('watcher-settled');
  }

  private onToolResultReady(
    result: LocalToolResult,
    requiresConfirmation: boolean,
    autoSubmit: boolean,
  ): void {
    const text = formatToolResultFence(result);
    if (requiresConfirmation) {
      this.overlay.showToolResultConfirmation(result, {
        onInsert: () => this.insertResult(text, autoSubmit, result.requestId),
        onDiscard: () => {
          this.overlay.clear();
          send({ type: 'cb/tool-insert-failed', requestId: result.requestId });
        },
      });
      return;
    }
    this.insertResult(text, autoSubmit, result.requestId);
  }

  private insertResult(text: string, autoSubmit: boolean, requestId?: string): void {
    void this.insertResultAsync(text, autoSubmit, requestId);
  }

  private async insertResultAsync(
    text: string,
    autoSubmit: boolean,
    requestId?: string,
  ): Promise<void> {
    if (!this.composer || !isAdapterUsable(this.adapter, document)) {
      this.composer = this.adapter.getComposer(document);
    }
    if (!this.composer) {
      this.debug.log('lost composer — cannot insert result', 'error');
      if (requestId) send({ type: 'cb/tool-insert-failed', requestId });
      this.overlay.showTransientNotice(
        'Lost track of the chat composer; could not insert the tool result automatically.',
        'error',
      );
      return;
    }
    if (autoSubmit) {
      let submitted = false;
      if (this.adapter.insertAndSubmit) {
        submitted = await this.adapter.insertAndSubmit(this.composer, text);
      } else {
        this.adapter.setComposerText(this.composer, text);
        await sleep(120);
        submitted = this.adapter.submit(document, this.composer);
      }
      this.debug.log(`result inserted submit=${submitted}`, submitted ? 'ok' : 'warn');
      if (!submitted && requestId) {
        send({ type: 'cb/tool-insert-failed', requestId });
      } else if (submitted && requestId) {
        this.historicalToolRequestIds.add(requestId);
      }
      this.overlay.clear();
      this.overlay.showTransientNotice(
        submitted
          ? 'Local tool result sent to Copilot.'
          : 'Result pasted — Send was not ready; click Send if needed.',
        submitted ? 'info' : 'error',
      );
      this.startHeartbeatScans();
      window.setTimeout(() => this.scanLatestAssistant('after-result'), 1500);
      window.setTimeout(() => this.scanLatestAssistant('after-result-2'), 4000);
    } else {
      this.adapter.setComposerText(this.composer, text);
      this.debug.log('result inserted (manual send)', 'ok');
      this.overlay.showTransientNotice(
        'Result inserted into the composer — review and send it yourself.',
      );
    }
  }
}

function isBackgroundMessage(message: unknown): message is BackgroundToContentMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith('bc/')
  );
}

/** Request ids already present as LOCAL_TOOL_REQUEST or LOCAL_TOOL_RESULT in the page. */
function collectHistoricalToolRequestIds(doc: Document): string[] {
  const text = doc.body?.innerText ?? '';
  const ids = new Set<string>();
  for (const m of text.matchAll(/"requestId"\s*:\s*"([^"]{1,128})"/g)) {
    ids.add(m[1]!);
  }
  for (const m of text.matchAll(
    /"type"\s*:\s*"LOCAL_TOOL_REQUEST"[\s\S]{0,400}?"id"\s*:\s*"([^"]{1,128})"/g,
  )) {
    ids.add(m[1]!);
  }
  for (const m of text.matchAll(
    /"id"\s*:\s*"([^"]{1,128})"[\s\S]{0,400}?"type"\s*:\s*"LOCAL_TOOL_REQUEST"/g,
  )) {
    ids.add(m[1]!);
  }
  return [...ids];
}

function transcriptHasToolResult(doc: Document, requestId: string): boolean {
  const text = doc.body?.innerText ?? '';
  if (!text.includes('LOCAL_TOOL_RESULT')) return false;
  return (
    text.includes(`"requestId": "${requestId}"`) ||
    text.includes(`"requestId":"${requestId}"`) ||
    new RegExp(`"requestId"\\s*:\\s*"${escapeRegExp(requestId)}"`).test(text)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main(): void {
  const adapter = selectAdapter(location.href);
  if (!adapter) return;
  const controller = new BridgeContentController(adapter);
  controller.init();
}

main();
