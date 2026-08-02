import { describe, expect, it } from 'vitest';
import {
  BOOTSTRAP_MARKER,
  containsBootstrapMarker,
  DEFAULT_EXPLORE_TASK,
  generateBootstrapMessage,
} from './bootstrap';
import { FENCE_LANGUAGE_REQUEST, FENCE_LANGUAGE_RESULT, LOCAL_TOOLS } from './types';

describe('generateBootstrapMessage', () => {
  it('includes the project alias', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'billing-service' });
    expect(msg).toContain('billing-service');
  });

  it('embeds the bootstrap marker so it can be detected later', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'billing-service' });
    expect(containsBootstrapMarker(msg)).toBe(true);
    expect(msg).toContain(BOOTSTRAP_MARKER);
  });

  it('lists every tool by default', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    for (const tool of LOCAL_TOOLS) {
      expect(msg).toContain(`\`${tool}\``);
    }
  });

  it('restricts the tool list when a subset is provided', () => {
    const msg = generateBootstrapMessage({
      projectAlias: 'demo',
      tools: ['project_info', 'read_file'],
    });
    const available = msg.split('### Tools')[1]?.split('### Rules')[0] ?? '';
    expect(available).toContain('`project_info`');
    expect(available).toContain('`read_file`');
    expect(available).not.toContain('`search_text`');
  });

  it('references both fence languages', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    expect(msg).toContain(FENCE_LANGUAGE_REQUEST);
    expect(msg).toContain(FENCE_LANGUAGE_RESULT);
  });

  it('includes the initial task when provided', () => {
    const msg = generateBootstrapMessage({
      projectAlias: 'demo',
      initialTask: 'Find the auth middleware.',
    });
    expect(msg).toContain('### First turn');
    expect(msg).toContain('Find the auth middleware.');
  });

  it('uses the light explore default when no task is provided', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    expect(msg).toContain('### First turn');
    expect(msg).toContain(DEFAULT_EXPLORE_TASK);
    expect(msg).toMatch(/what can I do for you/i);
    expect(msg).toMatch(/4 numbered options/i);
    expect(msg).not.toMatch(/Exploration playbook/i);
  });

  it('states custom limits when provided', () => {
    const msg = generateBootstrapMessage({
      projectAlias: 'demo',
      limits: { maxIterations: 7, maxSessionMinutes: 3, toolTimeoutSeconds: 5 },
    });
    expect(msg).toContain('7 tool calls');
    expect(msg).toContain('3 min');
    expect(msg).toContain('5s/tool');
  });

  it('keeps the default first turn light (structure peek + options)', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    expect(msg).toMatch(/directory_summary/i);
    expect(msg).toMatch(/Explain the overall architecture/);
    expect(msg).toMatch(/Find the main entry points/);
    expect(msg).toMatch(/Locate config/);
    expect(msg).toMatch(/Search for a symbol/);
  });

  it('embeds the initial task when provided', () => {
    const msg = generateBootstrapMessage({
      projectAlias: 'demo',
      initialTask: 'Explain the Flutter app',
    });
    expect(msg).toContain('### First turn');
    expect(msg).toContain('Explain the Flutter app');
  });

  it('never claims to alter system or developer instructions', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    expect(msg).toMatch(/does \*\*not\*\* alter[\s\S]*system prompt/i);
  });

  it('instructs the model to treat tool results as untrusted data', () => {
    const msg = generateBootstrapMessage({ projectAlias: 'demo' });
    expect(msg).toMatch(/untrusted data/i);
  });
});

describe('containsBootstrapMarker', () => {
  it('returns false for arbitrary text', () => {
    expect(containsBootstrapMarker('hello world')).toBe(false);
  });

  it('returns true when the marker is present anywhere in the text', () => {
    expect(containsBootstrapMarker(`prefix ${BOOTSTRAP_MARKER} suffix`)).toBe(true);
  });
});
