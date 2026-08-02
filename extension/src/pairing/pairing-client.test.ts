import { describe, expect, it, vi } from 'vitest';
import { BridgeApiError, completePairing, PairingClient, pollForApproval } from './pairing-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PairingClient', () => {
  it('sends installationId and extensionOrigin when requesting pairing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: 'req-1', expiresAt: '2099-01-01T00:00:00Z', message: 'ok' }),
      );
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });

    const result = await client.requestPairing('install-1', 'chrome-extension://abc');

    expect(result.id).toBe('req-1');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:32178/pairing/request',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      installationId: 'install-1',
      extensionOrigin: 'chrome-extension://abc',
    });
  });

  it('strips trailing slashes from the base URL', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: '1', approved: false, redeemed: false, expiresAt: '' }),
      );
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178/', fetchImpl });
    await client.getStatus('1');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:32178/pairing/status/1');
  });

  it('throws a BridgeApiError with the companion error envelope on failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'not_found',
              message: 'Pairing request not found.',
              correlationId: 'abc',
            },
          },
          404,
        ),
      );
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });

    await expect(client.getStatus('missing')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      correlationId: 'abc',
    });
  });

  it('redeem returns the one-time token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: 'secret-token' }));
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    const token = await client.redeem('req-1', 'install-1', 'chrome-extension://abc');
    expect(token).toBe('secret-token');
  });

  it('surfaces a generic error when the failure body is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('oops', { status: 500 }));
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });
    await expect(client.getStatus('x')).rejects.toBeInstanceOf(BridgeApiError);
  });
});

describe('pollForApproval', () => {
  it('resolves "approved" as soon as the status flips to approved', async () => {
    const client = new PairingClient({ baseUrl: 'http://x', fetchImpl: vi.fn() });
    const statuses = [
      { id: '1', approved: false, redeemed: false, expiresAt: '2099-01-01T00:00:00Z' },
      { id: '1', approved: true, redeemed: false, expiresAt: '2099-01-01T00:00:00Z' },
    ];
    vi.spyOn(client, 'getStatus').mockImplementation(async () => statuses.shift()!);

    const outcome = await pollForApproval(client, '1', {
      sleep: () => Promise.resolve(),
      intervalMs: 1,
    });
    expect(outcome).toBe('approved');
  });

  it('resolves "expired" once the expiresAt timestamp has passed', async () => {
    const client = new PairingClient({ baseUrl: 'http://x', fetchImpl: vi.fn() });
    vi.spyOn(client, 'getStatus').mockResolvedValue({
      id: '1',
      approved: false,
      redeemed: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const outcome = await pollForApproval(client, '1', {
      sleep: () => Promise.resolve(),
      intervalMs: 1,
    });
    expect(outcome).toBe('expired');
  });

  it('calls onStatus for every poll', async () => {
    const client = new PairingClient({ baseUrl: 'http://x', fetchImpl: vi.fn() });
    vi.spyOn(client, 'getStatus').mockResolvedValue({
      id: '1',
      approved: true,
      redeemed: false,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    const onStatus = vi.fn();
    await pollForApproval(client, '1', { sleep: () => Promise.resolve(), onStatus });
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});

describe('completePairing', () => {
  it('requests, polls, and redeems in sequence', async () => {
    const fetchImpl = vi.fn();
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl });

    vi.spyOn(client, 'requestPairing').mockResolvedValue({
      id: 'req-1',
      expiresAt: '2099-01-01T00:00:00Z',
      message: 'ok',
    });
    const redeemSpy = vi.spyOn(client, 'redeem').mockResolvedValue('token-xyz');
    const statuses = [
      { id: 'req-1', approved: false, redeemed: false, expiresAt: '2099-01-01T00:00:00Z' },
      { id: 'req-1', approved: true, redeemed: false, expiresAt: '2099-01-01T00:00:00Z' },
    ];
    vi.spyOn(client, 'getStatus').mockImplementation(async () => statuses.shift()!);

    const result = await completePairing(client, 'install-1', 'chrome-extension://abc', {
      sleep: () => Promise.resolve(),
    });

    expect(result).toEqual({
      token: 'token-xyz',
      extensionOrigin: 'chrome-extension://abc',
      installationId: 'install-1',
    });
    expect(redeemSpy).toHaveBeenCalledWith('req-1', 'install-1', 'chrome-extension://abc');
  });

  it('throws instead of redeeming when the request expires unapproved', async () => {
    const client = new PairingClient({ baseUrl: 'http://127.0.0.1:32178', fetchImpl: vi.fn() });
    vi.spyOn(client, 'requestPairing').mockResolvedValue({
      id: 'req-1',
      expiresAt: '2099-01-01T00:00:00Z',
      message: 'ok',
    });
    vi.spyOn(client, 'getStatus').mockResolvedValue({
      id: 'req-1',
      approved: false,
      redeemed: false,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    const redeemSpy = vi.spyOn(client, 'redeem');

    await expect(
      completePairing(client, 'install-1', 'chrome-extension://abc', {
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow('Pairing request expired');
    expect(redeemSpy).not.toHaveBeenCalled();
  });
});
