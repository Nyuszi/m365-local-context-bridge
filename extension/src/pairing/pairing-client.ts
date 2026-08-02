import { COMPANION_ENDPOINTS, POLL_INTERVALS_MS } from '../config/defaults';

export interface PairingRequestResponse {
  id: string;
  expiresAt: string;
  message: string;
}

export interface PairingStatusResponse {
  id: string;
  approved: boolean;
  redeemed: boolean;
  expiresAt: string;
}

export class BridgeApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'BridgeApiError';
  }
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

export interface PairingClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin wrapper over the companion's unauthenticated pairing endpoints
 * (POST /pairing/request, GET /pairing/status/{id}, POST /pairing/redeem).
 * Holds no state of its own beyond the base URL — session/token persistence
 * is the caller's responsibility (see storage.ts).
 */
export class PairingClient {
  constructor(private readonly options: PairingClientOptions) {}

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

  async requestPairing(
    installationId: string,
    extensionOrigin: string,
  ): Promise<PairingRequestResponse> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.pairingRequest), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId, extensionOrigin }),
    });
    return parseJsonOrThrow<PairingRequestResponse>(response);
  }

  async getStatus(id: string): Promise<PairingStatusResponse> {
    const response = await this.callFetch(
      this.url(`${COMPANION_ENDPOINTS.pairingStatus}/${encodeURIComponent(id)}`),
    );
    return parseJsonOrThrow<PairingStatusResponse>(response);
  }

  async redeem(id: string, installationId: string, extensionOrigin: string): Promise<string> {
    const response = await this.callFetch(this.url(COMPANION_ENDPOINTS.pairingRedeem), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, installationId, extensionOrigin }),
    });
    const { token } = await parseJsonOrThrow<{ token: string }>(response);
    return token;
  }
}

export type PairingPollStatus = 'pending' | 'approved' | 'expired';

export interface PollForApprovalOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStatus?: (status: PairingStatusResponse) => void;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls GET /pairing/status/{id} until the local management UI approves the
 * request (or it expires / the caller aborts). Never redeems on its own —
 * the caller decides when to call `redeem` once this resolves as approved.
 */
export async function pollForApproval(
  client: PairingClient,
  id: string,
  options: PollForApprovalOptions = {},
): Promise<PairingPollStatus> {
  const intervalMs = options.intervalMs ?? POLL_INTERVALS_MS.pairing;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (options.signal?.aborted) return 'pending';

    const status = await client.getStatus(id);
    options.onStatus?.(status);

    if (status.approved) return 'approved';
    if (new Date(status.expiresAt).getTime() <= Date.now()) return 'expired';
    if (Date.now() >= deadline) return 'expired';

    await sleep(intervalMs);
  }
}

export interface CompletePairingResult {
  token: string;
  extensionOrigin: string;
  installationId: string;
}

/**
 * End-to-end pairing flow: request -> wait for local approval -> redeem.
 * The one-time token returned by redeem is handed back exactly once; it is
 * the caller's job to store it (see storage.setPairing) immediately.
 */
export async function completePairing(
  client: PairingClient,
  installationId: string,
  extensionOrigin: string,
  pollOptions: PollForApprovalOptions = {},
): Promise<CompletePairingResult> {
  const requested = await client.requestPairing(installationId, extensionOrigin);
  const outcome = await pollForApproval(client, requested.id, pollOptions);

  if (outcome === 'expired') {
    throw new BridgeApiError(
      'pairing_expired',
      'Pairing request expired before it was approved.',
      408,
    );
  }

  const token = await client.redeem(requested.id, installationId, extensionOrigin);
  return { token, extensionOrigin, installationId };
}
