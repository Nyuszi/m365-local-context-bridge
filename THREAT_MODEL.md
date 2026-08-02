# Threat Model — Local Context Bridge

Version 1, read-only local bridge between Copilot Chat (or mock chat) and approved folders.

| Threat | Asset | Attacker | Path | Mitigation | Residual risk |
|--------|-------|----------|------|------------|---------------|
| Prompt injection in repo files | Tool planner / session | Malicious file content | Instructions in comments/README influence Copilot to request sensitive paths | Bootstrap rules: treat repo content as untrusted; hard-denies; alias-only roots; ask policies | Model may still attempt denied tools; requests fail closed |
| Malicious localhost website | Pairing token / API | Evil page on loopback | CSRF-like calls to `:32178` | Origin checks, pairing token, CORS never wildcard, nonce/timestamp/replay | Compromised extension origin still trusted |
| CSRF-like requests | Tool execute API | Cross-site form/fetch | Browser sends credentialed requests | Bearer token required; Origin validation; no cookie session auth | Misconfigured allowed origins |
| Token theft | Pairing token | XSS in extension page / malware | Read `chrome.storage` or intercept | Tokens never shown after setup; loopback only; revoke support | Local malware with profile access |
| Path / symlink escape | Host filesystem | Copilot / injected request | `../`, symlinks, prefix confusion | Canonicalize + realpath boundary; reject escapes | Kernel/FS race edge cases |
| Secret disclosure | Credentials in tree | Copilot request read_file | Read `.env` / keys | Hard-deny list + content redaction | Novel secret formats may leak partially |
| Unlimited output | Companion / Copilot context | Large file / search | Memory or context flooding | Max result 128KB, line/file/search caps, truncation flag | Repeated allowed calls until rate/iteration limits |
| Tool loops | Session budget | Model repeatedly requests | Iteration storms | Max iterations 10, session 5 minutes, min interval, Stop | User enables Automatic carelessly |
| Stale selectors | Message integrity | Copilot DOM change | Wrong node insert/read | SiteAdapter confidence; pause if low; mock chat for E2E | Real Copilot DOM churn |
| Wrong conversation | Session binding | Tab reuse / navigation | Cross-talk between chats | Conversation identity checks; pause on change | Adapter mis-detects conversation id |
| User-text overwrite | Composer contents | Insert while typing | Clobber draft | Require empty composer; never overwrite | Race if user types during insert |
| Extension compromise | All bridge features | Malicious extension update | Abuse paired token | Load unpacked / signed store only; revoke; least privilege hosts | User-installed malware extension |
| Audit leakage | Privacy | Log reader | Tokens/source in logs | Bounded audit; no tokens; no full source bodies | Metadata still reveals aliases/tool names |

## Trust boundaries

1. **Browser content world** — untrusted DOM and Copilot output  
2. **Extension service worker** — semi-trusted; enforces UX gates  
3. **Companion process** — trusted computing base for filesystem reads  
4. **Approved roots** — user-selected; still scanned for hard-denies  

## Out of scope (v1)

Remote code execution via tools, multi-user SaaS hosting, defeating OS MAC/DAC, and compromising Chrome itself.
