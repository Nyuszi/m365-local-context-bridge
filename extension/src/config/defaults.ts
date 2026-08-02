import type { SessionMode } from '../session/modes';

/** Mirrors /schemas/limits.json. Keep in sync with the companion's own defaults. */
export const PROTOCOL_LIMITS = {
  /** 0 = unlimited tool calls per session. */
  maxIterations: 0,
  /** 0 = no session wall-clock timeout. */
  maxSessionMinutes: 0,
  maxRequestBytes: 32768,
  maxResultBytes: 131072,
  maxReadLines: 300,
  maxTextFileBytes: 2_097_152,
  maxSearchFiles: 5000,
  maxSearchResults: 100,
  maxConcurrentRequests: 1,
  /** Per-tool hang protection only — not a session timeout. */
  toolTimeoutSeconds: 60,
  minCallIntervalMs: 500,
  messageStableMs: 1500,
} as const;

export const DEFAULT_COMPANION_BASE_URL = 'http://127.0.0.1:32178';

export const DEFAULT_MOCK_CHAT_ORIGIN = 'http://127.0.0.1:32178';
export const DEFAULT_MOCK_CHAT_PATH_PREFIX = '/mock-chat';

export const DEFAULT_COPILOT_ORIGINS = [
  'https://m365.cloud.microsoft/*',
  'https://copilot.microsoft.com/*',
] as const;

export const DEFAULT_SESSION_MODE: SessionMode = 'assisted';

export const DEFAULT_SETTINGS = {
  companionBaseUrl: DEFAULT_COMPANION_BASE_URL,
  mode: DEFAULT_SESSION_MODE,
  copilotEnabled: false,
  suggestOnCopilotOpen: true,
  showDeveloperLogs: false,
};

/** Endpoint paths on the companion HTTP API. */
export const COMPANION_ENDPOINTS = {
  health: '/health',
  status: '/api/v1/status',
  pairingRequest: '/pairing/request',
  pairingStatus: '/pairing/status',
  pairingRedeem: '/pairing/redeem',
  toolsExecute: '/api/v1/tools/execute',
  sessionStop: '/api/v1/session/stop',
  roots: '/api/v1/roots',
  pickFolder: '/api/v1/roots/pick-folder',
  pickFolderLocal: '/api/v1/local/pick-folder',
  autoPair: '/api/v1/local/auto-pair',
  preferences: '/api/v1/local/preferences',
  pendingStartConsume: '/api/v1/local/pending-start/consume',
  pendingStart: '/api/v1/local/pending-start',
  extensionHeartbeat: '/api/v1/local/extension-heartbeat',
  chatSessions: '/api/v1/local/chat-sessions',
  mockChat: '/mock-chat',
} as const;

export const COPILOT_CHAT_URL = 'https://m365.cloud.microsoft/chat';

export const POLL_INTERVALS_MS = {
  status: 5_000,
  pairing: 1_500,
} as const;
