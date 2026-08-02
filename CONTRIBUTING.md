# Contributing / local development

## Layout

| Path | Purpose |
|------|---------|
| `extension/` | Chrome MV3 extension — load **`extension/dist`** in Chrome |
| `companion/` | .NET 8 companion + `/app` + `/setup` (`wwwroot/bridge`) |
| `native/macos-app/` | Bridge.app launcher scripts |
| `scripts/` | `sync-native.sh`, `bridge-macos.sh`, tests |
| `docs/` | Deeper docs |

Published binaries (`native/macos-arm64/`, `packaging/out/`) are **gitignored** — build them locally.

## Build & run (macOS Apple Silicon)

```bash
# Extension + companion + optional .app
./scripts/sync-native.sh --app

# Or without rebuilding the .app:
./scripts/sync-native.sh
./scripts/bridge-macos.sh start --quiet
open http://127.0.0.1:32178/app
```

App bundle: `packaging/out/Local Context Bridge.app`

## Extension

Pinned id: `cbpoofaeifiplkedkndehafpnghoalce`

After rebuilding `extension/dist`, click **Reload** on `chrome://extensions`.

## URLs

| URL | Role |
|-----|------|
| `/app` | Status, previous sessions, START |
| `/setup` | First-run setup |
| `/mock-chat/` | Offline protocol test UI |
| `/local` | Advanced pairing / roots |

## Tests

```bash
./scripts/test-all.sh
```
