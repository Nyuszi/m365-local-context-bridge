/**
 * The three session modes a user can pick from the popup's session
 * controller (see README.md "Start Session"). They only affect how much
 * confirmation is required around executing a detected tool request and
 * inserting/submitting its result — they never change what a tool is
 * allowed to do (that is enforced entirely by the companion).
 */
export const SESSION_MODES = ['manual', 'assisted', 'automatic'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export interface ModeBehavior {
  /** Ask the user before sending the request to the companion at all. */
  confirmBeforeExecute: boolean;
  /** Ask the user again, after a result comes back, before inserting it into the composer. */
  confirmBeforeInsert: boolean;
  /** Once the result is inserted into the composer, submit it automatically. */
  autoSubmitAfterInsert: boolean;
}

const BEHAVIORS: Record<SessionMode, ModeBehavior> = {
  manual: {
    confirmBeforeExecute: true,
    confirmBeforeInsert: true,
    autoSubmitAfterInsert: false,
  },
  assisted: {
    confirmBeforeExecute: true,
    confirmBeforeInsert: false,
    autoSubmitAfterInsert: true,
  },
  automatic: {
    confirmBeforeExecute: false,
    confirmBeforeInsert: false,
    autoSubmitAfterInsert: true,
  },
};

export function isSessionMode(value: unknown): value is SessionMode {
  return typeof value === 'string' && (SESSION_MODES as readonly string[]).includes(value);
}

export function getModeBehavior(mode: SessionMode): ModeBehavior {
  return BEHAVIORS[mode];
}

const LABELS: Record<SessionMode, string> = {
  manual: 'Manual',
  assisted: 'Assisted',
  automatic: 'Automatic',
};

const DESCRIPTIONS: Record<SessionMode, string> = {
  manual: 'You approve every tool run and every result before it is inserted or sent.',
  assisted: 'You approve each tool run; results are inserted and sent automatically.',
  automatic:
    'Tool runs, insertion, and sending all happen automatically within the session limits. Choose “Always allow” on a Run prompt to switch here.',
};

export function getModeLabel(mode: SessionMode): string {
  return LABELS[mode];
}

export function getModeDescription(mode: SessionMode): string {
  return DESCRIPTIONS[mode];
}
