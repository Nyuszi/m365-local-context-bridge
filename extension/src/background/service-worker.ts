import { MIN_USABLE_CONFIDENCE } from '../adapters/types';
import {
  buildCopilotConversationUrl,
  extractCopilotConversationId,
} from '../adapters/copilot-chat-adapter';
import { PROTOCOL_LIMITS } from '../config/defaults';
import { BridgeApiError, completePairing, PairingClient } from '../pairing/pairing-client';
import { DEFAULT_EXPLORE_TASK, generateBootstrapMessage } from '../protocol/bootstrap';
import { nativeHostInstallCommand, sendNativeHost } from './native-host';
import { fingerprintRequest, SeenRequestTracker } from '../protocol/hash';
import type { LocalToolRequest } from '../protocol/types';
import { getModeBehavior, type SessionMode } from '../session/modes';
import { SessionManager, type SessionStopReason } from '../session/session-manager';
import {
  clearTabDismissal,
  getInstallationId,
  getPairing,
  getPendingPickedPath,
  getSessionSnapshot,
  getSettings,
  getTabDismissal,
  setPairing,
  setPendingPickedPath,
  setSessionSnapshot,
  setTabDismissal,
  updateSettings,
} from '../storage/storage';
import { CompanionClient, type CompanionStatusRoot } from './companion-client';
import {
  isContentToBackgroundMessage,
  isUiToBackgroundMessage,
  type BackgroundBroadcast,
  type BackgroundToContentMessage,
  type CompanionHealthSummary,
  type ContentToBackgroundMessage,
  type PopupStateSnapshot,
  type UiToBackgroundMessage,
} from './messages';

const SESSION_LIMITS = {
  maxIterations: PROTOCOL_LIMITS.maxIterations,
  maxSessionMinutes: PROTOCOL_LIMITS.maxSessionMinutes,
};

const sessionManager = new SessionManager('assisted');
const seenRequests = new SeenRequestTracker();
const pendingCalls = new Map<
  string,
  { request: LocalToolRequest; tabId: number; fingerprint: string }
>();
/** Request ids currently executing — blocks double-fire while pendingCalls was cleared. */
const inFlightCalls = new Set<string>();
/** requestId → fingerprint for results already sent to the tab (insert may still fail). */
const deliveredFingerprints = new Map<string, string>();
/** Prevents two parallel desktop-START consumers from both pasting bootstrap. */
let pendingStartClaim: Promise<boolean> | null = null;
const detectedTabs = new Map<
  number,
  { adapterId: string; confidence: number; url: string; frameId: number; hasComposer: boolean }
>();

let hydrated: Promise<void> | null = null;
function ensureHydrated(): Promise<void> {
  hydrated ??= (async () => {
    const snapshot = await getSessionSnapshot();
    if (snapshot) sessionManager.restore(snapshot);
    const settings = await getSettings();
    if (sessionManager.getState().status === 'idle') sessionManager.setMode(settings.mode);
  })();
  return hydrated;
}

async function persistSession(): Promise<void> {
  const state = sessionManager.getState();
  await setSessionSnapshot(state.status === 'idle' ? null : state);
}

async function getCompanionClient(): Promise<CompanionClient> {
  const settings = await getSettings();
  return new CompanionClient({ baseUrl: settings.companionBaseUrl });
}

async function getPairingClient(): Promise<PairingClient> {
  const settings = await getSettings();
  return new PairingClient({ baseUrl: settings.companionBaseUrl });
}

async function safeSendToTab(
  tabId: number,
  message: BackgroundToContentMessage,
  frameId?: number,
): Promise<void> {
  const send = (targetFrameId?: number) =>
    targetFrameId === undefined
      ? chrome.tabs.sendMessage(tabId, message)
      : chrome.tabs.sendMessage(tabId, message, { frameId: targetFrameId });

  const preferred = frameId ?? detectedTabs.get(tabId)?.frameId;
  if (preferred !== undefined) {
    try {
      await send(preferred);
      return;
    } catch {
      // Preferred frame may have navigated; fall through to fan-out.
    }
  }

  try {
    await send();
  } catch {
    // Main frame may not host the chat UI.
  }

  // Copilot Chat often mounts the composer inside an iframe. Fan-out so the
  // frame that actually has the adapter can handle session/tool messages.
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true,
    });
    await Promise.all(
      (frames ?? []).map((frame) => send(frame.frameId).catch(() => undefined)),
    );
  } catch {
    // Missing host permission or restricted page; not fatal.
  }
}

function broadcast(message: BackgroundBroadcast): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // No popup/options page is listening right now; that's fine.
  });
}

async function checkHealth(): Promise<CompanionHealthSummary> {
  try {
    const companion = await getCompanionClient();
    const health = await companion.health();
    return { reachable: true, version: health.version, docker: health.docker };
  } catch {
    return { reachable: false };
  }
}

async function buildStateSnapshot(): Promise<PopupStateSnapshot> {
  await ensureHydrated();
  const [settings, installationId, pairing, health, pendingPickedPath] = await Promise.all([
    getSettings(),
    getInstallationId(),
    getPairing(),
    checkHealth(),
    getPendingPickedPath(),
  ]);

  let paired = false;
  let primaryAlias: string | null = null;
  let homePath: string | null = null;
  let roots: CompanionStatusRoot[] = [];
  let effectiveSettings = settings;

  if (pairing) {
    try {
      const companion = await getCompanionClient();
      const status = await companion.getStatus(pairing.token);
      paired = status.paired;
      primaryAlias = status.primaryAlias;
      homePath = status.homePath ?? null;
      roots = status.roots;
      if (
        status.defaultMode === 'manual' ||
        status.defaultMode === 'assisted' ||
        status.defaultMode === 'automatic'
      ) {
        if (status.defaultMode !== settings.mode) {
          effectiveSettings = await updateSettings({ mode: status.defaultMode });
          if (sessionManager.getState().status === 'idle') {
            sessionManager.setMode(status.defaultMode);
          }
        }
      }
    } catch {
      paired = false;
    }
  } else if (health.reachable) {
    try {
      const prefs = await (await getCompanionClient()).getPreferences();
      if (
        prefs.defaultMode === 'manual' ||
        prefs.defaultMode === 'assisted' ||
        prefs.defaultMode === 'automatic'
      ) {
        if (prefs.defaultMode !== settings.mode) {
          effectiveSettings = await updateSettings({ mode: prefs.defaultMode });
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    settings: effectiveSettings,
    paired,
    primaryAlias,
    homePath,
    roots,
    session: sessionManager.getState(),
    health,
    installationId,
    pendingPickedPath,
  };
}

async function runPairingFlow(): Promise<void> {
  broadcast({
    type: 'broadcast/pairing-progress',
    progress: { status: 'requesting', message: 'Connecting to companion…' },
  });
  try {
    const installationId = await getInstallationId();
    const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;

    // Prefer loopback auto-pair (one click). Fall back to OTP /local approval.
    try {
      const companion = await getCompanionClient();
      const token = await companion.autoPair(installationId, extensionOrigin);
      await setPairing({
        token,
        installationId,
        extensionOrigin,
        pairedAt: Date.now(),
      });
      broadcast({
        type: 'broadcast/pairing-progress',
        progress: { status: 'done', message: 'Paired successfully.' },
      });
      broadcast({ type: 'broadcast/state-changed' });
      return;
    } catch {
      /* fall through */
    }

    const client = await getPairingClient();
    broadcast({
      type: 'broadcast/pairing-progress',
      progress: {
        status: 'awaiting-approval',
        message: 'Approve this request at http://127.0.0.1:32178/local',
      },
    });

    const result = await completePairing(client, installationId, extensionOrigin);

    broadcast({
      type: 'broadcast/pairing-progress',
      progress: { status: 'redeeming', message: 'Finalizing pairing…' },
    });
    await setPairing({
      token: result.token,
      installationId,
      extensionOrigin,
      pairedAt: Date.now(),
    });
    broadcast({
      type: 'broadcast/pairing-progress',
      progress: { status: 'done', message: 'Paired successfully.' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pairing failed.';
    broadcast({ type: 'broadcast/pairing-progress', progress: { status: 'error', message } });
  }
  broadcast({ type: 'broadcast/state-changed' });
}

async function stopSessionInternal(
  reason: SessionStopReason,
  tabIdOverride?: number,
): Promise<void> {
  const previousTabId = tabIdOverride ?? sessionManager.getState().tabId;
  const pairing = await getPairing();

  sessionManager.stop(reason);
  await persistSession();
  pendingCalls.clear();

  if (pairing) {
    try {
      const companion = await getCompanionClient();
      await companion.stopSession(pairing.token);
    } catch {
      // Best-effort: the local session state is already stopped either way.
    }
  }

  if (previousTabId !== null) {
    await safeSendToTab(previousTabId, { type: 'bc/session-stopped', reason });
  }

  if (reason === 'max-iterations' || reason === 'session-expired') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Local Context Bridge — session stopped',
      message:
        reason === 'max-iterations'
          ? 'Reached the maximum number of tool calls for this session.'
          : 'Reached the session time limit.',
    });
  }

  broadcast({ type: 'broadcast/state-changed' });
}

async function startSessionForTab(
  tabId: number,
  projectAlias: string,
  mode?: SessionMode,
  initialTask?: string,
  chatId?: string,
  preferredTitle?: string,
): Promise<ReturnType<SessionManager['getState']>> {
  const settings = await getSettings();
  const pairing = await getPairing();
  if (!pairing) {
    throw new Error('Not paired with the companion yet.');
  }

  const effectiveMode = mode ?? settings.mode;
  const conversationId = chatId?.trim() || `bridge-${crypto.randomUUID()}`;
  const sessionTime = formatSessionTime(new Date());
  const chatTitle =
    preferredTitle?.trim() || `${sanitizeTitlePart(projectAlias)}-${sessionTime}`;
  const bootstrapMessage = generateBootstrapMessage({
    projectAlias,
    initialTask: initialTask?.trim() ? initialTask : undefined,
    limits: {
      maxIterations: PROTOCOL_LIMITS.maxIterations,
      maxSessionMinutes: PROTOCOL_LIMITS.maxSessionMinutes,
      toolTimeoutSeconds: PROTOCOL_LIMITS.toolTimeoutSeconds,
    },
  });

  const state = sessionManager.start({ conversationId, tabId, projectAlias, mode: effectiveMode });
  await persistSession();
  seenRequests.clear();
  pendingCalls.clear();
  inFlightCalls.clear();
  await clearTabDismissal(tabId);

  try {
    const companion = await getCompanionClient();
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const tabUrl = tab?.url || '';
    const liveChatId = extractCopilotConversationId(tabUrl);
    await companion.upsertChatSession({
      chatId: conversationId,
      title: chatTitle,
      projectAlias,
      mode: effectiveMode,
      copilotUrl: liveChatId
        ? buildCopilotConversationUrl(liveChatId, tabUrl)
        : undefined,
      rootAliases: [projectAlias],
    });
  } catch (err) {
    console.error('[local-context-bridge] failed to persist chat session', err);
  }

  await safeSendToTab(tabId, {
    type: 'bc/session-started',
    conversationId,
    mode: effectiveMode,
    projectAlias,
    bootstrapMessage,
    chatTitle,
  });
  await safeSendToTab(tabId, {
    type: 'bc/debug',
    level: 'ok',
    message: `background: session active on tab=${tabId} mode=${effectiveMode} title=${chatTitle}`,
  });

  broadcast({ type: 'broadcast/state-changed' });
  void sendExtensionHeartbeat();
  void closeSetupTabs();
  return state;
}

function formatSessionTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function sanitizeTitlePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCompanionHealthy(timeoutMs = 10_000): Promise<boolean> {
  const companion = await getCompanionClient();
  try {
    await companion.health();
    return true;
  } catch {
    /* try native start */
  }
  const started = await sendNativeHost({ action: 'start' });
  if (!started?.ok && !started?.reachable) {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await companion.health();
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

async function ensurePaired(): Promise<string> {
  const existing = await getPairing();
  if (existing?.token) {
    try {
      const companion = await getCompanionClient();
      await companion.getStatus(existing.token);
      return existing.token;
    } catch {
      // Token invalid — fall through to auto-pair.
    }
  }

  const installationId = await getInstallationId();
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  const companion = await getCompanionClient();
  const token = await companion.autoPair(installationId, extensionOrigin);
  await setPairing({
    token,
    extensionOrigin,
    installationId,
    pairedAt: Date.now(),
  });
  broadcast({ type: 'broadcast/state-changed' });
  return token;
}

async function syncModeFromCompanion(): Promise<SessionMode> {
  try {
    const companion = await getCompanionClient();
    const prefs = await companion.getPreferences();
    const mode = (prefs.defaultMode as SessionMode) || 'assisted';
    if (mode === 'manual' || mode === 'assisted' || mode === 'automatic') {
      await updateSettings({ mode });
      if (sessionManager.getState().status === 'idle') sessionManager.setMode(mode);
      return mode;
    }
  } catch {
    /* keep local */
  }
  const settings = await getSettings();
  return settings.mode;
}

async function pushModeToCompanion(mode: SessionMode): Promise<void> {
  try {
    const companion = await getCompanionClient();
    await companion.setPreferences({ defaultMode: mode });
  } catch {
    /* companion may be down */
  }
}

async function sendExtensionHeartbeat(): Promise<void> {
  try {
    const companion = await getCompanionClient();
    await companion.health();
    const installationId = await getInstallationId();
    const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
    await companion.extensionHeartbeat(installationId, extensionOrigin);
  } catch {
    /* companion offline */
  }
}

async function closeSetupTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://127.0.0.1:32178/setup*', 'http://localhost:32178/setup*'] });
    await Promise.all(
      tabs
        .filter((t) => typeof t.id === 'number')
        .map((t) => chrome.tabs.remove(t.id!).catch(() => undefined)),
    );
  } catch {
    /* ignore */
  }
}

async function onChatChanged(
  tabId: number,
  chatId: string,
  url: string,
  title?: string,
): Promise<void> {
  const companion = await getCompanionClient();
  try {
    await companion.health();
  } catch {
    return;
  }

  const current = sessionManager.getState();
  const deepLink = buildCopilotConversationUrl(chatId, url);
  const onActiveTab = current.status === 'active' && current.tabId === tabId;
  const provisional =
    onActiveTab &&
    (!current.conversationId || current.conversationId.startsWith('bridge-'));

  // Bootstrap: provisional bridge-* → real Copilot id.
  if (onActiveTab && provisional && current.conversationId && current.conversationId !== chatId) {
    try {
      await companion.remapChatSession(current.conversationId, chatId);
    } catch {
      /* may already be remapped */
    }
    sessionManager.setConversationId(chatId);
    await persistSession();
  }

  let existing = await companion.getChatSession(chatId).catch(() => null);

  // Opening a previously saved chat (from Bridge.app Open) — resume quietly, no Start prompt / bootstrap.
  if (existing && !onActiveTab) {
    const mode =
      existing.mode === 'manual' || existing.mode === 'assisted' || existing.mode === 'automatic'
        ? existing.mode
        : 'assisted';
    const alias = existing.projectAlias || 'project';
    await resumeSessionForTab(tabId, {
      chatId,
      projectAlias: alias,
      mode,
      title: title || existing.title,
      url,
      rootAliases: existing.rootAliases,
    });
    return;
  }

  // User switched to a different saved chat while a session was active.
  if (onActiveTab && !provisional && current.conversationId && current.conversationId !== chatId) {
    if (existing) {
      const mode =
        existing.mode === 'manual' || existing.mode === 'assisted' || existing.mode === 'automatic'
          ? existing.mode
          : 'assisted';
      const alias = existing.projectAlias || current.projectAlias || 'project';
      await updateSettings({ mode });
      await pushModeToCompanion(mode);
      sessionManager.setMode(mode);
      if (alias) sessionManager.setProjectAlias(alias);
      sessionManager.setConversationId(chatId);
      await persistSession();
      await companion.upsertChatSession({
        chatId,
        title: title || existing.title,
        projectAlias: alias,
        mode,
        copilotUrl: deepLink,
        rootAliases: existing.rootAliases?.length ? existing.rootAliases : [alias],
      });
      await safeSendToTab(tabId, { type: 'bc/hide-detection-prompt' });
      await safeSendToTab(tabId, {
        type: 'bc/session-resumed',
        conversationId: chatId,
        mode,
        projectAlias: alias,
      });
      await safeSendToTab(tabId, {
        type: 'bc/debug',
        level: 'ok',
        message: `chat switched → mode=${mode} alias=${alias}`,
      });
      broadcast({ type: 'broadcast/state-changed' });
      return;
    }
    await stopSessionInternal('user', tabId);
    await maybeShowDetectionPrompt(tabId, 'copilot', 1);
    return;
  }

  const mode =
    existing?.mode === 'manual' || existing?.mode === 'assisted' || existing?.mode === 'automatic'
      ? existing.mode
      : onActiveTab
        ? current.mode
        : 'assisted';
  const alias =
    existing?.projectAlias || (onActiveTab ? current.projectAlias : null) || 'project';

  if (onActiveTab) {
    await updateSettings({ mode });
    await pushModeToCompanion(mode);
    sessionManager.setMode(mode);
    if (alias) sessionManager.setProjectAlias(alias);
    sessionManager.setConversationId(chatId);
    await persistSession();
  }

  const preferredTitle =
    title && !/^#+\s*Local Context Bridge/i.test(title) && !/Read-only local tools/i.test(title)
      ? title
      : existing?.title || (alias ? `${sanitizeTitlePart(alias)}-session` : undefined);

  await companion.upsertChatSession({
    chatId,
    title: preferredTitle,
    projectAlias: alias,
    mode,
    copilotUrl: deepLink,
    rootAliases: existing?.rootAliases?.length ? existing.rootAliases : [alias],
  });

  await safeSendToTab(tabId, {
    type: 'bc/debug',
    level: 'ok',
    message: `chat link bound → ${chatId}`,
  });
  broadcast({ type: 'broadcast/state-changed' });
}

async function resumeSessionForTab(
  tabId: number,
  opts: {
    chatId: string;
    projectAlias: string;
    mode: SessionMode;
    title?: string;
    url: string;
    rootAliases?: string[];
  },
): Promise<boolean> {
  const pairing = await getPairing();
  if (!pairing) return false;

  const current = sessionManager.getState();
  if (current.status === 'active' && current.tabId === tabId && current.conversationId === opts.chatId) {
    await safeSendToTab(tabId, { type: 'bc/hide-detection-prompt' });
    await safeSendToTab(tabId, {
      type: 'bc/session-resumed',
      conversationId: opts.chatId,
      mode: opts.mode,
      projectAlias: opts.projectAlias,
    });
    return true;
  }

  if (current.status === 'active' && current.tabId !== null && current.tabId !== tabId) {
    await stopSessionInternal('user', current.tabId);
  }

  sessionManager.start({
    conversationId: opts.chatId,
    tabId,
    projectAlias: opts.projectAlias,
    mode: opts.mode,
  });
  await persistSession();
  // Keep seen fingerprints — resume must not replay historical tool ids.
  pendingCalls.clear();
  deliveredFingerprints.clear();
  await clearTabDismissal(tabId);
  await updateSettings({ mode: opts.mode, copilotEnabled: true });
  await pushModeToCompanion(opts.mode);

  try {
    const companion = await getCompanionClient();
    await companion.upsertChatSession({
      chatId: opts.chatId,
      title: opts.title,
      projectAlias: opts.projectAlias,
      mode: opts.mode,
      copilotUrl: buildCopilotConversationUrl(opts.chatId, opts.url),
      rootAliases: opts.rootAliases?.length ? opts.rootAliases : [opts.projectAlias],
    });
  } catch (err) {
    console.error('[local-context-bridge] failed to refresh resumed session', err);
  }

  await safeSendToTab(tabId, { type: 'bc/hide-detection-prompt' });
  await safeSendToTab(tabId, {
    type: 'bc/session-resumed',
    conversationId: opts.chatId,
    mode: opts.mode,
    projectAlias: opts.projectAlias,
  });
  await safeSendToTab(tabId, {
    type: 'bc/debug',
    level: 'ok',
    message: `resumed saved chat ${opts.chatId} mode=${opts.mode} alias=${opts.projectAlias}`,
  });
  broadcast({ type: 'broadcast/state-changed' });
  void sendExtensionHeartbeat();
  return true;
}

/**
 * One-click Start pipeline: companion → auto-pair → roots → session.
 */
async function ensureReadyAndStartSession(
  tabId: number,
  opts: {
    projectAlias?: string;
    initialTask?: string;
    mode?: SessionMode;
    chatId?: string;
    title?: string;
  } = {},
): Promise<ReturnType<SessionManager['getState']>> {
  const healthy = await ensureCompanionHealthy();
  if (!healthy) {
    throw new Error(
      'Companion is not running. Open Local Context Bridge.app, then try Start again.',
    );
  }

  const token = await ensurePaired();
  const companion = await getCompanionClient();
  let status = await companion.getStatus(token);

  if (!status.primaryAlias && status.roots.length === 0) {
    throw new Error(
      'No approved folder yet. Approve a project folder in the popup or Bridge.app setup.',
    );
  }

  const syncedMode = opts.mode ?? (await syncModeFromCompanion());
  const projectAlias =
    opts.projectAlias || status.primaryAlias || status.roots[0]?.alias || 'project';

  return startSessionForTab(tabId, projectAlias, syncedMode, opts.initialTask, opts.chatId, opts.title);
}

async function maybeConsumePendingStart(tabId: number): Promise<boolean> {
  // Serialize claims — content-ready + adapter-detected both fire on load.
  if (pendingStartClaim) return pendingStartClaim;
  pendingStartClaim = (async () => {
    try {
      const companion = await getCompanionClient();
      await companion.health();
      // Peek first — only consume after the session actually starts, so a failed
      // attempt does not drop the desktop START request.
      const peek = await companion.peekPendingStart();
      if (!peek.pending) return false;

      const mode =
        peek.mode === 'manual' || peek.mode === 'assisted' || peek.mode === 'automatic'
          ? peek.mode
          : undefined;
      const initialTask =
        peek.initialTask?.trim() || (peek.explore === false ? undefined : DEFAULT_EXPLORE_TASK);

      await updateSettings({ copilotEnabled: true, suggestOnCopilotOpen: true });
      await ensureReadyAndStartSession(tabId, {
        projectAlias: peek.rootAlias,
        mode,
        initialTask,
        chatId: peek.sessionId,
        title: peek.title,
      });
      await companion.consumePendingStart().catch(() => undefined);
      await closeSetupTabs();
      return true;
    } catch (err) {
      console.error('[local-context-bridge] pending start failed', err);
      return false;
    } finally {
      pendingStartClaim = null;
    }
  })();
  return pendingStartClaim;
}

/** Claim a desktop START even if Copilot was already open (no navigation). */
async function claimPendingStartAnywhere(): Promise<boolean> {
  try {
    const companion = await getCompanionClient();
    await companion.health();
    const peek = await companion.peekPendingStart();
    if (!peek.pending) return false;

    const current = sessionManager.getState();
    if (current.status === 'active' && current.tabId !== null) {
      if (await maybeConsumePendingStart(current.tabId)) return true;
    }

    const tabs = await chrome.tabs.query({
      url: ['https://m365.cloud.microsoft/*', 'https://copilot.microsoft.com/*'],
    });
    const usable = tabs.filter((t) => typeof t.id === 'number');
    for (const tab of usable) {
      if (await maybeConsumePendingStart(tab.id!)) return true;
    }

    // No Copilot tab yet — open one; content script will claim on load.
    const url =
      `https://m365.cloud.microsoft/chat/?lcb_start=${encodeURIComponent(peek.sessionId || '1')}` +
      `&t=${Date.now()}`;
    await chrome.tabs.create({ url, active: true });
    return true;
  } catch {
    return false;
  }
}

async function maybeShowDetectionPrompt(
  tabId: number,
  adapterId: string,
  confidence: number,
): Promise<void> {
  if (adapterId !== 'copilot') return;
  if (confidence < MIN_USABLE_CONFIDENCE) return;

  const current = sessionManager.getState();
  if (current.status === 'active' && current.tabId === tabId) return;

  // Desktop /setup "Start in Copilot" — consume even if suggest-on-open is off.
  if (await maybeConsumePendingStart(tabId)) return;

  // Resume a known saved chat instead of asking to Start again.
  try {
    const tab = await chrome.tabs.get(tabId);
    const chatId = extractCopilotConversationId(tab.url || '');
    if (chatId) {
      const companion = await getCompanionClient();
      await companion.health();
      const existing = await companion.getChatSession(chatId).catch(() => null);
      if (existing?.projectAlias) {
        const mode =
          existing.mode === 'manual' || existing.mode === 'assisted' || existing.mode === 'automatic'
            ? existing.mode
            : 'assisted';
        if (
          await resumeSessionForTab(tabId, {
            chatId,
            projectAlias: existing.projectAlias,
            mode,
            title: existing.title,
            url: tab.url || buildCopilotConversationUrl(chatId),
            rootAliases: existing.rootAliases,
          })
        ) {
          return;
        }
      }
    }
  } catch {
    /* fall through to normal prompt */
  }

  const settings = await getSettings();
  if (!settings.copilotEnabled || !settings.suggestOnCopilotOpen) return;

  const dismissal = await getTabDismissal(tabId);
  if (dismissal) return;

  const pairing = await getPairing();
  let readiness: 'ready' | 'needs-companion' | 'needs-pairing' | 'needs-folder' = 'ready';
  let projectAlias = 'project';
  let roots: CompanionStatusRoot[] = [];

  try {
    const companion = await getCompanionClient();
    await companion.health();
  } catch {
    readiness = 'needs-companion';
    await safeSendToTab(tabId, {
      type: 'bc/show-detection-prompt',
      projectAlias,
      roots,
      readiness,
    });
    return;
  }

  if (!pairing) {
    readiness = 'needs-pairing';
    await safeSendToTab(tabId, {
      type: 'bc/show-detection-prompt',
      projectAlias,
      roots,
      readiness,
    });
    return;
  }

  try {
    const companion = await getCompanionClient();
    const status = await companion.getStatus(pairing.token);
    roots = status.roots;
    projectAlias = status.primaryAlias || status.roots[0]?.alias || 'project';
    if (!status.primaryAlias && status.roots.length === 0) {
      readiness = 'needs-folder';
    }
    await safeSendToTab(tabId, {
      type: 'bc/show-detection-prompt',
      projectAlias,
      roots,
      readiness,
    });
  } catch {
    readiness = 'needs-pairing';
    await safeSendToTab(tabId, {
      type: 'bc/show-detection-prompt',
      projectAlias,
      roots,
      readiness,
    });
  }
}

async function executePendingCall(requestId: string): Promise<void> {
  const pending = pendingCalls.get(requestId);
  if (!pending) return;
  if (inFlightCalls.has(requestId)) return;
  pendingCalls.delete(requestId);
  inFlightCalls.add(requestId);

  const state = sessionManager.getState();
  if (state.status !== 'active' || state.tabId !== pending.tabId) {
    seenRequests.forget(pending.fingerprint);
    inFlightCalls.delete(requestId);
    return;
  }

  const decision = sessionManager.canRecordCall(SESSION_LIMITS);
  if (!decision.allowed) {
    seenRequests.forget(pending.fingerprint);
    inFlightCalls.delete(requestId);
    await stopSessionInternal(
      decision.reason === 'max-iterations' ? 'max-iterations' : 'session-expired',
    );
    return;
  }

  const pairing = await getPairing();
  if (!pairing) {
    seenRequests.forget(pending.fingerprint);
    inFlightCalls.delete(requestId);
    await safeSendToTab(pending.tabId, {
      type: 'bc/tool-call-failed',
      requestId,
      message: 'Not paired with the companion.',
    });
    return;
  }

  try {
    const companion = await getCompanionClient();
    let result = await companion.executeTool(pairing.token, pending.request).catch(async (err) => {
      // Copilot often reuses short ids like "dir-summary-001". Companion rejects
      // those within the replay TTL — retry once with a fresh id, but keep the
      // original requestId on the result so the chat protocol still matches.
      const replay =
        err instanceof BridgeApiError &&
        (err.status === 409 ||
          /replay|duplicate/i.test(err.message) ||
          /replay|duplicate/i.test(err.code));
      if (!replay) throw err;

      const retryId = crypto.randomUUID();
      await safeSendToTab(pending.tabId, {
        type: 'bc/debug',
        level: 'warn',
        message: `duplicate id=${pending.request.id} — retrying as ${retryId}`,
      });
      const retried = await companion.executeTool(pairing.token, {
        ...pending.request,
        id: retryId,
      });
      return { ...retried, requestId: pending.request.id };
    });

    // Always echo Copilot's original id in the result fence.
    if (result.requestId !== pending.request.id) {
      result = { ...result, requestId: pending.request.id };
    }

    sessionManager.recordCall();
    await persistSession();

    const behavior = getModeBehavior(state.mode);
    await safeSendToTab(pending.tabId, {
      type: 'bc/tool-result-ready',
      result,
      requiresConfirmation: behavior.confirmBeforeInsert,
      autoSubmit: behavior.autoSubmitAfterInsert,
    });
    // Mark seen after handoff to the tab; content can ask us to forget if insert fails.
    seenRequests.remember(pending.fingerprint);
    deliveredFingerprints.set(pending.request.id, pending.fingerprint);

    const postDecision = sessionManager.canRecordCall(SESSION_LIMITS);
    if (!postDecision.allowed) {
      await stopSessionInternal(
        postDecision.reason === 'max-iterations' ? 'max-iterations' : 'session-expired',
      );
    }
  } catch (err) {
    const message = err instanceof BridgeApiError ? err.message : 'Tool execution failed.';
    seenRequests.forget(pending.fingerprint);
    await safeSendToTab(pending.tabId, { type: 'bc/tool-call-failed', requestId, message });
  } finally {
    inFlightCalls.delete(requestId);
  }
}

async function onToolRequestDetected(tabId: number, request: LocalToolRequest): Promise<void> {
  const state = sessionManager.getState();
  if (state.status !== 'active' || state.tabId !== tabId) {
    await safeSendToTab(tabId, {
      type: 'bc/debug',
      level: 'warn',
      message: `ignored tool ${request.tool}: session status=${state.status} sessionTab=${state.status === 'active' ? state.tabId : '-'} eventTab=${tabId}`,
    });
    return;
  }

  const fingerprint = await fingerprintRequest(request);
  if (
    seenRequests.has(fingerprint) ||
    pendingCalls.has(request.id) ||
    inFlightCalls.has(request.id)
  ) {
    await safeSendToTab(tabId, {
      type: 'bc/debug',
      level: 'warn',
      message: `ignored duplicate tool request id=${request.id}`,
    });
    return;
  }

  const decision = sessionManager.canRecordCall(SESSION_LIMITS);
  if (!decision.allowed) {
    await stopSessionInternal(
      decision.reason === 'max-iterations' ? 'max-iterations' : 'session-expired',
    );
    return;
  }

  pendingCalls.set(request.id, { request, tabId, fingerprint });
  const behavior = getModeBehavior(state.mode);
  await safeSendToTab(tabId, {
    type: 'bc/debug',
    level: 'ok',
    message: `accepted tool ${request.tool}; confirm=${behavior.confirmBeforeExecute}`,
  });
  if (behavior.confirmBeforeExecute) {
    await safeSendToTab(tabId, {
      type: 'bc/pending-tool-call',
      request,
      projectAlias: state.projectAlias ?? '',
    });
  } else {
    await executePendingCall(request.id);
  }
}

async function handleContentMessage(
  message: ContentToBackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  await ensureHydrated();
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'cb/content-ready':
      void sendExtensionHeartbeat();
      if (tabId !== undefined) {
        const settings = await getSettings();
        await safeSendToTab(tabId, {
          type: 'bc/settings',
          showDeveloperLogs: settings.showDeveloperLogs,
        });
        void maybeConsumePendingStart(tabId);
      }
      return;
    case 'cb/adapter-detected':
      void sendExtensionHeartbeat();
      if (tabId !== undefined) {
        const frameId = sender.frameId ?? 0;
        const previous = detectedTabs.get(tabId);
        const next = {
          adapterId: message.adapterId,
          confidence: message.confidence,
          url: message.url,
          frameId,
          hasComposer: message.hasComposer,
        };
        const shouldReplace =
          !previous ||
          (message.hasComposer && !previous.hasComposer) ||
          (message.hasComposer === previous.hasComposer &&
            message.confidence >= previous.confidence);
        if (shouldReplace) detectedTabs.set(tabId, next);
        await maybeShowDetectionPrompt(tabId, message.adapterId, message.confidence);
      }
      return;
    case 'cb/tool-request-detected':
      if (tabId !== undefined) await onToolRequestDetected(tabId, message.request);
      return;
    case 'cb/run-approved':
      if (message.enableAutomatic) {
        sessionManager.setMode('automatic');
        await persistSession();
        await updateSettings({ mode: 'automatic' });
        await pushModeToCompanion('automatic');
        broadcast({ type: 'broadcast/state-changed' });
        if (tabId !== undefined) {
          await safeSendToTab(tabId, {
            type: 'bc/debug',
            level: 'ok',
            message: 'mode switched to automatic (Always allow)',
          });
        }
      }
      await executePendingCall(message.requestId);
      return;
    case 'cb/run-declined': {
      const pending = pendingCalls.get(message.requestId);
      if (pending) seenRequests.forget(pending.fingerprint);
      pendingCalls.delete(message.requestId);
      return;
    }
    case 'cb/tool-insert-failed': {
      const fp = deliveredFingerprints.get(message.requestId);
      if (fp) {
        seenRequests.forget(fp);
        deliveredFingerprints.delete(message.requestId);
      }
      return;
    }
    case 'cb/cancel-working':
      await stopSessionInternal('user');
      return;
    case 'cb/set-developer-logs': {
      await updateSettings({ showDeveloperLogs: message.enabled });
      broadcast({ type: 'broadcast/state-changed' });
      return;
    }
    case 'cb/start-session-from-prompt':
      if (tabId !== undefined) {
        await ensureReadyAndStartSession(tabId, { projectAlias: message.projectAlias });
      }
      return;
    case 'cb/ensure-ready-and-start':
      if (tabId !== undefined) {
        await ensureReadyAndStartSession(tabId, { projectAlias: message.projectAlias });
      }
      return;
    case 'cb/chat-changed':
      if (tabId !== undefined) {
        await onChatChanged(tabId, message.chatId, message.url, message.title);
      }
      return;
    case 'cb/check-pending-start':
      if (tabId !== undefined) {
        await maybeConsumePendingStart(tabId);
      } else {
        await claimPendingStartAnywhere();
      }
      return;
    case 'cb/dismiss-prompt':
      if (tabId !== undefined) await setTabDismissal(tabId, message.kind);
      return;
  }
}

async function handleUiMessage(message: UiToBackgroundMessage): Promise<unknown> {
  await ensureHydrated();

  switch (message.type) {
    case 'ui/get-state':
      void sendExtensionHeartbeat();
      return buildStateSnapshot();
    case 'ui/start-pairing':
      void runPairingFlow();
      return { ok: true };
    case 'ui/forget-pairing':
      await setPairing(null);
      broadcast({ type: 'broadcast/state-changed' });
      return { ok: true };
    case 'ui/set-mode': {
      const state = sessionManager.setMode(message.mode);
      await persistSession();
      await updateSettings({ mode: message.mode });
      await pushModeToCompanion(message.mode);
      broadcast({ type: 'broadcast/state-changed' });
      return state;
    }
    case 'ui/set-settings': {
      const settings = await updateSettings(message.patch);
      broadcast({ type: 'broadcast/state-changed' });
      // Push developer-log preference to any open chat tabs.
      if (typeof message.patch.showDeveloperLogs === 'boolean') {
        for (const tabId of detectedTabs.keys()) {
          await safeSendToTab(tabId, {
            type: 'bc/settings',
            showDeveloperLogs: settings.showDeveloperLogs,
          });
        }
      }
      return settings;
    }
    case 'ui/start-session':
      return ensureReadyAndStartSession(message.tabId, {
        projectAlias: message.projectAlias,
        mode: message.mode,
        initialTask: message.initialTask,
      });
    case 'ui/ensure-ready-and-start':
      return ensureReadyAndStartSession(message.tabId, {
        projectAlias: message.projectAlias,
        mode: message.mode,
        initialTask: message.initialTask,
      });
    case 'ui/stop-session':
      await stopSessionInternal('user');
      return sessionManager.getState();
    case 'ui/refresh-health':
      return checkHealth();
    case 'ui/start-companion': {
      const result = await sendNativeHost({
        action: 'start',
        project: message.project,
        alias: message.alias ?? 'project',
      });
      if (!result) {
        return {
          ok: false,
          reachable: false,
          error: 'Native launcher not installed.',
          installHint: nativeHostInstallCommand(chrome.runtime.id),
        };
      }
      if (!result.ok) {
        return {
          ok: false,
          reachable: false,
          error: result.error ?? 'Failed to start companion',
          installHint: nativeHostInstallCommand(chrome.runtime.id),
        };
      }
      // Give health a moment then refresh snapshot consumers.
      broadcast({ type: 'broadcast/state-changed' });
      return { ok: true, reachable: true };
    }
    case 'ui/stop-companion': {
      await sendNativeHost({ action: 'stop' });
      broadcast({ type: 'broadcast/state-changed' });
      return { ok: true };
    }
    case 'ui/register-root': {
      const pairing = await getPairing();
      if (!pairing) throw new Error('Pair the extension before approving a folder.');
      const companion = await getCompanionClient();
      const registered = await companion.registerRoot(pairing.token, {
        scope: message.scope,
        path: message.path,
        alias: message.alias,
        primary: message.primary ?? true,
      });
      broadcast({ type: 'broadcast/state-changed' });
      return { alias: registered.alias, path: registered.path };
    }
    case 'ui/remove-root': {
      const pairing = await getPairing();
      if (!pairing) throw new Error('Not paired.');
      const companion = await getCompanionClient();
      await companion.removeRoot(pairing.token, message.id);
      broadcast({ type: 'broadcast/state-changed' });
      return { ok: true };
    }
    case 'ui/pick-folder': {
      const pairing = await getPairing();
      if (!pairing) throw new Error('Pair the extension before browsing for a folder.');
      const companion = await getCompanionClient();
      // Popup often closes when the native dialog steals focus — keep working in the SW.
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Local Context Bridge',
          message: 'Choose a folder in the dialog, then reopen the extension popup.',
        });
      } catch {
        // notifications permission may be missing in some loads
      }
      const path = await companion.pickFolder(pairing.token);
      await setPendingPickedPath(path);
      broadcast({ type: 'broadcast/state-changed' });
      return { path };
    }
    case 'ui/clear-picked-path':
      await setPendingPickedPath(null);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isContentToBackgroundMessage(message)) {
    handleContentMessage(message, sender).catch((err: unknown) => {
      console.error('[local-context-bridge] failed handling content message', message.type, err);
    });
    return false;
  }
  if (isUiToBackgroundMessage(message)) {
    handleUiMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        sendResponse({ error: err instanceof Error ? err.message : 'Unknown error' });
      });
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  detectedTabs.delete(tabId);
  clearTabDismissal(tabId).catch(() => undefined);
  const state = sessionManager.getState();
  if (state.status === 'active' && state.tabId === tabId) {
    stopSessionInternal('tab-closed', tabId).catch((err: unknown) => {
      console.error('[local-context-bridge] failed stopping session on tab close', err);
    });
  }
});

/** When Copilot updates the URL with a real conversationId, bind it immediately. */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  const url = changeInfo.url || tab.url || '';
  if (!/m365\.cloud\.microsoft|copilot\.microsoft\.com/i.test(url)) return;

  const state = sessionManager.getState();
  if (state.status !== 'active' || state.tabId !== tabId) return;

  void (async () => {
    try {
      const chatId = extractCopilotConversationId(url);
      if (!chatId) return;

      const companion = await getCompanionClient();
      const prev = state.conversationId;
      if (prev && prev !== chatId) {
        await companion.remapChatSession(prev, chatId).catch(() => undefined);
        sessionManager.setConversationId(chatId);
        await persistSession();
      }
      await companion.upsertChatSession({
        chatId,
        title: state.projectAlias ? `${state.projectAlias}-session` : undefined,
        projectAlias: state.projectAlias || undefined,
        mode: state.mode,
        copilotUrl: buildCopilotConversationUrl(chatId, url),
        rootAliases: state.projectAlias ? [state.projectAlias] : undefined,
      });
    } catch {
      /* ignore */
    }
  })();
});

const SESSION_WATCHDOG_ALARM = 'local-context-bridge:session-watchdog';
const HEARTBEAT_ALARM = 'local-context-bridge:extension-heartbeat';
void chrome.alarms.create(SESSION_WATCHDOG_ALARM, { periodInMinutes: 1 });
void chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void sendExtensionHeartbeat();
    void claimPendingStartAnywhere();
    return;
  }
  if (alarm.name !== SESSION_WATCHDOG_ALARM) return;
  const state = sessionManager.getState();
  if (state.status !== 'active') return;
  if (sessionManager.isExpired(SESSION_LIMITS)) {
    stopSessionInternal('session-expired').catch((err: unknown) => {
      console.error('[local-context-bridge] failed stopping expired session', err);
    });
  }
});

void ensureHydrated();
void sendExtensionHeartbeat();
void claimPendingStartAnywhere();
