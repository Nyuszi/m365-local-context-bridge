import { describe, expect, it } from 'vitest';
import { parseAssistantMessage } from './parser';

describe('parser', () => {
  it('accepts a single valid local-tool-request fence', () => {
    const text = `Here you go:\n\`\`\`local-tool-request\n{"protocolVersion":"1.0","type":"LOCAL_TOOL_REQUEST","id":"r1","tool":"project_info","arguments":{}}\n\`\`\``;
    const out = parseAssistantMessage(text);
    expect(out.kind).toBe('request');
    if (out.kind === 'request') expect(out.request.tool).toBe('project_info');
  });

  it('recovers when fence body still has a Copilot Dart badge line', () => {
    const text = `\`\`\`local-tool-request
Dart
{
  "protocolVersion": "1.0",
  "type": "LOCAL_TOOL_REQUEST",
  "id": "directory-summary-002",
  "tool": "directory_summary",
  "arguments": {}
}
\`\`\``;
    const outcome = parseAssistantMessage(text);
    expect(outcome.kind).toBe('request');
    if (outcome.kind === 'request') {
      expect(outcome.request.tool).toBe('directory_summary');
    }
  });

  it('rejects multiple request fences', () => {
    const block =
      '```local-tool-request\n{"protocolVersion":"1.0","type":"LOCAL_TOOL_REQUEST","id":"r1","tool":"project_info","arguments":{}}\n```';
    const out = parseAssistantMessage(block + '\n' + block.replace('r1', 'r2'));
    expect(out.kind).toBe('rejected');
  });

  it('ignores other fence languages and prose json', () => {
    const text = '```json\n{"tool":"project_info"}\n```\n{"protocolVersion":"1.0"}';
    expect(parseAssistantMessage(text).kind).toBe('none');
  });

  it('recovers a request when Copilot rewrites the fence language to Kotlin', () => {
    const text = `Sure.\n\`\`\`kotlin\n${JSON.stringify({
      protocolVersion: '1.0',
      type: 'LOCAL_TOOL_REQUEST',
      id: 'find-ts-files-001',
      tool: 'find_files',
      arguments: { pattern: '*.ts' },
    })}\n\`\`\``;
    const out = parseAssistantMessage(text);
    expect(out.kind).toBe('request');
    if (out.kind === 'request') {
      expect(out.request.tool).toBe('find_files');
      expect(out.request.id).toBe('find-ts-files-001');
    }
  });

  it('recovers a request from unfenced JSON when the fence language is lost', () => {
    const text = `Here is the call:\n${JSON.stringify({
      protocolVersion: '1.0',
      type: 'LOCAL_TOOL_REQUEST',
      id: 'dom-1',
      tool: 'project_info',
      arguments: {},
    })}\nThanks.`;
    const out = parseAssistantMessage(text);
    expect(out.kind).toBe('request');
    if (out.kind === 'request') expect(out.request.id).toBe('dom-1');
  });

  it('rejects unknown tools', () => {
    const text =
      '```local-tool-request\n{"protocolVersion":"1.0","type":"LOCAL_TOOL_REQUEST","id":"r1","tool":"shell","arguments":{}}\n```';
    const out = parseAssistantMessage(text);
    expect(out.kind).toBe('rejected');
    if (out.kind === 'rejected') expect(out.reason).toBe('unknown-tool');
  });
});
