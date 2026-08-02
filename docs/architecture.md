# Architecture

## Components

1. **Browser extension (MV3)** — service worker, content script, popup, options. Detects Copilot/mock pages, manages sessions, parses tool fences, talks to the companion.
2. **Companion (.NET 8)** — loopback HTTP API, pairing, approved roots, path security, read-only tools, local management UI, mock chat static files.
3. **Shared schemas** — JSON Schema for `local-tool-request` / `local-tool-result`.
4. **Launch scripts / Docker** — one-command start; Docker Desktop sidecar with hardened Compose.

## Data flow

```
Copilot/Mock DOM
  → content script (SiteAdapter + MutationObserver)
  → service worker (session, modes, dedup)
  → HTTP 127.0.0.1:32178 (Bearer + nonce + timestamp)
  → companion validates + PathSecurity
  → read-only tool result (relative paths only)
  → insert ```local-tool-result into composer
```

## Site adapters

All DOM access goes through `SiteAdapter`. `MockChatAdapter` is high-confidence for E2E. `CopilotChatAdapter` uses ARIA/semantic selectors and a confidence score; low confidence blocks prompts and insertion.

## Service worker lifecycle

Assume the worker can terminate. Session state lives in `chrome.storage.session` / `local`. On wake, reconcile unprocessed assistant messages using request IDs and SHA-256 payload hashes. Do not use WebRTC/audio keep-alives.

## Chrome limitations

Discarded or sleeping tabs may pause observers. Users should keep the Copilot tab open. Documented as a product limitation, not a silent failure — sessions pause when the tab is gone.
