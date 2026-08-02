import { describe, expect, it } from 'vitest';
import {
  getModeBehavior,
  getModeDescription,
  getModeLabel,
  isSessionMode,
  SESSION_MODES,
} from './modes';

describe('isSessionMode', () => {
  it('accepts every declared mode', () => {
    for (const mode of SESSION_MODES) {
      expect(isSessionMode(mode)).toBe(true);
    }
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isSessionMode('turbo')).toBe(false);
    expect(isSessionMode(undefined)).toBe(false);
    expect(isSessionMode(42)).toBe(false);
    expect(isSessionMode(null)).toBe(false);
  });
});

describe('getModeBehavior', () => {
  it('requires confirmation for both execute and insert in manual mode, and never auto-submits', () => {
    const behavior = getModeBehavior('manual');
    expect(behavior.confirmBeforeExecute).toBe(true);
    expect(behavior.confirmBeforeInsert).toBe(true);
    expect(behavior.autoSubmitAfterInsert).toBe(false);
  });

  it('requires confirmation only before executing in assisted mode, then auto-submits', () => {
    const behavior = getModeBehavior('assisted');
    expect(behavior.confirmBeforeExecute).toBe(true);
    expect(behavior.confirmBeforeInsert).toBe(false);
    expect(behavior.autoSubmitAfterInsert).toBe(true);
  });

  it('never asks for confirmation in automatic mode', () => {
    const behavior = getModeBehavior('automatic');
    expect(behavior.confirmBeforeExecute).toBe(false);
    expect(behavior.confirmBeforeInsert).toBe(false);
    expect(behavior.autoSubmitAfterInsert).toBe(true);
  });

  it('is strictly more automated moving from manual -> assisted -> automatic', () => {
    const manual = getModeBehavior('manual');
    const assisted = getModeBehavior('assisted');
    const automatic = getModeBehavior('automatic');

    const confirmationCount = (b: typeof manual) =>
      Number(b.confirmBeforeExecute) + Number(b.confirmBeforeInsert);

    expect(confirmationCount(manual)).toBeGreaterThan(confirmationCount(assisted));
    expect(confirmationCount(assisted)).toBeGreaterThanOrEqual(confirmationCount(automatic));
  });
});

describe('labels and descriptions', () => {
  it('provides a non-empty label and description for every mode', () => {
    for (const mode of SESSION_MODES) {
      expect(getModeLabel(mode).length).toBeGreaterThan(0);
      expect(getModeDescription(mode).length).toBeGreaterThan(0);
    }
  });
});
