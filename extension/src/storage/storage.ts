import { DEFAULT_SETTINGS } from '../config/defaults';
import { isSessionMode, type SessionMode } from '../session/modes';
import type { SessionState } from '../session/session-manager';

export interface StoredSettings {
  companionBaseUrl: string;
  mode: SessionMode;
  copilotEnabled: boolean;
  suggestOnCopilotOpen: boolean;
  /** On-page LCB debug log panel (hidden by default). */
  showDeveloperLogs: boolean;
}

export interface PairingRecord {
  token: string;
  installationId: string;
  extensionOrigin: string;
  pairedAt: number;
}

export type TabDismissalKind = 'not-now' | 'never';

export interface TabDismissal {
  kind: TabDismissalKind;
  at: number;
}

const LOCAL_KEYS = {
  settings: 'settings',
  installationId: 'installationId',
  pairing: 'pairing',
} as const;

const SESSION_KEYS = {
  sessionState: 'sessionState',
  dismissedTabs: 'dismissedTabs',
  pendingPickedPath: 'pendingPickedPath',
} as const;

/** "Not now" dismissals expire on their own so the prompt can resurface later. */
const NOT_NOW_TTL_MS = 30 * 60_000;

function normalizeSettings(raw: unknown): StoredSettings {
  const partial = (raw && typeof raw === 'object' ? raw : {}) as Partial<StoredSettings>;
  return {
    companionBaseUrl:
      typeof partial.companionBaseUrl === 'string' && partial.companionBaseUrl.length > 0
        ? partial.companionBaseUrl
        : DEFAULT_SETTINGS.companionBaseUrl,
    mode: isSessionMode(partial.mode) ? partial.mode : DEFAULT_SETTINGS.mode,
    copilotEnabled:
      typeof partial.copilotEnabled === 'boolean'
        ? partial.copilotEnabled
        : DEFAULT_SETTINGS.copilotEnabled,
    suggestOnCopilotOpen:
      typeof partial.suggestOnCopilotOpen === 'boolean'
        ? partial.suggestOnCopilotOpen
        : DEFAULT_SETTINGS.suggestOnCopilotOpen,
    showDeveloperLogs:
      typeof partial.showDeveloperLogs === 'boolean'
        ? partial.showDeveloperLogs
        : DEFAULT_SETTINGS.showDeveloperLogs,
  };
}

export async function getSettings(): Promise<StoredSettings> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.settings);
  return normalizeSettings(stored[LOCAL_KEYS.settings]);
}

export async function updateSettings(patch: Partial<StoredSettings>): Promise<StoredSettings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [LOCAL_KEYS.settings]: next });
  return next;
}

/** Stable per-install identifier sent to the companion during pairing. Generated once, never rotated. */
export async function getInstallationId(): Promise<string> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.installationId);
  const existing: unknown = stored[LOCAL_KEYS.installationId];
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [LOCAL_KEYS.installationId]: id });
  return id;
}

function isPairingRecord(value: unknown): value is PairingRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<PairingRecord>;
  return (
    typeof r.token === 'string' &&
    typeof r.installationId === 'string' &&
    typeof r.extensionOrigin === 'string'
  );
}

export async function getPairing(): Promise<PairingRecord | null> {
  const stored = await chrome.storage.local.get(LOCAL_KEYS.pairing);
  const record: unknown = stored[LOCAL_KEYS.pairing];
  if (!isPairingRecord(record)) return null;
  return {
    token: record.token,
    installationId: record.installationId,
    extensionOrigin: record.extensionOrigin,
    pairedAt: typeof record.pairedAt === 'number' ? record.pairedAt : Date.now(),
  };
}

export async function setPairing(record: PairingRecord | null): Promise<void> {
  if (record === null) {
    await chrome.storage.local.remove(LOCAL_KEYS.pairing);
    return;
  }
  await chrome.storage.local.set({ [LOCAL_KEYS.pairing]: record });
}

/**
 * Session state is kept in chrome.storage.session (cleared when the browser
 * fully closes) rather than .local, since a session is inherently tied to a
 * single browser run / open tab and should never silently resurrect itself
 * days later after a service-worker restart.
 */
export async function getSessionSnapshot(): Promise<SessionState | null> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.sessionState);
  const state: unknown = stored[SESSION_KEYS.sessionState];
  return (state as SessionState | undefined) ?? null;
}

export async function setSessionSnapshot(state: SessionState | null): Promise<void> {
  if (state === null) {
    await chrome.storage.session.remove(SESSION_KEYS.sessionState);
    return;
  }
  await chrome.storage.session.set({ [SESSION_KEYS.sessionState]: state });
}

type DismissalMap = Record<string, TabDismissal>;

async function getDismissalMap(): Promise<DismissalMap> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.dismissedTabs);
  const map: unknown = stored[SESSION_KEYS.dismissedTabs];
  return map && typeof map === 'object' ? (map as DismissalMap) : {};
}

export async function getTabDismissal(
  tabId: number,
  now: number = Date.now(),
): Promise<TabDismissal | null> {
  const map = await getDismissalMap();
  const entry = map[String(tabId)];
  if (!entry) return null;
  if (entry.kind === 'not-now' && now - entry.at > NOT_NOW_TTL_MS) return null;
  return entry;
}

export async function setTabDismissal(
  tabId: number,
  kind: TabDismissalKind,
  now: number = Date.now(),
): Promise<void> {
  const map = await getDismissalMap();
  map[String(tabId)] = { kind, at: now };
  await chrome.storage.session.set({ [SESSION_KEYS.dismissedTabs]: map });
}

export async function clearTabDismissal(tabId: number): Promise<void> {
  const map = await getDismissalMap();
  if (!(String(tabId) in map)) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [SESSION_KEYS.dismissedTabs]: map });
}

/** Path selected via native picker while the popup may have closed. */
export async function setPendingPickedPath(path: string | null): Promise<void> {
  if (path === null) {
    await chrome.storage.session.remove(SESSION_KEYS.pendingPickedPath);
    return;
  }
  await chrome.storage.session.set({ [SESSION_KEYS.pendingPickedPath]: path });
}

export async function getPendingPickedPath(): Promise<string | null> {
  const stored = await chrome.storage.session.get(SESSION_KEYS.pendingPickedPath);
  const value: unknown = stored[SESSION_KEYS.pendingPickedPath];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
