import { describe, expect, it } from 'vitest';
import {
  CopilotChatAdapter,
  extractCopilotConversationId,
} from './copilot-chat-adapter';
import { MockChatAdapter } from './mock-chat-adapter';
import { isAdapterUsable, MIN_USABLE_CONFIDENCE } from './types';
import { selectAdapter } from './index';

function buildMockChatDom(): Document {
  document.body.innerHTML = `
    <div id="conversation-id" data-conversation-id="conv-42"></div>
    <div id="messages">
      <div class="msg" data-role="user" data-msg-id="m1"><div class="msg-content">Hello</div></div>
      <div class="msg" data-role="assistant" data-msg-id="m2" data-status="complete">
        <div class="msg-content">Hi there!</div>
      </div>
      <div class="msg" data-role="assistant" data-msg-id="m3" data-status="streaming">
        <div class="msg-content">Still thin</div>
      </div>
    </div>
    <textarea id="composer"></textarea>
    <button id="send-btn">Send</button>
  `;
  return document;
}

describe('MockChatAdapter', () => {
  it('matches mock-chat URLs only', () => {
    const adapter = new MockChatAdapter();
    expect(adapter.matchesUrl('http://127.0.0.1:32178/mock-chat/')).toBe(true);
    expect(adapter.matchesUrl('http://127.0.0.1:32178/mock-chat/index.html')).toBe(true);
    expect(adapter.matchesUrl('https://copilot.microsoft.com/')).toBe(false);
    expect(adapter.matchesUrl('not a url')).toBe(false);
  });

  it('reports full confidence when every expected element is present', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    expect(adapter.computeConfidence(doc)).toBe(1);
    expect(isAdapterUsable(adapter, doc)).toBe(true);
  });

  it('reports reduced confidence when elements are missing', () => {
    document.body.innerHTML = '<div id="messages"></div>';
    const adapter = new MockChatAdapter();
    expect(adapter.computeConfidence(document)).toBeCloseTo(0.25, 5);
    expect(isAdapterUsable(adapter, document)).toBe(false);
  });

  it('extracts only assistant messages, in document order', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    const container = adapter.getMessageContainer(doc)!;
    const messages = adapter.getAssistantMessageElements(container);
    expect(messages).toHaveLength(2);
    expect(adapter.getMessageText(messages[0]!)).toBe('Hi there!');
  });

  it('detects streaming vs complete messages', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    const container = adapter.getMessageContainer(doc)!;
    const [complete, streaming] = adapter.getAssistantMessageElements(container);
    expect(adapter.isMessageStreaming(complete!)).toBe(false);
    expect(adapter.isMessageStreaming(streaming!)).toBe(true);
  });

  it('reconstructs fenced code blocks from rendered <pre><code> elements', () => {
    document.body.innerHTML = `
      <div id="conversation-id" data-conversation-id="conv-1"></div>
      <div id="messages">
        <div class="msg" data-role="assistant" data-msg-id="m1" data-status="complete">
          <div class="msg-content"><p>Let me check.</p><pre><code data-lang="local-tool-request">{"a":1}</code></pre></div>
        </div>
      </div>
      <textarea id="composer"></textarea>
      <button id="send-btn">Send</button>
    `;
    const adapter = new MockChatAdapter();
    const container = adapter.getMessageContainer(document)!;
    const [msg] = adapter.getAssistantMessageElements(container);
    const text = adapter.getMessageText(msg!);
    expect(text).toContain('```local-tool-request');
    expect(text).toContain('{"a":1}');
    expect(text.trim().endsWith('```')).toBe(true);
  });

  it('writes to the composer and fires an input event', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    const composer = adapter.getComposer(doc)! as HTMLTextAreaElement;
    let sawInput = false;
    composer.addEventListener('input', () => {
      sawInput = true;
    });
    adapter.setComposerText(composer, 'hello world');
    expect(composer.value).toBe('hello world');
    expect(sawInput).toBe(true);
  });

  it('submits by clicking the send button', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    let clicked = false;
    doc.getElementById('send-btn')!.addEventListener('click', () => {
      clicked = true;
    });
    expect(adapter.submit(doc, adapter.getComposer(doc)!)).toBe(true);
    expect(clicked).toBe(true);
  });

  it('reads the conversation id from the dataset', () => {
    const doc = buildMockChatDom();
    const adapter = new MockChatAdapter();
    expect(adapter.getConversationId(doc)).toBe('conv-42');
  });
});

describe('CopilotChatAdapter', () => {
  it('matches only the configured Copilot origins', () => {
    const adapter = new CopilotChatAdapter();
    expect(adapter.matchesUrl('https://m365.cloud.microsoft/chat')).toBe(true);
    expect(adapter.matchesUrl('https://copilot.microsoft.com/')).toBe(true);
    expect(adapter.matchesUrl('http://127.0.0.1:32178/mock-chat')).toBe(false);
    expect(adapter.matchesUrl('https://evil.example.com/')).toBe(false);
  });

  it('reports low confidence against an empty document', () => {
    document.body.innerHTML = '';
    const adapter = new CopilotChatAdapter();
    expect(adapter.computeConfidence(document)).toBe(0);
    expect(isAdapterUsable(adapter, document)).toBe(false);
  });

  it('reports high confidence when all structural signals are present', () => {
    document.body.innerHTML = `
      <div role="log">
        <div data-message-author-role="assistant">Hello from Copilot</div>
      </div>
      <textarea aria-label="Ask Copilot"></textarea>
      <button aria-label="Send message">Send</button>
    `;
    const adapter = new CopilotChatAdapter();
    expect(adapter.computeConfidence(document)).toBeGreaterThanOrEqual(MIN_USABLE_CONFIDENCE);
    expect(isAdapterUsable(adapter, document)).toBe(true);
  });

  it('is usable on an empty new-chat page with only the Lexical composer', () => {
    document.body.innerHTML = `
      <main>
        <span
          id="m365-chat-editor-target-element"
          role="textbox"
          contenteditable="true"
          data-lexical-editor="true"
          aria-label="Message Copilot"
        ></span>
        <button aria-label="Send" class="fai-SendButton"></button>
      </main>
    `;
    const adapter = new CopilotChatAdapter();
    expect(adapter.getComposer(document)?.id).toBe('m365-chat-editor-target-element');
    expect(adapter.computeConfidence(document)).toBeGreaterThanOrEqual(MIN_USABLE_CONFIDENCE);
    expect(isAdapterUsable(adapter, document)).toBe(true);
  });

  it('is not usable at partial confidence below the threshold', () => {
    document.body.innerHTML = `<div role="log"></div>`;
    const adapter = new CopilotChatAdapter();
    expect(adapter.computeConfidence(document)).toBeLessThan(MIN_USABLE_CONFIDENCE);
    expect(isAdapterUsable(adapter, document)).toBe(false);
  });

  it('extracts assistant message text via reconstructed textContent', () => {
    document.body.innerHTML = `
      <div role="log">
        <div data-message-author-role="assistant">  Hello there  </div>
      </div>
    `;
    const adapter = new CopilotChatAdapter();
    const container = adapter.getMessageContainer(document)!;
    const [msg] = adapter.getAssistantMessageElements(container);
    expect(adapter.getMessageText(msg!)).toBe('Hello there');
  });

  it('treats aria-busy or streaming classes as still-streaming', () => {
    document.body.innerHTML = `
      <div role="log">
        <div data-message-author-role="assistant" aria-busy="true">partial</div>
        <div data-message-author-role="assistant" class="streaming">partial2</div>
        <div data-message-author-role="assistant">done</div>
      </div>
    `;
    const adapter = new CopilotChatAdapter();
    const container = adapter.getMessageContainer(document)!;
    const messages = adapter.getAssistantMessageElements(container);
    expect(adapter.isMessageStreaming(messages[0]!)).toBe(true);
    expect(adapter.isMessageStreaming(messages[1]!)).toBe(true);
    expect(adapter.isMessageStreaming(messages[2]!)).toBe(false);
  });

  it('writes into a contenteditable composer', () => {
    document.body.innerHTML = `<div contenteditable="true" role="textbox"></div>`;
    const adapter = new CopilotChatAdapter();
    const composer = adapter.getComposer(document)!;
    adapter.setComposerText(composer, 'hello copilot');
    expect(composer.textContent).toContain('hello copilot');
  });

  it('targets the live M365 Lexical editor id', () => {
    document.body.innerHTML = `
      <span id="m365-chat-editor-target-element" contenteditable="true" role="textbox" data-lexical-editor="true" aria-label="Message Copilot"></span>
      <div contenteditable="true" role="textbox" aria-label="other"></div>
    `;
    const adapter = new CopilotChatAdapter();
    expect(adapter.getComposer(document)?.id).toBe('m365-chat-editor-target-element');
  });

  it('reads conversation id from /chat/conversation/{uuid} path', () => {
    expect(
      extractCopilotConversationId(
        'https://m365.cloud.microsoft/chat/conversation/0de3bae0-0ad4-4fe1-8bfc-805d2e308203',
      ),
    ).toBe('0de3bae0-0ad4-4fe1-8bfc-805d2e308203');
    expect(
      extractCopilotConversationId(
        'https://m365.cloud.microsoft/chat/?conversationId=0de3bae0-0ad4-4fe1-8bfc-805d2e308203',
      ),
    ).toBe('0de3bae0-0ad4-4fe1-8bfc-805d2e308203');
    expect(extractCopilotConversationId('https://m365.cloud.microsoft/chat/conversation')).toBeNull();
    expect(extractCopilotConversationId('https://m365.cloud.microsoft/chat/new')).toBeNull();
  });
});

describe('selectAdapter', () => {
  it('picks the mock chat adapter for mock-chat URLs', () => {
    const adapter = selectAdapter('http://127.0.0.1:32178/mock-chat/');
    expect(adapter?.id).toBe('mock-chat');
  });

  it('picks the Copilot adapter for Copilot URLs', () => {
    const adapter = selectAdapter('https://copilot.microsoft.com/chat/abc');
    expect(adapter?.id).toBe('copilot');
  });

  it('returns null for unrelated URLs', () => {
    expect(selectAdapter('https://example.com/')).toBeNull();
  });
});
