import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom does not reliably provide `crypto.subtle` (or crypto.randomUUID on
// older Node/jsdom combinations); fall back to Node's WebCrypto so hash.ts
// and storage.ts behave the same way they do inside a real Chrome renderer.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

type StorageArea = 'local' | 'session' | 'sync';

/** Minimal, promise-based in-memory stand-in for chrome.storage.<area>. */
function createStorageArea() {
  let data: Record<string, unknown> = {};

  return {
    get(
      keys?: string | string[] | Record<string, unknown> | null,
    ): Promise<Record<string, unknown>> {
      if (keys === undefined || keys === null) {
        return Promise.resolve({ ...data });
      }
      if (typeof keys === 'string') {
        return Promise.resolve(keys in data ? { [keys]: data[keys] } : {});
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in data) result[key] = data[key];
        }
        return Promise.resolve(result);
      }
      const result: Record<string, unknown> = { ...keys };
      for (const key of Object.keys(keys)) {
        if (key in data) result[key] = data[key];
      }
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>): Promise<void> {
      data = { ...data, ...items };
      return Promise.resolve();
    },
    remove(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
      return Promise.resolve();
    },
    clear(): Promise<void> {
      data = {};
      return Promise.resolve();
    },
    __reset(): void {
      data = {};
    },
  };
}

const storageAreas: Record<StorageArea, ReturnType<typeof createStorageArea>> = {
  local: createStorageArea(),
  session: createStorageArea(),
  sync: createStorageArea(),
};

const fakeChrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
    getURL: (path: string) => `chrome-extension://test-extension-id/${path.replace(/^\/+/, '')}`,
  },
  storage: {
    local: storageAreas.local,
    session: storageAreas.session,
    sync: storageAreas.sync,
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onRemoved: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn().mockResolvedValue(true),
    onAlarm: { addListener: vi.fn() },
  },
  notifications: {
    create: vi.fn(),
    onButtonClicked: { addListener: vi.fn() },
  },
  permissions: {
    contains: vi.fn().mockResolvedValue(false),
    request: vi.fn().mockResolvedValue(false),
  },
};

// @ts-expect-error -- intentionally partial mock of the global chrome namespace for unit tests.
globalThis.chrome = fakeChrome;

beforeEach(() => {
  storageAreas.local.__reset();
  storageAreas.session.__reset();
  storageAreas.sync.__reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
