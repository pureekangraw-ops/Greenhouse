# Greenhouse + PIXIE operations — implementation slice

Work continuity: WORK-190aa284-e3aa-4de9-90fd-d33c290ef236 (existing Hall Work; no replacement Work created).

## Ownership remains unchanged

- Metropolis City Hall owns Work IDs / lifecycle and supplies the authorized Work context.
- Greenhouse owns operational event projections and the transport journal only.
- PIXIE owns durable delivery attempts, retries and Queue progress, not business completion.
- The destination (Factory/Observatory) owns execution truth and source evidence.

## Files

- src/greenhouse/state-intelligence.mjs: validates journal events and interprets Hall, PIXIE and Tool lanes without conflating completion.
- src/pixie/delivery-runtime.mjs: idempotent intake, atomic consumer claim, ambiguous-outcome handling, verified readback and outbox recovery.
- src/pixie/d1-store.mjs + migrations/001_pixie_operations.sql: durable attempts and SQL-triggered state journal.
- src/pixie/transport-worker.mjs: signed existing City-to-Greenhouse transport boundary, intake/health/readback endpoints and Queue consumer.
- test/state-intelligence.test.mjs, test/pixie-runtime.test.mjs, test/pixie-worker.test.mjs: negative and acceptance tests.

## Routing and security

Work ID is correlation, not a credential. A City-authorized and HMAC-signed service request carries Work ID, checkpoint, existing Work Pass reference, target station and operation. The HMAC is a server-to-server transit ticket, not another user login. No ChatGPT access token is reused as a service token.

The Worker defaults to NOT_READY if D1, Queue, City rail secret or an existing approved route dispatcher is missing. The dispatcher is deliberately injectable; do not invent an endpoint to Factory or Observatory or claim tool execution merely from transport acceptance. Exact destination readback must match Work and checkpoint.

## Durable operations

Persist attempt first, then enqueue. A queue-send failure remains in D1 as WAITING_QUEUE and can be recovered. Concurrent delivery messages use a compare-and-swap claim; if dispatch outcome is uncertain, the attempt becomes OUTCOME_UNKNOWN and **must not be blindly repeated**. A verified readback requires matching original Work and checkpoint, receipt and evidence. Hall completion is separate.

## Activation boundary

1. Run the Node test suite and SQL migration tests.
2. Review existing Metropolis-to-Greenhouse rail contract; bind only an approved service dispatcher and server-side rail secret.
3. Apply the D1 migration to the existing PIXIE_DB database and attach the existing pixie-delivery-v1 Queue consumer in the controlled rollout.
4. Verify one authorized end-to-end Work intake, duplicate receipt, destination readback and failure recovery.
5. Only then report live READY. No automatic production merge/deploy from this draft slice.

### Why this is not a new gate

The boundary verifies the existing City's signed delivery. It neither creates a new identity issuer nor grants any fresh Work permission. Route selection uses existing capability/capacity snapshots and refuses unknown alternate routes.
