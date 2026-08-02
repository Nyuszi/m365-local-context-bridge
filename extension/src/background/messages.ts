import type { CompanionStatusRoot } from './companion-client';
import type { LocalToolRequest, LocalToolResult } from '../protocol/types';
import type { SessionMode } from '../session/modes';
import type { SessionState, SessionStopReason } from '../session/session-manager';
import type { StoredSettings, TabDismissalKind } from '../storage/storage';

/**
 * Every runtime message the extension sends between contexts, grouped by
 * direction. Each union is keyed by a namespaced `type` string (`cb/…` from
 * content scripts, `bc/…` from background to content scripts, `ui/…` from
 * popup/options, `broadcast/…` fire-and-forget notices) so a single
 * `chrome.runtime.onMessage` listener can route messages with an exhaustive
 * switch and no `any`.
 */

// ---- Content script -> background ----

export type ContentToBackgroundMessage =
  | { type: 'cb/content-ready'; url: string }
  | {
      type: 'cb/adapter-detected';
      adapterId: string;
      confidence: number;
      url: string;
      hasComposer: boolean;
    }
  | { type: 'cb/tool-request-detected'; request: LocalToolRequest }
  | { type: 'cb/run-approved'; requestId: string; enableAutomatic?: boolean }
  | { type: 'cb/run-declined'; requestId: string }
  | { type: 'cb/start-session-from-prompt'; projectAlias: string }
  | { type: 'cb/dismiss-prompt'; kind: TabDismissalKind }
  | { type: 'cb/set-developer-logs'; enabled: boolean }
  | { type: 'cb/ensure-ready-and-start'; projectAlias?: string }
  | {
      type: 'cb/chat-changed';
      chatId: string;
      url: string;
      title?: string;
    }
  | { type: 'cb/check-pending-start' }
  | { type: 'cb/tool-insert-failed'; requestId: string };

export function isContentToBackgroundMessage(
  message: unknown,
): message is ContentToBackgroundMessage {
  return isNamespaced(message, 'cb/');
}

// ---- Background -> content script ----

export type BackgroundToContentMessage =
  | {
      type: 'bc/show-detection-prompt';
      projectAlias: string;
      roots: CompanionStatusRoot[];
      /** Why Start is offered — drives copy in the overlay. */
      readiness: 'ready' | 'needs-companion' | 'needs-pairing' | 'needs-folder';
    }
  | { type: 'bc/hide-detection-prompt' }
  | {
      type: 'bc/session-started';
      conversationId: string;
      mode: SessionMode;
      projectAlias: string;
      bootstrapMessage: string;
      chatTitle?: string;
    }
  | {
      type: 'bc/session-resumed';
      conversationId: string;
      mode: SessionMode;
      projectAlias: string;
    }
  | { type: 'bc/pending-tool-call'; request: LocalToolRequest; projectAlias: string }
  | {
      type: 'bc/tool-result-ready';
      result: LocalToolResult;
      requiresConfirmation: boolean;
      autoSubmit: boolean;
    }
  | { type: 'bc/tool-call-failed'; requestId: string; message: string }
  | { type: 'bc/session-stopped'; reason: SessionStopReason }
  | { type: 'bc/session-limit-warning'; message: string }
  | { type: 'bc/debug'; message: string; level?: 'info' | 'ok' | 'warn' | 'error' }
  | { type: 'bc/settings'; showDeveloperLogs: boolean };

// ---- Extension pages (popup/options) -> background ----

export type UiToBackgroundMessage =
  | { type: 'ui/get-state' }
  | { type: 'ui/start-pairing' }
  | { type: 'ui/forget-pairing' }
  | { type: 'ui/set-mode'; mode: SessionMode }
  | { type: 'ui/set-settings'; patch: Partial<StoredSettings> }
  | { type: 'ui/start-session'; tabId: number; projectAlias: string; initialTask?: string; mode?: SessionMode }
  | { type: 'ui/stop-session' }
  | { type: 'ui/refresh-health' }
  | {
      type: 'ui/register-root';
      scope: 'project' | 'home';
      path?: string;
      alias: string;
      primary?: boolean;
    }
  | { type: 'ui/remove-root'; id: string }
  | { type: 'ui/pick-folder' }
  | { type: 'ui/clear-picked-path' }
  | { type: 'ui/start-companion'; project?: string; alias?: string }
  | { type: 'ui/stop-companion' }
  | { type: 'ui/ensure-ready-and-start'; tabId: number; projectAlias?: string; initialTask?: string; mode?: SessionMode };

export function isUiToBackgroundMessage(message: unknown): message is UiToBackgroundMessage {
  return isNamespaced(message, 'ui/');
}

export interface CompanionHealthSummary {
  reachable: boolean;
  version?: string;
  docker?: boolean;
}

export interface PopupStateSnapshot {
  settings: StoredSettings;
  paired: boolean;
  primaryAlias: string | null;
  homePath: string | null;
  roots: CompanionStatusRoot[];
  session: SessionState;
  health: CompanionHealthSummary;
  installationId: string;
  pendingPickedPath: string | null;
}

/** Response payload shape for each `UiToBackgroundMessage`, keyed by its `type`. */
export interface UiToBackgroundResponseMap {
  'ui/get-state': PopupStateSnapshot;
  'ui/start-pairing': { ok: boolean };
  'ui/forget-pairing': { ok: boolean };
  'ui/set-mode': SessionState;
  'ui/set-settings': StoredSettings;
  'ui/start-session': SessionState;
  'ui/stop-session': SessionState;
  'ui/refresh-health': CompanionHealthSummary;
  'ui/register-root': { alias: string; path: string };
  'ui/remove-root': { ok: boolean };
  'ui/pick-folder': { path: string };
  'ui/clear-picked-path': { ok: boolean };
  'ui/start-companion': { ok: boolean; reachable: boolean; error?: string; installHint?: string };
  'ui/stop-companion': { ok: boolean };
  'ui/ensure-ready-and-start': SessionState;
}

export type UiToBackgroundResponse<T extends keyof UiToBackgroundResponseMap> =
  UiToBackgroundResponseMap[T];

// ---- Background -> extension pages (fire-and-forget) ----

export type PairingProgressStatus =
  'requesting' | 'awaiting-approval' | 'redeeming' | 'done' | 'error';

export interface PairingProgress {
  status: PairingProgressStatus;
  message: string;
}

export type BackgroundBroadcast =
  | { type: 'broadcast/pairing-progress'; progress: PairingProgress }
  | { type: 'broadcast/state-changed' };

function isNamespaced(message: unknown, prefix: string): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith(prefix)
  );
}
