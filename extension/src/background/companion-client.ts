import { COMPANION_ENDPOINTS } from '../config/defaults';
import { BridgeApiError } from '../pairing/pairing-client';
import type { LocalToolRequest, LocalToolResult } from '../protocol/types';

export interface CompanionStatusRoot {
  id: string;
  alias: string;
  /** Absolute folder path when the companion reports it (approved root only). */
  path?: string;
  primary: boolean;
  accessPolicy: string;
  persistence: string;
}

export interface CompanionStatus {
  paired: boolean;
  version: string;
  docker: boolean;
  primaryAlias: string | null;
  /** Absolute path of the current user profile (for home-folder scope). */
  homePath?: string;
  /** Companion-stored default session mode (manual|assisted|automatic). */
  defaultMode?: string;
  roots: CompanionStatusRoot[];
}

export interface RegisteredRoot {
  id: string;
  alias: string;
  path: string;
  primary: boolean;
  scope?: string;
}

export interface CompanionHealth {
  status: string;
  version: string;
  docker: boolean;
  time: string;
}

interface CompanionErrorEnvelope {
  error?: { code?: string; message?: string; correlationId?: string };
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (!response.ok) {
    const envelope = (body ?? {}) as CompanionErrorEnvelope;
    throw new BridgeApiError(
      envelope.error?.code ?? 'unknown_error',
      envelope.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      envelope.error?.correlationId,
    );
  }

  return body as T;
}

function newNonce(): string {
  return crypto.randomUUID();
}

export interface CompanionClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Authenticated client for the companion's `/api/v1/*` surface. Every call
 * takes the bearer token explicitly rather than holding it as instance
 * state, since the background service worker may be recreated between
 * calls and should always read the current token from storage first.
 */
export class CompanionClient {
  constructor(private readonly options: CompanionClientOptions) {}

  /** Call fetch as a free function — `this.fetchImpl(...)` illegal-invokes Worker fetch. */
  private callFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const impl = this.options.fetchImpl ?? globalThis.fetch;
    return init === undefined ? impl(input) : impl(input, init);
  }

  private url(path: string): string {
    return `${this.options.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async health(): Promise<CompanionHealth> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.health));
    return parseJsonOrThrow<CompanionHealth>(response);
  }

  async getStatus(token: string): Promise<CompanionStatus> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.status), {
      headers: { Authorization: `Bearer ${token}` },
    });
    return parseJsonOrThrow<CompanionStatus>(response);
  }

  /**
   * Register via the paired API, falling back to the loopback-only local
   * register endpoint (same machine) if the authenticated route is unavailable.
   */
  async registerRoot(
    token: string,
    body: { path?: string; alias: string; primary?: boolean; scope?: 'project' | 'home' },
  ): Promise<RegisteredRoot> {
    const payload = {
      path: body.path,
      alias: body.alias,
      primary: body.primary ?? true,
      scope: body.scope ?? 'project',
    };
    try {
      const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.roots), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      return await parseJsonOrThrow<RegisteredRoot>(response);
    } catch (err) {
      // Older companions or origin mismatches — loopback local API still works from the SW.
      if (payload.scope === 'home' && !payload.path) {
        throw err instanceof Error ? err : new Error('Home-folder registration failed.');
      }
      const local = await this.callFetch(this.url('/api/v1/local/register-root'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:32178',
        },
        body: JSON.stringify({
          path: payload.path,
          alias: payload.alias,
          primary: payload.primary,
        }),
      });
      return parseJsonOrThrow<RegisteredRoot>(local);
    }
  }

  async pickFolder(token: string): Promise<string> {
    try {
      const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.pickFolder), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await parseJsonOrThrow<{ path: string }>(response);
      return body.path;
    } catch {
      const local = await this.callFetch(this.url(COMPANION_ENDPOINTS.pickFolderLocal), {
        method: 'POST',
        headers: { Origin: 'http://127.0.0.1:32178' },
      });
      const body = await parseJsonOrThrow<{ path: string }>(local);
      return body.path;
    }
  }

  async removeRoot(token: string, id: string): Promise<void> {
    const response = await this.callFetch(`${this.url(COMPANION_ENDPOINTS.roots)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await parseJsonOrThrow<{ removed: boolean }>(response);
  }

  async executeTool(token: string, request: LocalToolRequest): Promise<LocalToolResult> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.toolsExecute), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Bridge-Nonce': newNonce(),
        'X-Bridge-Timestamp': new Date().toISOString(),
      },
      body: JSON.stringify(request),
    });
    return parseJsonOrThrow<LocalToolResult>(response);
  }

  async stopSession(token: string): Promise<void> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.sessionStop), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    await parseJsonOrThrow<{ stopped: boolean }>(response);
  }

  /** Loopback auto-pair (no OTP) — used from the one-click Start pipeline. */
  async autoPair(installationId: string, extensionOrigin: string): Promise<string> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.autoPair), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:32178',
      },
      body: JSON.stringify({ installationId, extensionOrigin }),
    });
    const body = await parseJsonOrThrow<{ token: string }>(response);
    return body.token;
  }

  async getPreferences(): Promise<{ defaultMode: string }> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.preferences), {
      headers: { Origin: 'http://127.0.0.1:32178' },
    });
    return parseJsonOrThrow<{ defaultMode: string }>(response);
  }

  async setPreferences(body: { defaultMode: string }): Promise<{ defaultMode: string }> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.preferences), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:32178',
      },
      body: JSON.stringify(body),
    });
    return parseJsonOrThrow<{ defaultMode: string }>(response);
  }

  async consumePendingStart(): Promise<{
    pending: boolean;
    mode?: string;
    rootAlias?: string;
    initialTask?: string;
    explore?: boolean;
    sessionId?: string;
    title?: string;
  }> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.pendingStartConsume), {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:32178' },
    });
    return parseJsonOrThrow(response);
  }

  async peekPendingStart(): Promise<{
    pending: boolean;
    mode?: string;
    rootAlias?: string;
    initialTask?: string;
    explore?: boolean;
    sessionId?: string;
    title?: string;
  }> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.pendingStart), {
      headers: { Origin: 'http://127.0.0.1:32178' },
    });
    return parseJsonOrThrow(response);
  }

  async extensionHeartbeat(installationId: string, extensionOrigin: string): Promise<void> {
    await this.callFetch(this.url(COMPANION_ENDPOINTS.extensionHeartbeat), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:32178',
      },
      body: JSON.stringify({ installationId, extensionOrigin }),
    });
  }

  async upsertChatSession(body: {
    chatId: string;
    title?: string;
    projectAlias?: string;
    mode?: string;
    copilotUrl?: string;
    rootAliases?: string[];
  }): Promise<void> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.chatSessions), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:32178',
      },
      body: JSON.stringify(body),
    });
    await parseJsonOrThrow(response);
  }

  async getChatSession(chatId: string): Promise<{
    chatId: string;
    title: string;
    projectAlias: string;
    mode: string;
    copilotUrl?: string;
    rootAliases: string[];
  } | null> {
    const response = await this.callFetch(
      `${this.url(COMPANION_ENDPOINTS.chatSessions)}/${encodeURIComponent(chatId)}`,
      { headers: { Origin: 'http://127.0.0.1:32178' } },
    );
    if (response.status === 404) return null;
    return parseJsonOrThrow(response);
  }

  async remapChatSession(fromChatId: string, toChatId: string): Promise<void> {
    await this.callFetch(`${this.url(COMPANION_ENDPOINTS.chatSessions)}/remap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:32178',
      },
      body: JSON.stringify({ fromChatId, toChatId }),
    });
  }
}
