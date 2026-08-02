import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BackgroundBroadcast,
  PairingProgress,
  PopupStateSnapshot,
  UiToBackgroundMessage,
  UiToBackgroundResponse,
} from '../background/messages';

function isBroadcast(message: unknown): message is BackgroundBroadcast {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith('broadcast/')
  );
}

export async function sendUi<M extends UiToBackgroundMessage>(
  message: M,
): Promise<UiToBackgroundResponse<M['type']>> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (
    response &&
    typeof response === 'object' &&
    'error' in response &&
    (response as { error?: string }).error
  ) {
    throw new Error((response as { error: string }).error);
  }
  return response as UiToBackgroundResponse<M['type']>;
}

export interface UseBackgroundStateResult {
  state: PopupStateSnapshot | null;
  loading: boolean;
  error: string | null;
  pairingProgress: PairingProgress | null;
  refresh: () => void;
}

/** Shared background-state polling/subscription hook used by both the popup and the options page. */
export function useBackgroundState(): UseBackgroundStateResult {
  const [state, setState] = useState<PopupStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pairingProgress, setPairingProgress] = useState<PairingProgress | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    setLoading(true);
    sendUi({ type: 'ui/get-state' })
      .then((snapshot) => {
        if (!mounted.current) return;
        setState(snapshot);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load state.');
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();

    const listener = (message: unknown): void => {
      if (!isBroadcast(message)) return;
      if (message.type === 'broadcast/state-changed') refresh();
      if (message.type === 'broadcast/pairing-progress') {
        setPairingProgress(message.progress);
        if (message.progress.status === 'done' || message.progress.status === 'error') refresh();
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    return () => {
      mounted.current = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  return { state, loading, error, pairingProgress, refresh };
}
