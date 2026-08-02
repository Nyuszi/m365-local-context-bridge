import { describe, expect, it } from 'vitest';
import { SessionManager } from './session-manager';

const LIMITS = { maxIterations: 3, maxSessionMinutes: 5 };

describe('SessionManager', () => {
  it('starts idle with the given default mode', () => {
    const sm = new SessionManager('automatic');
    const state = sm.getState();
    expect(state.status).toBe('idle');
    expect(state.mode).toBe('automatic');
    expect(state.iterationCount).toBe(0);
  });

  it('transitions to active on start and records session metadata', () => {
    const sm = new SessionManager();
    const state = sm.start({
      conversationId: 'conv-1',
      tabId: 42,
      projectAlias: 'billing-service',
      now: 1000,
    });
    expect(state.status).toBe('active');
    expect(state.conversationId).toBe('conv-1');
    expect(state.tabId).toBe(42);
    expect(state.projectAlias).toBe('billing-service');
    expect(state.startedAt).toBe(1000);
    expect(sm.isActive()).toBe(true);
  });

  it('allows overriding the mode when starting a session', () => {
    const sm = new SessionManager('assisted');
    const state = sm.start({
      conversationId: 'c',
      tabId: 1,
      projectAlias: 'a',
      mode: 'manual',
      now: 0,
    });
    expect(state.mode).toBe('manual');
  });

  it('rejects recording a call when not active', () => {
    const sm = new SessionManager();
    expect(sm.canRecordCall(LIMITS)).toEqual({ allowed: false, reason: 'not-active' });
  });

  it('allows calls up to the iteration limit and then rejects further calls', () => {
    const sm = new SessionManager();
    sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });

    for (let i = 0; i < LIMITS.maxIterations; i += 1) {
      expect(sm.canRecordCall(LIMITS, 0)).toEqual({ allowed: true });
      sm.recordCall(0);
    }

    expect(sm.getState().iterationCount).toBe(LIMITS.maxIterations);
    expect(sm.canRecordCall(LIMITS, 0)).toEqual({ allowed: false, reason: 'max-iterations' });
  });

  it('rejects calls once the session time budget has elapsed', () => {
    const sm = new SessionManager();
    sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });

    const almostExpired = LIMITS.maxSessionMinutes * 60_000 - 1;
    expect(sm.canRecordCall(LIMITS, almostExpired)).toEqual({ allowed: true });

    const expired = LIMITS.maxSessionMinutes * 60_000;
    expect(sm.canRecordCall(LIMITS, expired)).toEqual({
      allowed: false,
      reason: 'session-expired',
    });
    expect(sm.isExpired(LIMITS, expired)).toBe(true);
  });

  it('is never expired while idle', () => {
    const sm = new SessionManager();
    expect(sm.isExpired(LIMITS, 10 ** 12)).toBe(false);
  });

  it('updates lastActivityAt on touch while active, no-ops while idle', () => {
    const sm = new SessionManager();
    sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });
    const touched = sm.touch(500);
    expect(touched.lastActivityAt).toBe(500);

    const idle = new SessionManager();
    idle.touch(500);
    expect(idle.getState().lastActivityAt).toBeNull();
  });

  it('resets to idle on stop and records the stop reason', () => {
    const sm = new SessionManager('manual');
    sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });
    sm.recordCall(0);
    const stopped = sm.stop('max-iterations');
    expect(stopped.status).toBe('idle');
    expect(stopped.iterationCount).toBe(0);
    expect(stopped.conversationId).toBeNull();
    expect(stopped.lastStopReason).toBe('max-iterations');
    expect(stopped.mode).toBe('manual');
  });

  it('can restore a previously serialized state', () => {
    const sm = new SessionManager();
    const started = sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });
    sm.recordCall(0);
    const snapshot = sm.getState();

    const restored = new SessionManager();
    restored.restore(snapshot);
    expect(restored.getState()).toEqual(sm.getState());
    expect(restored.isActive()).toBe(true);
    expect(started.status).toBe('active');
  });

  it('setMode changes the mode without otherwise altering state', () => {
    const sm = new SessionManager('assisted');
    sm.start({ conversationId: 'c', tabId: 1, projectAlias: 'a', now: 0 });
    const updated = sm.setMode('automatic');
    expect(updated.mode).toBe('automatic');
    expect(updated.conversationId).toBe('c');
  });
});
