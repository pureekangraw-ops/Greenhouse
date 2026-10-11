# PIXIE Intelligence v1 — advisory runtime extension

PIXIE Intelligence analyzes an existing delivery attempt. Xiaomi/local AI is
the primary shared inference resource for PIXIE and DWARF; LIGHT is an optional
fallback provider when local inference is unavailable, reserved, or times out.
It does not create Work, attempts, authority, checkpoints, queue messages, or
lifecycle state.
The existing PIXIE delivery runtime remains the only dispatcher and recovery
owner.

## Stages

- `ANALYZE` — summarize the attempt evidence as `FACT`, `HYPOTHESIS`, or
  `UNKNOWN`; facts must cite supplied evidence references.
- `PLAN_ROUTE` — assess only the station and operation already attached to the
  attempt using the existing `planAuthorizedRoute` capability planner when its
  read-only registry snapshot is supplied by the host. A new station or
  operation is never proposed; absent registry data returns WAIT/UNKNOWN.
- `RESOLVE` — recommend a safe next step. Ambiguous outcomes require readback;
  Intelligence cannot retry or resend.
- `EVALUATE` — separate delivery receipt, verified readback, and domain
  completion. Work lifecycle completion is always `NOT_ASSERTED`.

The model can return only an advisory recommendation. Runtime decisions are
deterministic and preserve the existing route; provider absence, timeout, or
invalid output does not block queue delivery or recovery. Provider switching
passes the same Work ID, Checkpoint, attempt, and scoped evidence; it does not
start a new Work or infer authority.

## Read-only runtime entry

The existing signed transport rail may request:

```text
POST /station/attempt/{existingAttemptId}/intelligence
{"stage":"ANALYZE|PLAN_ROUTE|RESOLVE|EVALUATE"}
```

The caller supplies no Work ID, checkpoint, evidence, route, or task prompt.
Greenhouse loads the existing attempt and sends only a bounded snapshot to the
model adapter. `workPassRef`, actor, and payload are excluded. This call does
not modify the attempt, queue, D1 row, or Work lifecycle.
The default Worker has no route-registry binding, so live route readiness stays
UNKNOWN until an existing trusted host supplies that snapshot; the model cannot
fill in the gap.

## Local-model adapter

`createLocalModelAdapter` accepts any owner-configured OpenAI-compatible
Chat Completions endpoint; it is not tied to Xiaomi or any particular device.
PIXIE and DWARF should use the same endpoint/model configuration. Adapter
instances in one Worker isolate serialize calls for the same endpoint/model,
and each inference gets a fresh, scoped request with no shared conversation
history.
The optional server-side configuration is:

- `SHARED_LOCAL_MODEL_ENDPOINT` — trusted HTTPS endpoint, or loopback HTTP for
  local development.
- `SHARED_LOCAL_MODEL_NAME` — provider model identifier.
- `SHARED_LOCAL_MODEL_API_KEY` — optional server-side secret; never sent in the
  prompt or returned to callers.

`createSharedModelRouter` tries Local first, then calls an injected LIGHT
provider on local error, timeout, or a trusted `shouldUseLocal` decision to
reserve the device. If no provider is configured it returns
`NOT_CONFIGURED`; if Local is unavailable but LIGHT is not wired it reports
`FALLBACK_UNAVAILABLE`. This repo has no DWARF runtime or live LIGHT provider
connection; both require their existing trusted host to inject the shared
router/provider, not a new authority path.

One request gets a 28-second shared-router budget (PIXIE's outer reasoning
deadline is 30 seconds): Local can use up to 20 seconds, then LIGHT receives
only the remaining budget. The Local-availability check is bounded to 1
second. Timeout aborts the provider's `AbortSignal`; timed-out results are
discarded and cannot replace a later LIGHT result. This bounds router waiting
and suppresses late responses. Stopping inference already accepted by a remote
model service still depends on that service honoring disconnect/cancellation;
that behavior is not verified here.

The local request lane is isolate-local, not a distributed lock across separate
Workers. Cross-Worker PIXIE/DWARF serialization depends on a single shared
inference service that serializes its own requests; that behavior is not proven
here. With no endpoint/model configured, Local remains disabled. The Worker
must be able to reach the configured endpoint.
Its loopback address is the Worker host, not an Android handset; a handset
requires a separately owner-approved, authenticated reachability path. Do not
expose a phone inference endpoint publicly or put model credentials in the PWA.

## Verification boundary

The local HTTP integration test uses an in-process model stub. It verifies the
OpenAI-compatible request/response contract and signed Worker → existing
attempt → adapter → response path; it is simulated protocol evidence, not proof
of a real model, Xiaomi performance, device availability, or production
acceptance. No new D1 table, Queue, Work ledger, Gate, migration, or Cloudflare
binding is introduced.