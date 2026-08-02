import { CopilotChatAdapter } from './copilot-chat-adapter';
import { MockChatAdapter } from './mock-chat-adapter';
import type { SiteAdapter } from './types';

export * from './types';
export { MockChatAdapter } from './mock-chat-adapter';
export { CopilotChatAdapter } from './copilot-chat-adapter';

/** Order matters only in the (impossible in practice) case multiple adapters match the same URL. */
export const ADAPTERS: readonly SiteAdapter[] = [new MockChatAdapter(), new CopilotChatAdapter()];

export function selectAdapter(url: string): SiteAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matchesUrl(url)) ?? null;
}
