# Greenhouse Owner Inbox v1 — implementation boundary

## Delivered in this candidate

- Installable PWA shell at `/greenhouse/`; only the static shell is cached for offline startup.
- Private `/api/*` responses are never service-worker cached and use `Cache-Control: no-store`.
- Signed, versioned event-envelope validation with per-source secret, event-type allowlist, five-minute replay window, strict size/schema checks, server-assigned `receivedAt`, and no event payload body.
- Event forwarding is through an injected existing-Hub sink only. The idempotency key is `(source,eventId)`; the Hub must own deduplication and return its receipt. Greenhouse does not persist a second event/Work ledger.
- Owner inbox is a read-only projection delegated to an injected owner-session resolver and existing-Hub reader.
- Command request validation is restricted to existing Hub work operations. Submission additionally requires same-origin + CSRF token, owner session, exact Work/checkpoint/operation authorization from the existing Hub authorizer, and its receipt. A receipt is explicitly not execution success.
- Missing owner or Hub adapters fail closed. No external credential, local fake Work, or mock receipt is embedded.

## Local verification

```bash
npm run check
npm test
npm run evaluate:agents
npm run preview
```

Open `http://127.0.0.1:4173/greenhouse/`. Without owner-authorized adapters, the page deliberately shows no live work data. The service worker caches only HTML/CSS/JS/manifest/icon for the offline shell.

## Current status

**CONFIRMED:** static PWA shell, signed event validation, backend fail-closed routes, and tests are implemented in this candidate.

**UNKNOWN / NOT CONNECTED:** production owner login/session, authorized inbox projection, registered source credentials, existing-Hub event sink, exact operation-level permission adapter, live event replay receipt, real owner WorkContext, and device/offline E2E. The local Greenhouse runtime does not construct those adapters or write data.

**NOT DONE:** merge, deployment, production credentials, or Observatory changes.

## Required owner integration before calling this live

1. Owner selects the existing authentication/session mechanism and approves its connection; the server must provide an authenticated actor and CSRF token without exposing credentials to browser storage.
2. Connect `inboxReader`, `hubEventSink`, `commandAuthorizer`, and `hubCommandSubmitter` to documented existing Hub operations. The Hub remains the sole Work/event receipt authority and enforces atomic dedupe and permission checks.
3. Register each approved source, event types, classification policy, secret rotation, retention, and payload-reference access. Keep secrets server-side; never put private payloads in event envelopes.
4. Test the real path: source signature → Hub receipt → inbox/replay; authorized owner command → WorkContext/permission check → Hub receipt → owner-source readback. Test duplicates, expired signatures, revoked permission, wrong Work/checkpoint, offline recovery, and partial failure.
5. Obtain separate approval for production rollout. A green local test suite is not production authorization.

Do not treat the separate Office read adapter as the Greenhouse inbox connection. Do not create Work or infer owner execution from a delivery receipt.
