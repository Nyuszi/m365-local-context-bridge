import { describe, expect, it } from 'vitest';
import { canonicalStringify, fingerprintRequest, sha256Hex, SeenRequestTracker } from './hash';
import type { LocalToolRequest } from './types';

const REQUEST: LocalToolRequest = {
  protocolVersion: '1.0',
  type: 'LOCAL_TOOL_REQUEST',
  id: 'req-1',
  tool: 'project_info',
  arguments: { rootAlias: 'billing-service' },
};

describe('sha256Hex', () => {
  it('produces the known SHA-256 digest for a fixed input', async () => {
    // printf '%s' "local-context-bridge" | shasum -a 256
    expect(await sha256Hex('local-context-bridge')).toBe(
      'b5f3617dc6b9c4ebd3f64471976ad4cf9a387eaaa807b06a1b872a960ca03823',
    );
  });

  it('is deterministic for the same input', async () => {
    const a = await sha256Hex('hello world');
    const b = await sha256Hex('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different inputs', async () => {
    const a = await sha256Hex('hello');
    const b = await sha256Hex('world');
    expect(a).not.toBe(b);
  });
});

describe('canonicalStringify', () => {
  it('sorts object keys recursively regardless of insertion order', () => {
    const a = canonicalStringify({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalStringify({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('sorts keys inside array elements', () => {
    expect(canonicalStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe('fingerprintRequest', () => {
  it('produces the same fingerprint for identical requests', async () => {
    const a = await fingerprintRequest(REQUEST);
    const b = await fingerprintRequest({ ...REQUEST, arguments: { rootAlias: 'billing-service' } });
    expect(a).toBe(b);
  });

  it('is insensitive to argument key ordering', async () => {
    const a = await fingerprintRequest({ ...REQUEST, arguments: { x: 1, y: 2 } });
    const b = await fingerprintRequest({ ...REQUEST, arguments: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });

  it('differs when arguments differ', async () => {
    const a = await fingerprintRequest(REQUEST);
    const b = await fingerprintRequest({ ...REQUEST, arguments: { rootAlias: 'other-service' } });
    expect(a).not.toBe(b);
  });

  it('starts with the request id', async () => {
    const fp = await fingerprintRequest(REQUEST);
    expect(fp.startsWith(`${REQUEST.id}:`)).toBe(true);
  });
});

describe('SeenRequestTracker', () => {
  it('reports unseen fingerprints as not seen', () => {
    const tracker = new SeenRequestTracker();
    expect(tracker.has('fp-1')).toBe(false);
  });

  it('remembers a fingerprint once recorded', () => {
    const tracker = new SeenRequestTracker();
    tracker.remember('fp-1', 1000);
    expect(tracker.has('fp-1')).toBe(true);
  });

  it('prunes entries older than maxAgeMs', () => {
    const tracker = new SeenRequestTracker(200, 1000);
    tracker.remember('fp-1', 0);
    tracker.prune(500);
    expect(tracker.has('fp-1')).toBe(true);
    tracker.prune(1500);
    expect(tracker.has('fp-1')).toBe(false);
  });

  it('evicts the oldest entry once maxEntries is exceeded', () => {
    const tracker = new SeenRequestTracker(2, 60_000);
    tracker.remember('fp-1', 0);
    tracker.remember('fp-2', 1);
    tracker.remember('fp-3', 2);
    expect(tracker.size).toBe(2);
    expect(tracker.has('fp-1')).toBe(false);
    expect(tracker.has('fp-3')).toBe(true);
  });

  it('clears all entries', () => {
    const tracker = new SeenRequestTracker();
    tracker.remember('fp-1');
    tracker.clear();
    expect(tracker.size).toBe(0);
  });
});
