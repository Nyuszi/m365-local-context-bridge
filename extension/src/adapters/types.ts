/**
 * Every piece of DOM access the extension performs on a host page goes
 * through a SiteAdapter. Never query or mutate chat page DOM outside an
 * adapter implementation — that boundary is what lets low-confidence sites
 * (like an unrecognized Copilot UI revision) safely disable themselves
 * instead of guessing.
 */
export interface SiteAdapter {
  readonly id: string;
  readonly displayName: string;

  /** Cheap URL-only check used to pick a candidate adapter for the current page. */
  matchesUrl(url: string): boolean;

  /**
   * DOM-based confidence score in [0, 1] that this adapter's assumptions
   * about the page's structure currently hold. Computed fresh (not cached)
   * since a page's markup can change after client-side navigation.
   */
  computeConfidence(doc: Document): number;

  getMessageContainer(doc: Document): Element | null;
  getAssistantMessageElements(container: Element): Element[];
  getMessageText(el: Element): string;
  isMessageStreaming(el: Element): boolean;

  getComposer(doc: Document): HTMLElement | null;
  setComposerText(composer: HTMLElement, text: string): void;
  submit(doc: Document, composer: HTMLElement): boolean;
  /**
   * Optional: insert text and keep retrying send until the host UI accepts it
   * (needed for Lexical editors that enable Send asynchronously).
   */
  insertAndSubmit?(composer: HTMLElement, text: string): Promise<boolean>;

  getConversationId(doc: Document): string | null;

  /** Best-effort rename of the current chat title (Copilot UI). */
  setConversationTitle?(doc: Document, title: string): boolean;
}

export const MIN_USABLE_CONFIDENCE = 0.6;

export function isAdapterUsable(adapter: SiteAdapter, doc: Document): boolean {
  return adapter.computeConfidence(doc) >= MIN_USABLE_CONFIDENCE;
}

/** Returns the first matching element for the first selector that finds one, or null. */
export function queryFirst<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector<T>(selector);
      if (el) return el;
    } catch {
      // Malformed selector for this browser; skip it rather than throwing.
    }
  }
  return null;
}

function isLikelyVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.getClientRects().length === 0) return false;
  const view = el.ownerDocument.defaultView;
  if (!view) return true;
  const style = view.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

/**
 * Like queryFirst, but prefers elements that currently occupy layout space.
 * Falls back to the first match if nothing visible is found (SPA may still be mounting).
 */
export function queryFirstVisible<T extends Element = Element>(
  root: ParentNode,
  selectors: readonly string[],
): T | null {
  for (const selector of selectors) {
    try {
      const nodes = root.querySelectorAll<T>(selector);
      for (const el of Array.from(nodes)) {
        if (isLikelyVisible(el)) return el;
      }
    } catch {
      // Malformed selector for this browser; skip it rather than throwing.
    }
  }
  return queryFirst(root, selectors);
}

/** Fraction of the given selector groups that find at least one match under root, in [0, 1]. */
export function fractionFound(
  root: ParentNode,
  selectorGroups: readonly (readonly string[])[],
): number {
  if (selectorGroups.length === 0) return 0;
  let found = 0;
  for (const group of selectorGroups) {
    if (queryFirst(root, group) !== null) found += 1;
  }
  return found / selectorGroups.length;
}
