const NATIVE_HOST = 'com.localcontextbridge.host';

export interface NativeHostResponse {
  ok: boolean;
  reachable?: boolean;
  message?: string;
  error?: string;
}

/**
 * Talk to the optional Native Messaging host that can start/stop the local
 * companion. Returns null when the host is not installed.
 */
export async function sendNativeHost(
  message: Record<string, unknown>,
): Promise<NativeHostResponse | null> {
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    return await new Promise<NativeHostResponse | null>((resolve) => {
      let settled = false;
      const finish = (value: NativeHostResponse | null) => {
        if (settled) return;
        settled = true;
        try {
          port.disconnect();
        } catch {
          /* ignore */
        }
        resolve(value);
      };
      port.onMessage.addListener((msg: unknown) => {
        finish((msg ?? { ok: false }) as NativeHostResponse);
      });
      port.onDisconnect.addListener(() => {
        finish(null);
      });
      try {
        port.postMessage(message);
      } catch {
        finish(null);
      }
      setTimeout(() => finish(null), 20_000);
    });
  } catch {
    return null;
  }
}

export function nativeHostInstallCommand(extensionId: string): string {
  return `Open the Local Context Bridge.app (or: ./scripts/bridge-macos.sh install-host --extension-id ${extensionId})`;
}

export function bridgeAppHint(): string {
  return 'Open Local Context Bridge.app to install the companion launcher (no Terminal needed).';
}
