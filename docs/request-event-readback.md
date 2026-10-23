# Request submission readback — local evidence only

This bounded ATLAS slice adds a Greenhouse metadata adapter and preserves source
references through the existing Office-facing `/api/greenhouse/inbox` endpoint.
It neither creates a request ledger nor changes GO's producer. It is not a live
Hub event sink, a Work/Receipt creator, an AI queue, or B2E production PASS.

## Storage ownership and scope

Inspected Greenhouse main `6c1ab79d5ce7c4cc3ca458271fc8617df5435381` and open
PRs #2, #3, #4, #6, #7, #8 and #16 before implementation. Those cover Work read
adapters, design/UI, PIXIE transport or training; this does not extend them.

GO owns `yggmetro-web/src/request-workflow.js`,
`migrations/0002_request_workflow.sql`, and `REQUESTS_DB=pantheon-workhub`.
The inspected checkout was `6e24fb3fe8453fe269b853848c002fba394affd9`.
Submission already commits the request CAS update, STATUS event and system
message in a D1 batch. The event's primary key is the producer mutation UUID.
Greenhouse must not append a second submission or assign a Work ID.

**No migration or live storage binding is introduced.** The adapter uses only
`prepare().bind().first()/all()` against the existing tables. An owner-approved
read interface and real auth are still needed before production integration.
The current adapter deliberately requires `evidenceScope: 'LOCAL_TEST'`.

Consequently the tested sequence is owner submission → existing transaction
persistence → signed notification validation → provenance verification and
redacted Office readback. Persistence precedes notification; this is not proof
of a new Greenhouse ingestion write or durable delivery acknowledgement.
A valid notification for a missing source event fails with 409. Every accepted
notification returns `duplicate: true`: the source event already exists, even
on the first notification. No delivery-attempt ledger is claimed.

## Minimal GO producer/readback handoff

After the existing confirm transaction succeeds, an eventual server-side GO
producer can use the **actual persisted** STATUS/DRAFT/SUBMITTED row:

```js
{
  schemaVersion: 'greenhouse.event.v1',
  source: 'shop', // must match the injected authorized source registry
  eventId: row.event_id,
  eventType: 'request.submitted',
  occurredAt: row.timestamp,
  correlationId: row.request_id,
  payloadRef: 'ygg_request_events:' + row.event_id,
  classification: 'INTERNAL'
}
```

Use existing `signGreenhouseEvent(rawBody, timestamp, secret)` and
`x-greenhouse-timestamp` / `x-greenhouse-signature` headers on
`POST /api/greenhouse/events`. Do not send raw brief/messages, customer IDs,
Work IDs, checkpoints, a browser secret or invented receipts. Registry and
session provisioning are outside this PR; no secrets are supplied or changed.

The local harness injects `createRequestEventReadback({db, source: 'shop',
evidenceScope: 'LOCAL_TEST', authorize})` through the existing `hubEventSink`
and `inboxReader` parameters, plus `allowLocalEventEvidence: true`. The latter
is off by default; normal Hub receipt validation remains unchanged. `authorize`
must explicitly grant the server-resolved actor access to the full request
submission inbox; presence of an actor alone is insufficient. The test uses a
synthetic actor and synthetic credential only.

Read `GET /api/greenhouse/inbox` through the existing owner session boundary.
Items expose `sourceEventId`, `correlationId`, deterministic
`category: REQUEST_SUBMITTED`, source `occurredAt`/`persistedAt`, evidence
references and `receiptStatus: MISSING`. `persistedAt` is the producer event
transaction timestamp, not independent storage-engine commit telemetry.
`observedAt` on the item is source time; top-level `observedAt` is read time.
`freshness: UNKNOWN` avoids claiming old events are fresh. The adapter projects
only allowlisted metadata; it never fetches briefs or customer identity fields.
Offset pagination is bounded at 100; concurrent inserts can shift pages, so
this is not a durable pull/claim/lease/ack protocol.

This read model can later appear alongside the ten-repository workspace tools
in one Office dashboard while runtimes and owner authority stay separate.
No frontend/dashboard or additional services are implemented here.

## Executable evidence

Run `node --test test/request-event-readback.test.mjs` (Node 22.13+ / 24).
The test-only `node:sqlite` D1 shim executes a frozen copy of the real producer
and exact existing migration against a temporary file. Its producer process
exits before Greenhouse starts. Greenhouse opens that file **read-only**, then
stops; a fresh process opens it again. No network connection to D1 occurs.

Fixture copies are test contracts, not a forked application or runtime:

| Fixture | Original | SHA-256 |
| --- | --- | --- |
| producer.mjs | src/request-workflow.js | 8aada4143751a114aac882d828835f4fdb2617b99367b5e910ac4ebff1cc7f28 |
| schema.sql | migrations/0002_request_workflow.sql | 20327350840780ea4fba77b9a30f5efa0301b6f3a4a590521aa93c60e4d560e1 |

| Check | Result |
| --- | --- |
| Functional red against main server | fails: inbox sourceEventId is undefined |
| Existing producer create + confirm + replay | one persisted source event |
| 24 concurrent signed notification replays | same event; no extra row/readback item |
| Actual producer exit and Greenhouse process restart | same event ID, category, timestamps and evidence |
| AI disabled | submission and readback pass, no inference needed |
| Malformed body, invalid signature, unregistered source | rejected before sink |
| Signed wrong ID/request/timestamp/Work/payload reference | 409 provenance mismatch |
| Missing session / denied reader | fail closed |
| Private fields / oversized evidence | stripped / rejected |
| Local result without explicit opt-in | rejected as invalid Hub receipt |
| Storage failure | no fabricated evidence |
| Full regression | 104 tests pass; 16/16 offline drills; syntax check passes |

The test prints a fresh synthetic event ID and restart/concurrency evidence on
each run. No deployed behavior, production D1 durability, real OAuth, live sink,
real customer data or live AI has been tested. Historical transport deliveries
and the deleted Metropolis service configuration are untouched.
