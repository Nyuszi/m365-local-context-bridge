import type { SessionMode } from './modes';

export type SessionStatus = 'idle' | 'active' | 'stopped';

export type SessionStopReason =
  'user' | 'max-iterations' | 'session-expired' | 'tab-closed' | 'error';

export interface SessionState {
  status: SessionStatus;
  mode: SessionMode;
  conversationId: string | null;
  tabId: number | null;
  projectAlias: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
  iterationCount: number;
  lastStopReason: SessionStopReason | null;
}

export interface SessionLimits {
  maxIterations: number;
  maxSessionMinutes: number;
}

export type RecordCallDecision =
  | { allowed: true }
  | { allowed: false; reason: 'not-active' | 'max-iterations' | 'session-expired' };

function initialState(mode: SessionMode): SessionState {
  return {
    status: 'idle',
    mode,
    conversationId: null,
    tabId: null,
    projectAlias: null,
    startedAt: null,
    lastActivityAt: null,
    iterationCount: 0,
    lastStopReason: null,
  };
}

/**
 * Pure, dependency-free state machine for a single Local Context Bridge
 * session. Owns no chrome.* or network calls so it can be exercised
 * directly in tests and safely re-hydrated from chrome.storage.session by
 * the background orchestrator after a service-worker restart.
 */
export class SessionManager {
  private state: SessionState;

  constructor(defaultMode: SessionMode = 'assisted') {
    this.state = initialState(defaultMode);
  }

  getState(): SessionState {
    return { ...this.state };
  }

  /** Replaces the entire state, e.g. when restoring from persisted storage. */
  restore(state: SessionState): void {
    this.state = { ...state };
  }

  isActive(): boolean {
    return this.state.status === 'active';
  }

  start(params: {
    conversationId: string;
    tabId: number;
    projectAlias: string;
    mode?: SessionMode;
    now?: number;
  }): SessionState {
    const now = params.now ?? Date.now();
    this.state = {
      status: 'active',
      mode: params.mode ?? this.state.mode,
      conversationId: params.conversationId,
      tabId: params.tabId,
      projectAlias: params.projectAlias,
      startedAt: now,
      lastActivityAt: now,
      iterationCount: 0,
      lastStopReason: null,
    };
    return this.getState();
  }

  setMode(mode: SessionMode): SessionState {
    this.state = { ...this.state, mode };
    return this.getState();
  }

  setConversationId(conversationId: string): SessionState {
    if (this.state.status === 'active') {
      this.state = { ...this.state, conversationId };
    }
    return this.getState();
  }

  setProjectAlias(projectAlias: string): SessionState {
    if (this.state.status === 'active') {
      this.state = { ...this.state, projectAlias };
    }
    return this.getState();
  }

  /**
   * Checks whether one more tool call is allowed right now, without yet
   * recording it. Callers should check this before dispatching a request to
   * the companion so the iteration count only ever increases for calls that
   * actually run.
   */
  canRecordCall(limits: SessionLimits, now: number = Date.now()): RecordCallDecision {
    if (this.state.status !== 'active') {
      return { allowed: false, reason: 'not-active' };
    }
    if (limits.maxSessionMinutes > 0 && this.isExpired(limits, now)) {
      return { allowed: false, reason: 'session-expired' };
    }
    // 0 = unlimited (no hard tool-call cap for the session).
    if (limits.maxIterations > 0 && this.state.iterationCount >= limits.maxIterations) {
      return { allowed: false, reason: 'max-iterations' };
    }
    return { allowed: true };
  }

  /** Records a completed tool call, advancing the iteration counter and activity clock. */
  recordCall(now: number = Date.now()): SessionState {
    this.state = {
      ...this.state,
      iterationCount: this.state.iterationCount + 1,
      lastActivityAt: now,
    };
    return this.getState();
  }

  touch(now: number = Date.now()): SessionState {
    if (this.state.status === 'active') {
      this.state = { ...this.state, lastActivityAt: now };
    }
    return this.getState();
  }

  isExpired(limits: SessionLimits, now: number = Date.now()): boolean {
    if (this.state.status !== 'active' || this.state.startedAt === null) return false;
    // 0 = no session time cap.
    if (limits.maxSessionMinutes <= 0) return false;
    const elapsedMinutes = (now - this.state.startedAt) / 60_000;
    return elapsedMinutes >= limits.maxSessionMinutes;
  }

  stop(reason: SessionStopReason = 'user'): SessionState {
    this.state = {
      ...initialState(this.state.mode),
      lastStopReason: reason,
    };
    return this.getState();
  }
}
