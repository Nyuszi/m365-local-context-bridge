import { reconstructMarkdownFromDom } from './markdown';
import { fractionFound, type SiteAdapter } from './types';

/**
 * Adapter for the bundled offline mock chat (`mock-chat/index.html`, served
 * by the companion at `/mock-chat/`). Its DOM is entirely under our
 * control, so this adapter targets exact ids/attributes rather than
 * heuristics and should always report full confidence when the page has
 * loaded normally.
 */
export class MockChatAdapter implements SiteAdapter {
  readonly id = 'mock-chat';
  readonly displayName = 'Mock Chat';

  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.pathname.startsWith('/mock-chat');
    } catch {
      return false;
    }
  }

  computeConfidence(doc: Document): number {
    return fractionFound(doc, [['#messages'], ['#composer'], ['#send-btn'], ['#conversation-id']]);
  }

  getMessageContainer(doc: Document): Element | null {
    return doc.getElementById('messages');
  }

  getAssistantMessageElements(container: Element): Element[] {
    return Array.from(container.querySelectorAll('.msg[data-role="assistant"]'));
  }

  getMessageText(el: Element): string {
    const content = el.querySelector('.msg-content');
    return reconstructMarkdownFromDom(content ?? el);
  }

  isMessageStreaming(el: Element): boolean {
    return el.getAttribute('data-status') === 'streaming';
  }

  getComposer(doc: Document): HTMLElement | null {
    return doc.getElementById('composer');
  }

  setComposerText(composer: HTMLElement, text: string): void {
    const textarea = composer as HTMLTextAreaElement;
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  submit(doc: Document, _composer: HTMLElement): boolean {
    const button = doc.getElementById('send-btn');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  }

  getConversationId(doc: Document): string | null {
    return doc.getElementById('conversation-id')?.dataset.conversationId ?? null;
  }
}
