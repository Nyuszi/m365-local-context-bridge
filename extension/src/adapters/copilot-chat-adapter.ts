import { DEFAULT_COPILOT_ORIGINS } from '../config/defaults';
import { reconstructMarkdownFromDom } from './markdown';
import { queryFirst, queryFirstVisible, type SiteAdapter } from './types';

/** Reject SPA path placeholders that are not real Copilot conversation ids. */
export function isPlausibleConversationId(id: string): boolean {
  const t = id.trim();
  if (t.length < 8 || t.length > 128) return false;
  if (/^(new|home|chat|conversation|conversations|thread|threads|index)$/i.test(t)) {
    return false;
  }
  // Prefer UUID / opaque tokens; allow other long ids with enough entropy.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return true;
  }
  return /[0-9a-f]{8,}/i.test(t) || (t.length >= 16 && /[a-z0-9_-]+/i.test(t));
}

/**
 * Copilot uses either `?conversationId=` or `/chat/conversation/{uuid}` (current).
 * Also accepts legacy `/chat/{uuid}`.
 */
export function extractCopilotConversationId(href: string): string | null {
  try {
    const url = new URL(href);
    const fromQuery = [
      url.searchParams.get('conversationId'),
      url.searchParams.get('threadId'),
      url.searchParams.get('chatId'),
      url.hash.match(/(?:conversationId|threadId|chatId)=([^&]+)/i)?.[1] ?? null,
    ];
    for (const raw of fromQuery) {
      const id = raw?.trim();
      if (id && isPlausibleConversationId(id)) return id;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    // /chat/conversation/<id>
    if (
      parts.length >= 3 &&
      /^chat$/i.test(parts[0]!) &&
      /^conversation$/i.test(parts[1]!)
    ) {
      const id = decodeURIComponent(parts[2]!);
      if (isPlausibleConversationId(id)) return id;
    }
    // /chat/<id> — ignore bare /chat, /chat/new, /chat/conversation
    if (parts.length >= 2 && /^chat$/i.test(parts[0]!)) {
      const id = decodeURIComponent(parts[1]!);
      if (isPlausibleConversationId(id)) return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Prefer the live tab URL when it already deep-links; else path form Copilot uses today. */
export function buildCopilotConversationUrl(chatId: string, currentUrl?: string): string {
  const id = chatId.trim();
  if (currentUrl) {
    try {
      const extracted = extractCopilotConversationId(currentUrl);
      if (extracted && extracted === id) {
        const u = new URL(currentUrl);
        u.hash = '';
        return u.toString();
      }
      if (/\/chat\/conversation\//i.test(currentUrl) || /[?&](?:conversationId|threadId)=/i.test(currentUrl)) {
        const u = new URL(currentUrl);
        u.hash = '';
        return u.toString();
      }
    } catch {
      /* fall through */
    }
  }
  return `https://m365.cloud.microsoft/chat/conversation/${encodeURIComponent(id)}`;
}

/**
 * Adapter for Microsoft 365 Copilot Chat / copilot.microsoft.com.
 *
 * Live-tuned against m365.cloud.microsoft/chat ("New design", Aug 2026):
 * - Composer is a Lexical editor: `#m365-chat-editor-target-element`
 *   (`span[contenteditable][role=textbox][data-lexical-editor=true]`,
 *   aria-label "Message Copilot").
 * - Send control: `button[aria-label="Send"]` / `.fai-SendButton`.
 * - Empty new-chat views often have no `[role=log]` / assistant nodes; only
 *   `main` is a reliable message-root signal until the first reply arrives.
 */
export class CopilotChatAdapter implements SiteAdapter {
  readonly id = 'copilot';
  readonly displayName = 'Microsoft 365 Copilot Chat';

  private static readonly MESSAGE_CONTAINER_SELECTORS = [
    // Prefer the real transcript root — never the composer chrome.
    '[data-testid="MessageListContainer"]',
    '.fai-CopilotChat',
    '[data-testid="chat-messages"]',
    '[data-testid*="message-list" i]',
    '[role="feed"].fai-CopilotChat',
    '[role="log"]',
    '[role="feed"]',
    'main [role="region"][aria-label*="chat" i]',
    'main [role="region"][aria-label*="conversation" i]',
    '[aria-label*="Chat messages" i]',
    'main',
  ];

  private static readonly ASSISTANT_MESSAGE_SELECTORS = [
    // Live M365 "New design" (Aug 2026)
    '.fai-CopilotMessage',
    '[data-testid="copilot-message-div"]',
    '[data-testid="copilot-message-reply-div"]',
    '[data-testid="markdown-reply"]',
    '[data-testid="chatOutput"]',
    // Legacy / alternate hosts
    '[data-message-author-role="assistant"]',
    '[data-author="assistant"]',
    '[data-content="ai-message"]',
    '[data-content="assistant"]',
    '[data-testid*="assistant" i]',
    '[data-testid*="response-message" i]',
    '[aria-label*="Copilot said" i]',
    '.assistant-message',
    '.ac-textBlock',
    '[class*="ai-message" i]',
  ];

  private static readonly COMPOSER_SELECTORS = [
    // Live M365 "New design" Lexical editor (preferred, most specific first)
    '#m365-chat-editor-target-element',
    '[data-lexical-editor="true"]',
    '[aria-label="Message Copilot"]',
    '[data-placeholder="Message Copilot"]',
    '.fai-EditorInput__input',
    'textarea#userInput',
    '#userInput',
    'textarea[data-testid="composer-input"]',
    'textarea[data-testid*="composer" i]',
    'textarea[aria-label*="Ask" i]',
    'textarea[aria-label*="Message" i]',
    'textarea[aria-label*="Copilot" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="Copilot" i]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="Ask" i]',
    'div[contenteditable="true"][aria-label*="Message" i]',
    'div.ProseMirror[contenteditable="true"]',
  ];

  private static readonly SEND_BUTTON_SELECTORS = [
    'button[aria-label="Send"]',
    'button.fai-SendButton',
    '.fai-SendButton',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[data-testid*="send" i]',
    'button[data-testid*="submit" i]',
  ];

  matchesUrl(url: string): boolean {
    return DEFAULT_COPILOT_ORIGINS.some((pattern) => {
      const host = pattern.replace('https://', '').replace('/*', '');
      try {
        return new URL(url).hostname === host;
      } catch {
        return false;
      }
    });
  }

  computeConfidence(doc: Document): number {
    // Empty new-chat views have a composer + send but no assistant messages yet.
    // Weight the composer heavily so we remain usable before the first reply.
    let score = 0;
    if (this.getComposer(doc)) score += 0.5;
    if (queryFirstVisible(doc, CopilotChatAdapter.SEND_BUTTON_SELECTORS)) score += 0.25;
    if (this.getMessageContainer(doc)) score += 0.15;
    if (queryFirstVisible(doc, CopilotChatAdapter.ASSISTANT_MESSAGE_SELECTORS)) score += 0.1;
    return score;
  }

  getMessageContainer(doc: Document): Element | null {
    // Do NOT use visibility filtering here: MessageListContainer often has
    // zero client rects briefly during SPA transitions, which previously made
    // us bind the watcher to a random DIV (composer chrome) and miss replies.
    return (
      queryFirst(doc, [
        '[data-testid="MessageListContainer"]',
        '.fai-CopilotChat',
        '[data-testid="chat-messages"]',
        '[data-testid*="message-list" i]',
      ]) ?? queryFirst(doc, CopilotChatAdapter.MESSAGE_CONTAINER_SELECTORS)
    );
  }

  getAssistantMessageElements(container: Element): Element[] {
    // Prefer top-level Copilot message articles so nested markdown/reply nodes
    // are not treated as separate messages (which broke "latest message" watching).
    const primary = Array.from(container.querySelectorAll('.fai-CopilotMessage'));
    if (primary.length > 0) return primary;

    const combined = CopilotChatAdapter.ASSISTANT_MESSAGE_SELECTORS.join(', ');
    const all = Array.from(container.querySelectorAll(combined));
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  }

  getMessageText(el: Element): string {
    const content =
      el.querySelector('.fai-CopilotMessage__content') ??
      el.querySelector('[data-testid="markdown-reply"]') ??
      el.querySelector('[data-testid="copilot-message-reply-div"]') ??
      el;
    const fromContent = reconstructMarkdownFromDom(content);
    if (/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(fromContent)) return fromContent;

    // Code boxes sometimes sit outside the markdown content wrapper, or keep
    // the JSON body in an open shadow root (host innerText then looks empty).
    const fromMessage = reconstructMarkdownFromDom(el);
    if (/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(fromMessage)) return fromMessage;

    return fromContent.length >= fromMessage.length ? fromContent : fromMessage;
  }

  isMessageStreaming(el: Element): boolean {
    const ariaBusy = el.getAttribute('aria-busy');
    if (ariaBusy === 'true') return true;
    if (el.querySelector('[data-testid="loading-message"]')) return true;
    return el.classList.contains('streaming') || el.classList.contains('is-typing');
  }

  getComposer(doc: Document): HTMLElement | null {
    return queryFirstVisible(doc, CopilotChatAdapter.COMPOSER_SELECTORS);
  }

  setComposerText(composer: HTMLElement, text: string): void {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      composer.focus();
      composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Lexical / contenteditable: select-all + insertText is what M365's editor accepts.
    const doc = composer.ownerDocument;
    composer.focus();
    try {
      const selection = doc.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(composer);
      selection?.removeAllRanges();
      selection?.addRange(range);
      doc.execCommand('delete', false);
      const inserted = doc.execCommand('insertText', false, text);
      if (!inserted) {
        this.pasteIntoComposer(composer, text);
      }
    } catch {
      this.pasteIntoComposer(composer, text);
    }

    composer.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
    );
  }

  private pasteIntoComposer(composer: HTMLElement, text: string): void {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const paste = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      });
      if (!composer.dispatchEvent(paste) || !(composer.textContent || '').includes(text.slice(0, 24))) {
        composer.textContent = text;
      }
    } catch {
      composer.textContent = text;
    }
  }

  /** True when the Send control looks clickable. */
  private isSendEnabled(button: HTMLElement): boolean {
    if (button.getAttribute('aria-disabled') === 'true') return false;
    if ((button as HTMLButtonElement).disabled) return false;
    if (button.hasAttribute('disabled')) return false;
    return true;
  }

  submit(doc: Document, composer: HTMLElement): boolean {
    const button = queryFirstVisible<HTMLElement>(doc, CopilotChatAdapter.SEND_BUTTON_SELECTORS);
    if (button && this.isSendEnabled(button)) {
      button.click();
      return true;
    }
    // Lexical often ignores synthetic Enter until its React state catches up —
    // still try; callers should retry via submitWhenReady.
    composer.focus();
    composer.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    composer.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    return Boolean(button);
  }

  /**
   * Insert then wait for Copilot's Send button to enable (Lexical is async).
   * Clicks Send at most once successfully — never mixes Enter + repeated clicks.
   */
  async insertAndSubmit(composer: HTMLElement, text: string): Promise<boolean> {
    const doc = composer.ownerDocument;
    let active = this.getComposer(doc) ?? composer;
    active.focus();
    this.setComposerText(active, text);
    await new Promise((r) => setTimeout(r, 400));

    let clicked = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      active = this.getComposer(doc) ?? active;
      const button = queryFirstVisible<HTMLElement>(doc, CopilotChatAdapter.SEND_BUTTON_SELECTORS);
      if (button && (this.isSendEnabled(button) || attempt >= 12)) {
        if (!clicked) {
          active.focus();
          button.click();
          clicked = true;
        }
        await new Promise((r) => setTimeout(r, 200));
        const remaining = (active.textContent || '').trim();
        if (!remaining || remaining.length < Math.min(40, text.length / 4)) {
          return true;
        }
        // Click didn't clear — allow one more click after a pause (Lexical flakiness).
        if (attempt === 18 && clicked) {
          clicked = false;
        }
        continue;
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    if (!clicked) {
      return this.submit(doc, this.getComposer(doc) ?? active);
    }
    // Clicked but composer still has text — report failure so caller can retry / prompt.
    const remaining = ((this.getComposer(doc) ?? active).textContent || '').trim();
    return !remaining || remaining.length < Math.min(40, text.length / 4);
  }

  getConversationId(doc: Document): string | null {
    const hrefs: string[] = [doc.location.href];
    try {
      const topHref = doc.defaultView?.top?.location?.href;
      if (topHref && topHref !== doc.location.href) hrefs.push(topHref);
    } catch {
      /* cross-origin iframe — ignore */
    }
    for (const href of hrefs) {
      const fromUrl = extractCopilotConversationId(href);
      if (fromUrl) return fromUrl;
    }

    const attrHost = doc.querySelector<HTMLElement>(
      '[data-conversation-id], [data-thread-id], [data-chat-id]',
    );
    const fromAttr =
      attrHost?.getAttribute('data-conversation-id') ||
      attrHost?.getAttribute('data-thread-id') ||
      attrHost?.getAttribute('data-chat-id');
    if (fromAttr?.trim() && isPlausibleConversationId(fromAttr.trim())) {
      return fromAttr.trim();
    }

    return null;
  }

  /**
   * Best-effort chat rename. Copilot's title UI varies; we try common patterns
   * and never throw — callers treat failure as non-fatal.
   */
  setConversationTitle(doc: Document, title: string): boolean {
    const trimmed = title.trim().slice(0, 120);
    if (!trimmed) return false;

    const renameButton = queryFirstVisible<HTMLElement>(doc, [
      'button[aria-label*="Rename" i]',
      'button[title*="Rename" i]',
      '[data-testid*="rename" i]',
      'button[aria-label*="Edit chat" i]',
      'button[aria-label*="Edit title" i]',
    ]);
    if (renameButton) {
      renameButton.click();
    }

    const input = queryFirstVisible<HTMLInputElement | HTMLTextAreaElement>(doc, [
      'input[aria-label*="title" i]',
      'input[aria-label*="name" i]',
      'input[placeholder*="title" i]',
      'input[placeholder*="name" i]',
      '[role="dialog"] input[type="text"]',
      '[role="dialog"] input:not([type])',
    ]);
    if (input) {
      input.focus();
      input.value = trimmed;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const confirm = queryFirstVisible<HTMLElement>(doc, [
        '[role="dialog"] button[aria-label*="Save" i]',
        '[role="dialog"] button[aria-label*="Rename" i]',
        '[role="dialog"] button[type="submit"]',
      ]);
      confirm?.click();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
      return true;
    }

    // Fallback: editable title heading in the chat chrome.
    const heading = queryFirstVisible<HTMLElement>(doc, [
      'h1[contenteditable="true"]',
      '[data-testid*="conversation-title" i]',
      '[aria-label*="conversation title" i]',
      'header h1',
      'main h1',
    ]);
    if (heading && heading.isContentEditable) {
      heading.focus();
      heading.textContent = trimmed;
      heading.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    return false;
  }
}
