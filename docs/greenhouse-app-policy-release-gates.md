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
