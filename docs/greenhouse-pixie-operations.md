# Greenhouse + PIXIE work conveyor

Work continuity: WORK-190aa284-e3aa-4de9-90fd-d33c290ef236 (existing Hall Work; no replacement Work created).

## Ownership remains unchanged

- Metropolis City Hall owns Work IDs / lifecycle and supplies the authorized Work context.
- Greenhouse owns operational event projections and the transport journal only.
- PIXIE owns durable delivery attempts, retries and Queue progress, not business completion.
- The destination (Factory/Observatory) owns execution truth and source evidence.

## Files

- src/greenhouse/state-intelligence.mjs: validates journal events and interprets Hall, PIXIE and Tool lanes without conflating completion.
- src/pixie/delivery-runtime.mjs: idempotent intake, atomic consumer claim, ambiguous-outcome handling, verified readback and outbox recovery.
- src/pixie/d1-store.mjs + migrations/001–003: adapter and additive migration for existing pixie_deliveries and pixie_delivery_events (no duplicate tables).
- src/pixie/transport-worker.mjs: signed existing City-to-Greenhouse transport boundary, intake/health/readback endpoints and Queue consumer.
- test/state-intelligence.test.mjs, test/pixie-runtime.test.mjs, test/pixie-worker.test.mjs: negative and acceptance tests.

## Routing and security

Work ID is correlation, not a credential. A City-authorized and HMAC-signed service request carries Work ID, checkpoint, existing Work Pass reference, target station and operation. The HMAC is a server-to-server transit ticket, not another user login. No ChatGPT access token is reused as a service token.

The Worker defaults to NOT_READY if D1, Queue, City rail secret or an existing approved route dispatcher is missing. The dispatcher is deliberately injectable; do not invent an endpoint to Factory or Observatory or claim tool execution merely from transport acceptance. Exact destination readback must match Work and checkpoint.

## Durable operations

Persist attempt first, then enqueue. A queue-send failure remains in D1 as WAITING_QUEUE and can be recovered. Concurrent delivery messages use a compare-and-swap claim; if dispatch outcome is uncertain, the attempt becomes OUTCOME_UNKNOWN and **must not be blindly repeated**. A verified readback requires matching original Work and checkpoint, receipt and evidence. Hall completion is separate.

## Production route

Metro authenticates the existing Work and enqueues a City-approved delivery through its
GREENHOUSE_TRANSPORT binding. Greenhouse persists the full cargo and sends only an attempt
pointer on pixie-delivery-v1. The consumer calls Metro's private METROPOLIS_SERVICE binding;
Metro rechecks current Work permission and calls the existing Factory V2 adapter or Observatory
snapshot reader. Factory traffic uses Metro's FACTORY_SERVICE binding, keeping its existing HMAC
and preflight validation. The Work/checkpoint are never recreated.

`metropolis_work` handoff returns a Job ID and queue status immediately. Factory jobs use the
existing Factory station/operation. Observatory jobs use OBSERVATORY_STATION / observe with
payload.view=browser or map on an OBSERVATORY Work with existing READ and handoff permission.
An unsupported browser command is denied. GO and LIGHT use the same per-Work policy.

The consumer records the correlated owner receipt and evidence, then marks READBACK_VERIFIED.
This proves delivery/readback, not domain completion or Hall completion. Metro refuses station
RETURN while a delivery is pending. Observatory needs a paired device and a fresh capture;
missing/stale captures remain WAITING_ROUTE with their actual reason.

Recovery runs every two minutes. Proven not-sent attempts retry at most five times, using the
same attempt ID. Ambiguous results query only the City's saved receipt; they never trigger a
second execution. The existing dead-letter queue retains queue failures. Original coarse status
CHECK values remain compatible: delivery_state stores the precise conveyor state on the same row.
Journal ordering uses insertion order so same-millisecond transitions remain ordered.

Run npm test and npm run check before deployment. pixie-d1.test.mjs uses real SQLite with the
production legacy CHECK constraint and migrations, not a mock store. Apply migrations once after
inspecting current columns. wrangler.jsonc contains the existing D1/Queues and service bindings;
rail secrets stay on the Workers. Production proof must be read back from both the owner and D1.

### Why this is not a new gate

The boundary verifies the existing City's signed delivery. It neither creates a new identity issuer nor grants any fresh Work permission. Route selection uses existing capability/capacity snapshots and refuses unknown alternate routes.

## 2026-10-10 source discovery

Live PIXIE_DB already contains pixie_deliveries and pixie_delivery_events with zero rows at inspection time. Therefore the adapter was changed to extend/reuse those tables; do not create pixie_attempts or a parallel journal. This avoids two conflicting operational truths.
