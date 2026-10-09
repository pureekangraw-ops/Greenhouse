# Greenhouse — app policy and release gates (candidate)

Status: **DRAFT / not approved for production**. This is a verification checklist synthesized from existing repository contracts, **not** a claim that an authoritative city-wide app policy has been retrieved or approved.

## Role and authority
- Greenhouse is the owner-facing technical/build inbox and a readback/projection surface, **not** the owner of Work, event ledger, identity, or release authority.
- Metropolis / existing Hub station is the transport/authorization boundary. No new independent OAuth client, Work ID, checkpoint authority, route, source-of-truth ledger, or fake receipt.
- Use only documented existing owner-authorized interfaces; do not treat a ChatGPT plugin's session/token as a deployable Greenhouse credential.
- A valid receipt means accepted/delivered, **not** owner-source execution success. Verify readback from the source.
- Missing authentication, permission, WorkContext, registered source, signed event, or Hub adapter => fail closed, never fake connected/live data.

## Security and data
- Existing owner login/consent and server-side session. No OAuth secrets or access tokens in browser storage, PWA cache, source code, or GitHub commits.
- Readback requires actor authorization and correct WorkContext as defined by the owner operation. Commands additionally require exact operation permission, CSRF and idempotency.
- Cache only public static PWA shell; never cache `/api/*`, private Work details, responses, or tokens.
- Source event registration must define source owner, allowed event types, classification, signature secret rotation, retention, and payload-reference policy.
- Respect existing owner-source authority and auditable receipts; do not silently mutate owner data.

## Release gates (all must be proven before production)
| Gate | Evidence required | Current result |
|---|---|---|
| G1: PWA shell/manifest/service worker | HTTPS installability and offline-shell-only cache on real Android | PARTIAL — code exists; device/HTTPS unverified |
| G2: CI/unit/policy checks | Green GitHub Actions at PR head | PASS — PR #6 run 37911750592 (2026-10-09); recheck after changes |
| G3: Existing owner login | Authorized login/callback, revocation, server session, CSRF | BLOCKED — adapters absent |
| G4: Hub inbox readback | Owner-authorized WorkContext; correct provenance/freshness; no fabricated rows | BLOCKED — inbox reader absent |
| G5: Event source → Hub receipt → replay | Registered source, signed envelope, dedupe and real Hub receipt | BLOCKED — event sink/registration absent |
| G6: Command authorization → receipt → source readback | Explicit owner-approved operations, CSRF, replay and wrong-work denial | BLOCKED — command adapters absent |
| G7: Public runtime security | Production-safe host/origin, HTTPS, auth boundaries, secrets, rate limits, logs | BLOCKED — server currently localhost-only |
| G8: Owner production approval | Explicit release authorization after live E2E | NOT GIVEN |

## Sequence
1. Confirm app-specific policy with the authoritative city registry/owner; reconcile conflicts before changing authority boundaries.
2. Map existing Metropolis OAuth/session and documented Hub read/event/command interfaces; **do not invent endpoints**.
3. Implement production runtime and owner-authorized adapters in a separate reviewed change; preserve fail-closed behavior.
4. Run CI, negative security tests, real Hub end-to-end readback, HTTPS PWA installation and offline tests on Android.
5. Obtain explicit owner approval **before** merge/deploy/production exposure.

## Change boundary
This PR only introduces an optional install button and Thai browser installation guidance. It does not authorize deployment, create a Worker, enable remote commands, or claim real inbox integration. Observatory and other apps are out of scope.

## 2026-10-09 live Metropolis discovery (GO)

- Verified station arrival: Metropolis release `1.0.0`, source SHA `092274f87033db7476477e756febe9206689a055`; schema refresh on arrival.
- Existing station declares `metropolis_hermes_read` (read-only existing Work by workId), `metropolis_work` (read/handoff/return/cancel/complete) and `metropolis_reception`. These are **ChatGPT connection capabilities**, not automatically callable Greenhouse backend endpoints.
- GO arrival returned existing authorized Work pointers and Work Pass permissions. This proves the connected GO identity can discover/read selected Work, **not** that Greenhouse has an OAuth session or an authorized inbox/list operation.
- **Gap:** no Greenhouse-specific inbox-list, event-ingress or command-submission API contract was established from station discovery. Do not repurpose privileged `metropolis_work` actions as Greenhouse commands without documented operation permissions and owner approval.
- **Next verification:** request owner-approved server OAuth integration, document the exact Hub read contract, and prove a single read-only Work readback with actor/WorkContext/provenance before adding event/command routes.
- **Fallback if no list endpoint exists:** support an owner-authorized exact Work ID lookup first; do not fabricate a global inbox by scraping station Work pointers.

## Execution ownership and anti-drop checklist

| Phase | Dependency | Owner | Exit evidence | If blocked |
|---|---|---|---|---|
| Identity | Existing owner OAuth flow and server-side session | Identity owner + GO | Authorized login, revoke and CSRF tests | Keep PWA disconnected; do not copy ChatGPT token |
| Read-only proof | Authorized Hub Work read contract | Hub owner + GO | One existing Work with provenance, actor and fresh readback | Exact Work ID lookup only if contract permits |
| Inbox | Authorized list/cursor contract | Hub owner + GO | Real rows, pagination, permission denial, no stale data | Explicitly show unavailable; no fake rows |
| Events | Source registry, signed ingress and Hub receipt | Source owner + Hub + GO | Signature, dedupe, real receipt and replay | Disable event ingress |
| Commands | Operation authorization and idempotent Hub submission | Hub owner + GO | Deny wrong Work/Checkpoint, receipt plus owner-source readback | Disable remote commands |
| Runtime | Approved host, HTTPS, secrets and security controls | Deployment owner + GO | Live E2E, Android install/offline test | Keep local preview only |
| Release | Owner approval and rollback plan | Owner + release operator | Signed-off gates G1–G8 | No merge/deploy |

A green CI alone never closes an integration gate. Track each phase as PASS / BLOCKED / UNKNOWN with links to actual proof; do not advance by assumption.

## Read-only source proof — 2026-10-09

- GO called the existing `metropolis_hermes_read` station tool on an existing Work for which the arrival station advertised `read` permission.
- The source returned a `WORK_RECORD`, matching `workId` and `checkpointId`, `ownerSystem: GO`, Work state `HANDED_OFF`, and source-side evidence/receipt references.
- This **passes the station-side read proof only**. It does not prove Greenhouse server OAuth, an authorized Inbox list, a Greenhouse readback API, or owner-source execution completion.
- The Work is a pre-existing factory training Work, **not** a Greenhouse Work; do not mutate it or claim it is Greenhouse's production acceptance test.
- Release gates G3–G8 remain blocked pending their independent evidence.

### No-drop execution rules
- Each phase must have an evidence artifact and a named blocking dependency. CI success only satisfies G2.
- Continue independent code/test work while waiting for auth/Hub interface approval; never silently substitute fake tokens or fixtures for live proof.
- Never merge/deploy solely from a generic authorization to develop: verify rollout origin, secrets, real Android install, rollback, and release approval at the actual boundary.
