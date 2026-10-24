# Backend continuation — 2026-10-24

Why this: preserve GO's frontend and persistence ownership while closing an actual
backend resource-boundary gap. Continue draft PR19; no new ledger or AI service.

## Changed checklist

- [x] Recover existing PR19 source 9230ac3 and Office/device contracts.
- [x] Fix Local AI Fetch handler's 8192-byte limit: previously request.text()
  buffered the entire input; now cancel the stream immediately upon overflow.
  Node's existing bounded body reader remains unchanged. Default Pages handler
  remains disconnected; this does not enable any provider.
- [x] Red test on old handler: oversized stream was fully consumed, cancel=false.
- [x] Affected test file: 8/8 pass, including early cancellation, zero provider
  calls on rejection, exact 8192 UTF-8 bytes accepted and 8193 rejected.
- [x] Changed module syntax and git diff whitespace checks pass.
- [ ] Real device HERMES acceptance and authenticated Office integration.

Tests use synthetic local fixtures; they prove input handling, not real inference
or B2E. Unchanged broad suites were not repeated locally; normal PR CI remains.

## Current preview evidence (reported)

The existing coordination thread supersedes the earlier preview record:
https://yggmetro.slack.com/archives/C0CBVCZ1A20/p1792788010095719

Latest reported demo URL is https://16cc3eca.greenhouse-owner.pages.dev, source
9230ac3. GO's reported browser results cover Overview/Events/Detail/Local AI,
search/filter/back preserving filter, slashless 308, Demo labels and disabled APIs.
These are reported results, not newly inspected capture receipts. The previous
46316d97 preview/deployment record remains historical. ATLAS's prior tunnel
failure happened before page load and does not establish an application outage.
No network denial was retried, no preview was redeployed in this continuation.
The demo artifact excludes this privileged backend and every /api/* stays disabled.

## Office contract and exact remaining questions for GO

Existing route: GET /api/greenhouse/requests/:requestId, selected request only.
It forwards an existing authorized GO admin bearer to the fixed
https://yggmetro.com/api/v1/admin/requests/:requestId with no redirects or query.
Persistence remains ygg_requests/ygg_request_events at GO. Response allowlist:
sourceEventId, correlationId, category REQUEST_SUBMITTED, occurredAt/persistedAt,
evidence refs, evidenceScope OWNER_HTTP_READBACK, freshness UNKNOWN,
receiptStatus MISSING, execution NOT_ASSERTED. No WorkPass or receipt is issued.

GO owns the authenticated same-origin Office server adapter and display. Ask GO:
which existing adapter route/commit implements this call and which approved
Greenhouse origin will it target? Supply its redacted synthetic contract receipt
showing event ID/time/evidence equality, denied-user handling and receipt MISSING.
No new payload schema is needed for the implemented selected-request read; don't
invent a second backend or enable browser CORS while awaiting this integration.
A separate owner-approved preview/operator/synthetic-write bundle remains in
request-chain-rollout.md. None of those actions is authorized by this continuation.

## Actual local HERMES contract and missing evidence

Only owner-reported base http://localhost:8000/v1 exists. OlliteRT is the Android
runtime; HERMES-R5 is the imported model. Browser-only test explicitly selects
chat-completions compatibility and POSTs /chat/completions from that same device,
with user-confirmed protocol/model and synthetic-only consent. No server loopback
proxy, discovery, keys, durable inference queue or delivery acknowledgement exists.

Ask the device owner for the supported API protocol and exact runtime Model ID;
then capture one explicitly approved synthetic response, latency, cancel and
OlliteRT-off behavior on the device. Current mocked connector tests cannot satisfy
these checks. Missing device facts block real inference acceptance, not this fix.

## Release boundary

PR remains draft and unmerged. No deploy, settings, keys, permissions, customer
writes or production acceptance. Shop/Office frontend files are untouched. Review
this backend-only correction, resolve GO adapter/device questions, and obtain
separate action-specific approval before any deployed integration test.
