# macOS + Google Chrome setup

1. Start the companion:
   ```bash
   ./scripts/bridge-macos.sh start --project /absolute/path/to/project --alias my-app
   ```
2. Build the extension if needed: `cd extension && npm ci && npm run build`
3. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`
4. Open `http://127.0.0.1:32178/local` and approve pairing from the extension popup
5. Open Copilot Chat (or mock chat) and use **Start Session** from the prompt or popup

Apple Silicon and Intel are both supported (`native/macos-arm64` / `macos-x64`). No Full Disk Access, launch daemon, or notarization is required for local development.
