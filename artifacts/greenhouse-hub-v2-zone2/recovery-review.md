# Independent Zone 2 recovery review

Spec compliance verdict: PASS by source inspection. Quality verdict: APPROVE for the scoped conservative recovery change. No blocking or non-blocking defect findings in the reviewed patch.

Reviewed the recovery brief, review package, final Zone 2 report, original missing-readback reproducer, the four scoped changed/new files in `greenhouse-build`, and the existing City transport and D1 store implementation. Other concurrent working-tree changes were outside this review.

## Why the safety change addresses the reported bug

- `/workspace/scratch/c5c4676b4fce/greenhouse-build/src/pixie/delivery-runtime.mjs:101`: recovery no longer promotes a held ACCEPTED or OUTCOME_UNKNOWN attempt to WAITING_ROUTE/QUEUED on `notSent`. The existing adapter's missing-binding result describes the readback request, so removing that branch removes the causal path from missing local readback transport to another original dispatch.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/src/pixie/delivery-runtime.mjs:105`: an explicit foreign attempt ID is rejected before supplying the requested attempt ID. Existing Work/checkpoint correlation, accepted receipt equality, nonblank receipt/evidence, verified flag and state checks remain in `recordReadback` at lines 75–90. No new owner verifier or no-effect proof is invented. Omitted attempt IDs deliberately retain the existing request-scoped adapter contract, as the final documentation states.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/src/pixie/delivery-runtime.mjs:48`: known initial no-send behavior remains available in consume, and pending/WAITING_ROUTE recovery and the retry ceiling are unchanged. Intake dedup/collision and consumer claim logic are also unchanged.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/src/pixie/d1-store.mjs:28`: the production store uses an atomic UPDATE constrained by attempt identity and prior state. The dispatch claim's false-result guard and readback's false-result error therefore have meaningful production semantics; the new in-memory stores model that condition rather than returning unconditional success.

## Tests and documentation assessment

- `/workspace/scratch/c5c4676b4fce/greenhouse-build/test/pixie-recovery-safety.test.mjs:9`: both original held states use the actual `existingCityDispatch({}, '/station/readback')` adapter, count synthetic original effects, drain any accidentally requeued message and assert one execution, no requeue, and no forbidden state transition. This tests the real fault mechanism rather than replacing it with a favorable mock.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/test/pixie-recovery-safety.test.mjs:71`: repeated recovery, duplicate intake/consume and reads preserve records, queue and effect counts; mismatched proofs leave holds intact; later direct authorized readback succeeds. Existing runtime coverage also exercises successful readback through recovery.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/test/pixie-runtime.test.mjs:122`: the legacy QUEUED/two-message assertion is explicitly renamed and changed to the new hold contract, with an explanatory comment. It is not skipped or removed. The existing initial no-send retry test remains present at line 105.
- `/workspace/scratch/c5c4676b4fce/greenhouse-build/docs/pixie-recovery-safety.md`: accurately documents indefinite hold, the omitted-ID compatibility choice, original assertion incompatibility and local verification boundary. It does not claim runtime activation or Work completion.

The implementer report records baseline failures (2 executions instead of 1), six baseline invariant failures, the unchanged legacy expectation's intermediate failure, then 19 targeted tests passed with no skips. I inspected the code and assertions independently; I did not rerun the already reported identical tests, per review scope. This review does not independently attest those test executions or the full-suite result. Full-suite verification remains with the parent after parallel changes stabilize.

## Findings and limits

Severity findings: none in scope. No runtime/provider changes were made by this review.

The conservative contract can leave accepted/uncertain attempts held indefinitely without owner evidence. Receipt authenticity remains a responsibility of the existing authorized owner/City boundary; a `verified` boolean is not a newly introduced cryptographic verifier. These are explicit design limits, not hidden implementation regressions. Synthetic tests and static review establish local behavior only, not deployed end-to-end delivery.
