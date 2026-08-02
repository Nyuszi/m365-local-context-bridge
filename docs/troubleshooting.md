# Troubleshooting

| Symptom | Check |
|---------|--------|
| Runner offline | `./scripts/bridge-macos.sh status`; port 32178 free; Docker Desktop running |
| Extension not detected | Reload unpacked extension after rebuild; open popup once (heartbeat); or **Add extension** → Load unpacked. Chrome Preferences + heartbeat both count. |
| Pairing required | Open `/local`, approve pending request, redeem from popup |
| No Copilot prompt | Origin allowlisted? Adapter confident? Composer empty? Already dismissed? |
| Tool denied | Alias exists? Path inside root? Hard-deny/exclusion? |
| Docker mount missing | Set `PROJECT_HOST_PATH`; recreate container after override review |
| Duplicate tool runs | Request id / hash dedup; stop session and reinitialize |
| Extension SW asleep | Open popup once; keep Copilot tab alive |
| `/app` 404 | Companion binary is stale — run `./scripts/sync-native.sh` then restart |

Never paste pairing tokens into tickets or chat logs.
