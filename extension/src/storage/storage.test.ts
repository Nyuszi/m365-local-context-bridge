import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../config/defaults';
import {
  clearTabDismissal,
  getInstallationId,
  getPairing,
  getSessionSnapshot,
  getSettings,
  getTabDismissal,
  setPairing,
  setSessionSnapshot,
  setTabDismissal,
  updateSettings,
} from './storage';

describe('getSettings / updateSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a partial update and merges it with existing settings', async () => {
    await updateSettings({ mode: 'automatic' });
    const settings = await getSettings();
    expect(settings.mode).toBe('automatic');
    expect(settings.companionBaseUrl).toBe(DEFAULT_SETTINGS.companionBaseUrl);
  });

  it('falls back to defaults for invalid values instead of throwing', async () => {
    await updateSettings({ mode: 'bogus' as never });
    expect((await getSettings()).mode).toBe(DEFAULT_SETTINGS.mode);
  });
});

describe('getInstallationId', () => {
  it('generates and persists an id on first access', async () => {
    const id = await getInstallationId();
    expect(id.length).toBeGreaterThan(0);
    expect(await getInstallationId()).toBe(id);
  });
});

describe('pairing record', () => {
  it('returns null when nothing is paired', async () => {
    expect(await getPairing()).toBeNull();
  });

  it('round-trips a pairing record', async () => {
    const record = {
      token: 'tok-1',
      installationId: 'inst-1',
      extensionOrigin: 'chrome-extension://abc',
      pairedAt: 123,
    };
    await setPairing(record);
    expect(await getPairing()).toEqual(record);
  });

  it('clears the pairing record when set to null', async () => {
    await setPairing({ token: 't', installationId: 'i', extensionOrigin: 'o', pairedAt: 1 });
    await setPairing(null);
    expect(await getPairing()).toBeNull();
  });

  it('ignores a malformed stored record', async () => {
    await chrome.storage.local.set({ pairing: { token: 'only-token' } });
    expect(await getPairing()).toBeNull();
  });
});

describe('session snapshot', () => {
  it('returns null when there is no active session', async () => {
    expect(await getSessionSnapshot()).toBeNull();
  });

  it('round-trips a session snapshot', async () => {
    const state = {
      status: 'active' as const,
      mode: 'assisted' as const,
      conversationId: 'conv-1',
      tabId: 5,
      projectAlias: 'demo',
      startedAt: 1,
      lastActivityAt: 2,
      iterationCount: 1,
      lastStopReason: null,
    };
    await setSessionSnapshot(state);
    expect(await getSessionSnapshot()).toEqual(state);
  });
});

describe('tab dismissals', () => {
  it('returns null when a tab has no dismissal recorded', async () => {
    expect(await getTabDismissal(1)).toBeNull();
  });

  it('records and reads back a dismissal', async () => {
    await setTabDismissal(7, 'never', 1000);
    expect(await getTabDismissal(7, 1000)).toEqual({ kind: 'never', at: 1000 });
  });

  it('expires a "not-now" dismissal after its TTL', async () => {
    await setTabDismissal(7, 'not-now', 0);
    expect(await getTabDismissal(7, 10)).toEqual({ kind: 'not-now', at: 0 });
    expect(await getTabDismissal(7, 31 * 60_000)).toBeNull();
  });

  it('never expires a "never" dismissal', async () => {
    await setTabDismissal(7, 'never', 0);
    expect(await getTabDismissal(7, 10 ** 9)).toEqual({ kind: 'never', at: 0 });
  });

  it('clears a dismissal', async () => {
    await setTabDismissal(7, 'never');
    await clearTabDismissal(7);
    expect(await getTabDismissal(7)).toBeNull();
  });

  it('keeps dismissals for different tabs independent', async () => {
    await setTabDismissal(1, 'never', 0);
    await setTabDismissal(2, 'not-now', 0);
    expect((await getTabDismissal(1, 0))?.kind).toBe('never');
    expect((await getTabDismissal(2, 0))?.kind).toBe('not-now');
  });
});
