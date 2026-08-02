# Local Context Bridge

Give **Microsoft 365 Copilot** read-only access to folders you approve on your Mac.

Everything runs **locally** except Copilot itself in Chrome.

---

## Install (macOS) — 3 steps

### 1. Start the app

Double-click **`Local Context Bridge.app`**.

- First run opens setup.
- Later runs open the status window (`/app`).

> Build the app once from this repo (Apple Silicon):  
> `./scripts/sync-native.sh --app`  
> then open `packaging/out/Local Context Bridge.app`

### 2. Add the Chrome extension (once)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Choose the folder: **`extension/dist`**

(You can also use **Add extension** in the Bridge app — it points you here.)

### 3. Start a session

In the Bridge app:

1. Choose a **folder**
2. Pick a **mode** (Assisted is fine)
3. Click **START**

Copilot opens, the bridge pastes a short setup message, then you chat as usual.

---

## After that

| Do this | How |
|--------|-----|
| Open the app again | Double-click **Local Context Bridge.app** |
| Resume a chat | `/app` → **Previous sessions** → **Open** |
| New chat | `/app` → folder + mode → **START** |
| Reload extension after updates | `chrome://extensions` → Reload on Local Context Bridge |

---

## What stays private

- Companion listens only on `127.0.0.1:32178`
- Tools are **read-only** (list / search / read files)
- Only folders you approve are visible
- Copilot never gets raw disk paths — only project aliases

---

## Repo layout

| Path | What it is |
|------|------------|
| `extension/` | Chrome extension (load `extension/dist`) |
| `companion/` | Local .NET companion + `/app` + `/setup` UI |
| `native/macos-app/` | macOS `.app` launcher sources |
| `scripts/` | Build / start helpers |
| `docs/` | Architecture & troubleshooting |

Developers: see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Docs

| Doc | Topic |
|-----|--------|
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues |
| [SECURITY.md](SECURITY.md) | Security |
| [LICENSE](LICENSE) | MIT |

---

## License

[MIT](LICENSE)
