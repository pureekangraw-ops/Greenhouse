# Greenhouse Coordination v1 — design contract (Draft)

Status: DESIGN ONLY. No live wiring, no deployment, no authority change.

## Existing foundation
- Reuse `pureekangraw-ops/Greenhouse` main scaffold and existing `contracts/report-contract.json`.
- PR #1 contains Genome/Lyra cores; Draft PR #2 and Draft PR #3 both target the PR #1 branch and contain overlapping read-only Metropolis adapters. Review/deduplicate before integration; do not merge either blindly.
- Metropolis remains the connection/access/authority boundary. The existing Work System owns Work identity, lifecycle, and continuity; Greenhouse is an interface and coordination consumer, never a second Work ledger.
- PIXIE is technical knowledge and creation/modification lineage, not a Work Lifecycle controller or executor. Do not assign it lifecycle transitions without an existing, verified contract.
- CITY HALL owns intake/return and records/data handling; HERMES and MIMIR retain their existing intake and return/indexing roles.

## Surfaces
1. **Subdomain SDK/widget**: optional authenticated owner-side panel; public pages can emit only allowlisted business events via their own server-side boundary. No privileged tokens in browser JavaScript.
2. **Greenhouse mobile**: start with installable PWA for Owner Inbox, alerts, read-only work detail and remote requests. Native Android only if device features require it.
3. **Greenhouse backend adapter**: server-side identity/session, event delivery, read projection and command submission through existing GO HUB authorized interfaces. No direct mutation of HERMES/MIMIR or Owner Source.

## Event envelope (proposal)
```json
{
  "schemaVersion":"greenhouse.event.v1",
  "eventId":"opaque-unique-id",
  "source":"shop|office|other-registered-subdomain",
  "eventType":"allowlisted.type",
  "occurredAt":"ISO-8601",
  "receivedAt":"ISO-8601",
  "correlationId":"opaque-id",
  "workId":null,
  "checkpointId":null,
  "payloadRef":"restricted-reference",
  "classification":"PUBLIC|INTERNAL|RESTRICTED"
}
```
- Events are immutable; store delivery attempts separately.
- Deduplicate on (source,eventId). Preserve source event time, receive time, and source provenance.
- Events do not themselves create Work or grant Work read rights.
- Validate signatures/service identity, allowed origin/source, payload size, schema version and retention before accepting.

## Owner remote command request (proposal)
```json
{
  "schemaVersion":"greenhouse.command.v1",
  "commandId":"opaque-unique-id",
  "idempotencyKey":"stable-retry-key",
  "actor":"authenticated-owner",
  "target":"existing-hub-operation",
  "workId":"existing-authorized-work-id",
  "checkpointId":"existing-checkpoint-id",
  "intent":"explicit-owner-approved-action",
  "requestedAt":"ISO-8601",
  "expectedVersion":"optional-concurrency-token"
}
```
- Backend MUST verify owner authentication, operation-level authorization, WorkContext, CSRF/session protection and auditability before forwarding.
- Only existing HUB operations; never synthesize station/authority/Work ID.
- Command state: REQUESTED -> ACCEPTED/REJECTED -> EXECUTING -> SUCCEEDED/FAILED/UNKNOWN. A receipt is not execution success.
- Fail closed on expired authorization, mismatched WorkContext, stale evidence or unknown response. Never auto-retry non-idempotent actions.
- High-impact operations (cancel, deploy, merge, secrets) require explicit owner confirmation and operation-specific permissions; do not expose as generic commands.

## Readback and notifications
- Reuse report contract's freshness, confidence, evidence, observedAt, ownerSource, limitations.
- Display OWNER SOURCE verified execution separately from transport ACK and HUB Work lifecycle.
- Mobile inbox must support reconnect and replay from cursor, deduplication, unread state and restricted-content redaction.
- No claims of live updates until delivery, offline replay and actual device tests pass.

## Acceptance gates
1. Review PR #1-3, select one Metropolis read adapter, test read-only Work with an authorized existing Work ID.
2. Prove one subdomain event -> validated HUB receipt -> Greenhouse inbox -> replay after reconnect.
3. Prove one permitted owner command -> HUB audit -> station receipt -> Owner Source readback; prove duplicate submit creates one command.
4. Test revoked permissions, stale WorkContext, malformed payload, spoofed origin, offline replay, and partial failure.
5. Separate approvals for production authentication, rollout, and any future native application.

## Non-goals
No new OAuth authority, no direct browser secrets, no new HUB ledger, no PR merge/deploy, no Observatory work.
