import type { LocalToolRequest } from './types';

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('SubtleCrypto is not available in this environment');
  }
  return c.subtle;
}

/** Lowercase hex-encoded SHA-256 digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await getSubtle().digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Deterministic JSON stringification with recursively sorted object keys. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = sortKeysDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Computes a stable content fingerprint for a request: its declared id plus
 * a SHA-256 hash of the canonicalized payload. Two requests with the same id
 * but different arguments (e.g. a model retrying with edits) still produce
 * distinct fingerprints, while byte-identical re-emissions (e.g. duplicated
 * by a streaming re-render) collapse to the same one.
 */
export async function fingerprintRequest(request: LocalToolRequest): Promise<string> {
  const hash = await sha256Hex(canonicalStringify(request));
  return `${request.id}:${hash}`;
}

interface SeenEntry {
  timestamp: number;
}

/**
 * Bounded, time-pruned set of request fingerprints already acted upon,
 * used to ignore duplicate tool requests re-observed by the MutationObserver
 * (e.g. re-renders, streaming re-flows) without re-executing side effects.
 */
export class SeenRequestTracker {
  private readonly seen = new Map<string, SeenEntry>();

  constructor(
    private readonly maxEntries = 200,
    private readonly maxAgeMs = 30 * 60 * 1000,
  ) {}

  has(fingerprint: string): boolean {
    return this.seen.has(fingerprint);
  }

  remember(fingerprint: string, now: number = Date.now()): void {
    this.prune(now);
    this.seen.set(fingerprint, { timestamp: now });
    if (this.seen.size > this.maxEntries) {
      const oldestKey = this.seen.keys().next().value;
      if (oldestKey !== undefined) {
        this.seen.delete(oldestKey);
      }
    }
  }

  forget(fingerprint: string): void {
    this.seen.delete(fingerprint);
  }

  prune(now: number = Date.now()): void {
    for (const [key, entry] of this.seen) {
      if (now - entry.timestamp > this.maxAgeMs) {
        this.seen.delete(key);
      }
    }
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
