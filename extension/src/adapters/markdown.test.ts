import { describe, expect, it } from 'vitest';
import { reconstructMarkdownFromDom, stripCopilotCodeGutter } from './markdown';
import { parseAssistantMessage } from '../protocol/parser';

describe('reconstructMarkdownFromDom', () => {
  it('rebuilds pre/code fences with language classes', () => {
    document.body.innerHTML = `
      <div>
        <p>Let me check.</p>
        <pre><code class="language-local-tool-request">{"a":1}</code></pre>
      </div>
    `;
    const text = reconstructMarkdownFromDom(document.body);
    expect(text).toContain('```local-tool-request');
    expect(text).toContain('{"a":1}');
  });

  it('recovers local-tool-request from M365 scriptor blocks with a Kotlin badge', () => {
    const payload = JSON.stringify(
      {
        protocolVersion: '1.0',
        type: 'LOCAL_TOOL_REQUEST',
        id: 'find-ts-files-001',
        tool: 'find_files',
        arguments: { pattern: '*.ts' },
      },
      null,
      2,
    );
    document.body.innerHTML = `
      <div class="fai-CopilotMessage">
        <div class="scriptor-component-code-block scriptor-codeblock-virtualized">
          <div id="language-badge">Kotlin</div>
          <div></div>
        </div>
      </div>
    `;
    const block = document.querySelector('.scriptor-component-code-block') as HTMLElement;
    Object.defineProperty(block, 'innerText', {
      configurable: true,
      get: () =>
        `Kotlin\nlocal-tool-request isn't fully supported. Syntax highlighting is based on Kotlin.\n${payload
          .split('\n')
          .flatMap((line, i) => [String(i + 1), line])
          .join('\n')}`,
    });

    const text = reconstructMarkdownFromDom(document.querySelector('.fai-CopilotMessage')!);
    expect(text).toContain('```local-tool-request');
    const parsed = parseAssistantMessage(text);
    expect(parsed.kind).toBe('request');
    if (parsed.kind === 'request') expect(parsed.request.tool).toBe('find_files');
  });

  it('recovers when Copilot falls back to Dart highlighting', () => {
    const payload = `{
  "protocolVersion": "1.0",
  "type": "LOCAL_TOOL_REQUEST",
  "id": "directory-summary-002",
  "tool": "directory_summary",
  "arguments": {}
}`;
    const guttered = `Dart\nlocal-tool-request isn't fully supported. Syntax highlighting is based on Dart.\n${payload
      .split('\n')
      .flatMap((line, i) => [String(i + 1), line])
      .join('\n')}`;
    const cleaned = stripCopilotCodeGutter(guttered);
    expect(cleaned.startsWith('{')).toBe(true);
    expect(cleaned).not.toMatch(/\bDart\b/);

    document.body.innerHTML = `
      <div class="fai-CopilotMessage">
        <div class="scriptor-component-code-block">
          <div id="language-badge">Dart</div>
        </div>
      </div>
    `;
    const block = document.querySelector('.scriptor-component-code-block') as HTMLElement;
    Object.defineProperty(block, 'innerText', {
      configurable: true,
      get: () => guttered,
    });
    const text = reconstructMarkdownFromDom(document.querySelector('.fai-CopilotMessage')!);
    const parsed = parseAssistantMessage(text);
    expect(parsed.kind).toBe('request');
    if (parsed.kind === 'request') {
      expect(parsed.request.tool).toBe('directory_summary');
      expect(parsed.request.id).toBe('directory-summary-002');
    }
  });

  it('strips Copilot gutter line numbers so JSON can parse', () => {
    const guttered = `Kotlin\n1\n{\n2\n  "protocolVersion": "1.0",\n3\n  "type": "LOCAL_TOOL_REQUEST",\n4\n  "id": "x",\n5\n  "tool": "find_files",\n6\n  "arguments": { "pattern": "*.ts" }\n7\n}`;
    const cleaned = stripCopilotCodeGutter(guttered);
    expect(cleaned).not.toMatch(/^\d+$/m);
    const parsed = parseAssistantMessage(cleaned);
    expect(parsed.kind).toBe('request');
  });
});
