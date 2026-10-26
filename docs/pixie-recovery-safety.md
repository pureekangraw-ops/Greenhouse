# PIXIE recovery safety contract

`ACCEPTED` and `OUTCOME_UNKNOWN` hold the original attempt until correlated verified owner readback. Recovery cannot move either state to `WAITING_ROUTE` or `QUEUED` on a missing readback route, an unavailable reader, an unverified response, or `notSent: true`. A readback transport reporting that its own request was not sent does not establish whether the original dispatch executed.

No authoritative original-no-effect attestation contract exists. All post-dispatch requeue from these states is denied, including a plain no-send claim that appears authoritative. This can leave an attempt held indefinitely while its owner is unavailable. Selective replay requires a separately defined and reviewed owner attestation contract; no such proof is invented here.

Initial dispatch still distinguishes a known pre-dispatch no-send response. That attempt may enter `WAITING_ROUTE` and use the existing retry limit. Pending outbox recovery, atomic dispatch claims, duplicate intake, collision rejection and duplicate queue consumption retain their existing behavior.

Recovery continues to call the existing `recordReadback` boundary for verified receipts. Its Work ID, checkpoint, receipt (when already accepted), evidence and state checks still apply. A readback response that explicitly names another attempt is rejected before recovery supplies the requested attempt ID. Existing adapter responses that omit attempt ID continue to be scoped by the requested attempt and existing proof checks. This is correlation checking inside the existing authorized port, not a new verifier or permission grant. `domainCompleted` remains distinct from delivery verification; generic delivery status and business Work lifecycle ownership are unchanged.

## Regression evidence

All stores, credentials, queues and receiver effects in `test/pixie-recovery-safety.test.mjs` are synthetic. The missing-binding regression invokes the actual `existingCityDispatch({}, '/station/readback')` adapter, without network or live service bindings.

Before the fix, both `ACCEPTED` and `OUTCOME_UNKNOWN` regressions reported `afterRecovery: QUEUED`, `queuedAgain: 1`, and `executions: 2` against an expected single execution. The six expanded safety tests failed on the baseline. After the fix, both original regressions preserve their original state, queue zero additional messages and execute exactly once. Additional cases cover repeated missing/unverified/throwing readback, duplicate reads/intake/consume, mismatched Work/checkpoint/attempt/receipt, invalid evidence and later matching authorized owner readback.

The old test named `City proof of no send recovers the same uncertain job without inventing an attempt` was first run unchanged after the fix. It failed explicitly because it expected `QUEUED` and two queue messages, while the runtime preserved `OUTCOME_UNKNOWN`. It is now renamed `readback notSent keeps the same uncertain job held for verified evidence` and asserts the new hold contract and original single queue message; it is neither skipped nor hidden.

Run: `node --test test/pixie-runtime.test.mjs test/pixie-recovery-safety.test.mjs`. Result: 19 passed, zero failures or skips. These are isolated runtime tests; they do not claim deployed behavior, production reconciliation, or activation of any queue.
