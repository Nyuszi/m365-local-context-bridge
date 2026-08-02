import type { SiteAdapter } from '../adapters/types';

export interface MessageWatcherHandle {
  /** Force an immediate (debounced) re-check, e.g. right after attaching. */
  check: () => void;
  dispose: () => void;
}

export interface MessageWatcherOptions {
  /** How long a message's text/streaming-state must stay unchanged before it is considered final. */
  stableMs: number;
  onFinalMessage: (text: string, element: Element) => void;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

/**
 * Watches the most recent assistant message inside `container` and invokes
 * `onFinalMessage` once, each time that message's text settles (no DOM
 * mutations for `stableMs`) while the adapter no longer reports it as
 * streaming. Only the latest message is considered — this bridge only ever
 * needs to react to the newest assistant reply in the active conversation.
 */
export function watchAssistantMessages(
  adapter: SiteAdapter,
  container: Element,
  options: MessageWatcherOptions,
): MessageWatcherHandle {
  const finalized = new WeakMap<Element, string>();
  const scheduleTimeout = options.setTimeoutImpl ?? setTimeout;
  const cancelTimeout = options.clearTimeoutImpl ?? clearTimeout;
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;

  function evaluate(): void {
    debounceHandle = null;
    const messages = adapter.getAssistantMessageElements(container);
    const last = messages[messages.length - 1];
    if (!last) return;

    if (adapter.isMessageStreaming(last)) {
      schedule();
      return;
    }

    const text = adapter.getMessageText(last);
    if (finalized.get(last) === text) return;
    finalized.set(last, text);
    options.onFinalMessage(text, last);
  }

  function schedule(): void {
    if (debounceHandle !== null) cancelTimeout(debounceHandle);
    debounceHandle = scheduleTimeout(evaluate, options.stableMs);
  }

  const observer = new MutationObserver(() => schedule());
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  schedule();

  return {
    check: schedule,
    dispose: () => {
      observer.disconnect();
      if (debounceHandle !== null) cancelTimeout(debounceHandle);
    },
  };
}
