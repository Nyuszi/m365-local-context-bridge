# Pairing

1. Companion starts unpaired (or with revoked tokens).
2. Extension calls `POST /pairing/request` with installation id and origin.
3. Local UI at `/local` shows a pending approval (one-time code).
4. User approves locally; extension calls `POST /pairing/redeem`.
5. Extension stores the bearer token; it is **never displayed again**.
6. `POST` revoke from the local UI invalidates tokens immediately.

Protected APIs require `Authorization: Bearer …`, valid `Origin`, timestamp, nonce, and pass replay checks.
