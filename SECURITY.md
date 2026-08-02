# Security Policy — Local Context Bridge

## Security model

Local Context Bridge treats Copilot output, web content, repository content, filenames, comments, and tool parameters as **untrusted**. The companion is the authoritative security boundary.

## Non-negotiable controls

- No shell endpoint; no `cmd.exe`, PowerShell, bash, `eval`, or AI-selected executables
- No file writes, deletes, moves, patches, PRs, commits, builds, tests-as-tools, package installs, database access, or external API calls in v1
- Paths are canonicalized; absolute/UNC/URI/null-byte/traversal/symlink escapes are rejected
- Boundary checks are not simple string prefixes
- Native mode binds to `127.0.0.1` only
- Docker publishes only `127.0.0.1:32178:32178`; no privileged mode, host network, or Docker socket
- Cryptographically strong pairing; origin validation; strict CORS (never `*`)
- Nonce, timestamp window, replay prevention, size/timeout/concurrency/iteration/rate limits
- Secrets redacted; tokens and full source bodies never logged
- Fail closed; emergency Stop

## Hard-denied paths

Inside approved roots, credential-like files remain denied, including: `.env*`, private keys, `*.pfx`/`*.p12`/`*.pem`/`*.key`, SSH keys, `.npmrc`, `.pypirc`, `local.settings.json`, Terraform state, kubeconfig, cloud credential files, and browser profiles.

High-volume directories are excluded from search/listing by default: `.git`, `node_modules`, `bin`, `obj`, `dist`, `build`, `coverage`, `target`, `vendor`, `.idea`, `.vs`, `TestResults`.

## Reporting

Report suspected vulnerabilities privately to your security contact. Do not file public issues that include tokens, source excerpts with secrets, or exploit PoCs against production tenants.

## Corporate policy

This tool does not bypass administrator controls, DLP, or enterprise browser policy. Deploy via approved channels when required.
