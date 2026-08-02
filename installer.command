#!/bin/bash
# Double-click this file in Finder to install Local Context Bridge into /Applications.
cd "$(dirname "$0")" || exit 1
chmod +x ./scripts/install-macos-app.sh 2>/dev/null || true
./scripts/install-macos-app.sh
echo ""
echo "Press Enter to close…"
read -r _
