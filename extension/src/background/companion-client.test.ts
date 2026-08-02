import { describe, expect, it, vi } from 'vitest';
import { BridgeApiError } from '../pairing/pairing-client';
import type { LocalToolRequest, LocalToolResult } from '../protocol/types';
import { CompanionClient } from './companion-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const REQUEST: LocalToolRequest = {
  protocolVersion: '1.0',
  type: 'LOCAL_TOOL_REQUEST',
  id: 'req-1',
  tool: 'project_info',
  arguments: {},
};

const RESULT: LocalToolResult = {
  protocolVersion: '1.0',
  type: 'LOCAL_TOOL_RESULT',
  requestId: 'req-1',
  success: true,
  tool: 'project_info',
  durationMs: 10,
  truncated: false,
  data: {},
  warnings: [],
};

describe('CompanionClient', () => {
  it('checks health without auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: 'ok', version: '0.1.0', docker: false, time: 'now' }),
      );
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    const health = await client.health();
    expect(health.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:32178/health');
  });

  it('sends a bearer token for status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          paired: true,
          version: '0.1.0',
          docker: false,
          primaryAlias: 'demo',
          roots: [],
        }),
      );
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    await client.getStatus('tok-1');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('attaches nonce, timestamp, bearer, and body when executing a tool', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(RESULT));
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });

    const result = await client.executeTool('tok-1', REQUEST);

    expect(result).toEqual(RESULT);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:32178/api/v1/tools/execute');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['X-Bridge-Nonce']).toBeTruthy();
    expect(headers['X-Bridge-Timestamp']).toBeTruthy();
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('uses a fresh nonce for every call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(RESULT));
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    await client.executeTool('tok-1', REQUEST);
    await client.executeTool('tok-1', REQUEST);
    const nonce1 = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const nonce2 = (fetchImpl.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(nonce1['X-Bridge-Nonce']).not.toBe(nonce2['X-Bridge-Nonce']);
  });

  it('throws BridgeApiError on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'unauthorized', message: 'Bearer token required.' } }, 401),
      );
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    await expect(client.getStatus('bad')).rejects.toBeInstanceOf(BridgeApiError);
  });

  it('stops the session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ stopped: true }));
    const client = new CompanionClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    await expect(client.stopSession('tok-1')).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:32178/api/v1/session/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
