# Zone 2 independent product/spec review

Reviewed the current uncommitted implementation against `Unified-Work-Tool-Plan.md`, task briefs/reports and the assembled review package, then inspected the current files in `greenhouse-build`. Base: PR19 `5d3646e8bd40b44320854851d0e26aca4bb05ab0`. No product files edited. The full suite was not rerun; the reported 152-test result remains implementation evidence, not an independent run. Three small direct Node probes independently reproduced the empty exact lookup, duplicate tracking identity and ambiguous MCP lookup findings below.

Initial verdict: sound scope and useful integration ports; changes were requested for I1–I4. The final scoped re-review below supersedes this initial verdict. Deliberately unconfigured owner readers/Pages503 are correct for the approved scope, not defects.

## Important findings

### I1 — Empty authorized exact lookup retains the previously displayed private item

- Paths: `src/greenhouse/tracking-read.mjs:57-59`; `greenhouse/workspace-model.mjs:41-45`; `greenhouse/workspace.mjs:43-45`.
- The adapter accepts `get()` returning an authorized envelope with `items:[]` and emits HTTP200. That is the natural source-scoped result after a row disappears or stops being readable. UI exact acceptance requires exactly one item, so it throws `TRACKING_INVALID` without HTTP404. The catch takes the stale-result branch and retains the old title/details/references.
- Independently reproduced: exact GET with an empty scoped reader returned 200 and an empty v1 envelope; `acceptTracking(body, ref)` rejected it. The UI catch demonstrably only purges HTTP401/403/404.
- Fix: define an exact missing-item contract (prefer HTTP404 with a fixed non-disclosing code) after scope/envelope validation, and make the UI purge on that defined outcome. Preserve transient-outage stale behavior separately.
- Regression: previously loaded item, producer returns an empty exact result, then verify old item is removed from list and detail DOM. Include actual HTTP adapter-to-browser behavior, not only a helper test.

### I2 — Retained request-reader form bypasses revocation clearing

- Path: `greenhouse/workspace.mjs:52-55`.
- The detail refresh path clears the exact item on 401/403/404, but resubmitting the retained request lookup form does not. A successful request lookup adds an item to `liveItems`; returning to the list and re-reading that same ID after revocation throws a generic error and changes only `#read-message`. The previously loaded request remains selectable, including its evidence. This is an alternate supported UI path around the new clearing behavior.
- Fix: retain the response status and clear the previously loaded matching BUSINESS_REQUEST record on verified denial/not-found. Match the existing request reader's source namespace exactly, or keep a request-read identity mapping. Avoid clearing an unrelated item with the same unqualified ID. Session-wide401 semantics should explicitly decide whether all session-bound content must be cleared.
- Regression: successful request form lookup, back, same request lookup returns401/403/404, verify private request text/evidence no longer appears or can be reopened; a different typed namespace remains intact when the denial is item-scoped.

### I3 — MCP exact lookup loses source namespace

- Path: `src/hub/greenhouse-mcp.mjs:7,18,37,41,49-51`.
- Authorization accepts multiple source systems, and list returns sourceSystem on every row. Exact delivery/result tools accept only attemptId; the source reader receives no requested namespace, and validation checks only membership in the entire scope plus attemptId. Two authorized source systems may both contain `a1`. Either row then satisfies an exact lookup, so a caller cannot select the item it saw in the list, and a result proof can be exact for the wrong intended source.
- Independently reproduced: a two-source scope and a reader returning the second source's `a1` produces a successful exact response. There is no argument to ask for the first source.
- Fix: either add a required sourceSystem to exact tool schemas, scope-check it and verify the returned source, or explicitly enforce a single-source MCP scope before source access. The latter preserves the planned attemptId-only tool interface while making its uniqueness assumption enforceable. Do not merely document globally unique IDs while allowing arbitrary producer IDs and multi-source scopes.
- Regression: same attemptId in two authorized namespaces; exact reads must select the requested namespace or reject the ambiguous scope before reader access, including result reads.

### I4 — Duplicate canonical identities are accepted and make list selection ambiguous

- Paths: `src/greenhouse/tracking-read.mjs:57-59`; `greenhouse/workspace-model.mjs:41-45`; `greenhouse/workspace.mjs:28,44`.
- List validation bounds row count but never checks uniqueness of the canonical `(sourceSystem, resourceType, resourceId)` tuple. Two rows with the same tuple and different titles/states become two visible buttons with the same selection key. Clicking the second renders the first matching item; refresh replaces both. This breaks the intended exact item/list relationship even though different namespaces are correctly preserved.
- Independently reproduced: two rows with the same ref and different titles return HTTP200 unchanged.
- Fix: reject the complete malformed list on duplicate canonical keys, unless a separately specified deterministic source-owned merge exists. Fail-closed rejection is the smallest appropriate change here. Keep same-ID rows from different namespaces distinct. Apply the equivalent uniqueness rule to MCP list output within its defined namespace contract.
- Regression: two same-key conflicting rows rejected; same ID in different namespaces still valid; list click opens the exact rendered item.

## Minor findings / verification follow-up

1. Parent reports the local actual-Node-API browser script passed360px portrait,768px and1440px, same-ID namespace selection, back behavior, revoked401 purge, no overflow and no uncaught errors. This is parent-provided verification evidence. The script also checks typing/filter persistence and no unexpected mutation. It does not yet establish the plan's mobile landscape, enlarged font, keyboard-only selection/back, scroll restoration or minimum44px measured hit targets. Add focused checks or mark these acceptance items unverified; do not claim the entire mobile acceptance matrix from viewport-only success.
2. New browser/build-demo packaging changes were in progress while this review ran. Recheck the generated demo artifacts and syntax/test command inclusion after the fix wave. The reviewer did not independently execute the browser or inspect rendered screenshots; parent is addressing missing Thai glyph support in the default Linux font environment.

## Compliance and delivered value

- Reuses the PR19 HTML/module shell and preserves request lookup, diagnostics and optional synthetic AI in secondary views. Primary tracking is one typed list/detail flow, LIVE by default, explicit DEMO, GET-only, and honest recent-window coverage.
- The HTTP adapter actually uses verified session injection, rejects caller scope parameters, performs bounded projection and exact namespace checks, strips raw payload/WorkPass fields, and retains unknown source timestamps. Node routes exercise a real local HTTP server in existing tests. Pages remains explicitly503 until trusted entrypoint wiring exists.
- MCP is an actual callable read-only adapter with authorization-before-read, bounded projection, no mutation tools, and exact multi-field source proof checking for results. It is not installed as a runtime transport. I3 limits the current multi-source exactness claim.
- Receipt/transport acceptance does not become Work completion; execution success is separately labeled, and domainCompleted:false is not synthesized into failure. There is no new Work authority, ledger, queue activation or arbitrary evidence URL fetch.
- Recovery change conservatively holds post-dispatch uncertainty and rejects mismatched attempt proof before accepting evidence. The separate recovery review owns deeper recovery verification; no conflicting behavior found in this assembly review.
- The honest deliverable is a local, testable shell and injected read/projection/MCP/recovery implementation, ready for a subsequent owner-authorized integration step after fixes. It does not yet provide live Work inventory, authorized result opening, deployed MCP transport, artifact-byte verification or production list→dispatch→result proof. Those limits are accurately documented and are consistent with the current authorization boundary.

## Suggested single fix wave

Adapter owner: I1/I3/I4 and their source-contract tests. UI owner: I2 and endpoint-to-UI regression for I1/I4. Parent: focused mobile verification/explicit residual limitations and final packaging checks. Rerun the affected tests first; after assembly, one full suite/static/build check and final review of the changed boundaries is sufficient.


## Final scoped re-review — I1–I4 fix wave

Reviewed `zone2-final-fix-report.md`, `zone2-final-fix-review-package.txt`, current affected product/test files and current demo builder against the original findings. No identical full-suite rerun; reported evidence is162/162 full suite,32/32 affected tests, and14/14 UI tests after the copy-only success-message edit.

| Finding | Disposition | Evidence inspected |
|---|---|---|
| I1 exact empty read | Addressed | Validated empty exact responses now404; malformed/wrong-owner envelopes remain502; actual Node HTTP→UI-model regression and parent real-browser empty-read purge pass. |
| I2 request form revocation | Addressed | Successful request lookup records its exact typed ref;401/403/404 re-submit removes that ref, clears rendered details, and invalidates selected pending detail refresh. Real workspace event-handler tests verify all three statuses and preserve a same-ID namespace neighbor;502 is explicitly stale. |
| I3 MCP namespace ambiguity | Addressed | Authorizer must narrow to exactly one source before any list/get/result reader or resolver is reached. JSDoc explains the attemptId-only constraint. Multi-source rejection tests assert zero source/proof accesses. HTTP/UI remains multi-source with typed refs. |
| I4 duplicate identities | Addressed | HTTP projection, UI acceptance and MCP list each reject the complete duplicate-key result. Same-ID different tracking namespaces remain valid. |

No unresolved Critical or Important finding in the scoped fix wave. One new Minor functional regression was independently reproduced: submit a request lookup, switch LIVE→DEMO→LIVE before it settles, then let the old read finish. `readSequence` changes, so the new guarded `finally` does not re-enable `#read-request`; the mode-change handler resets only `#tracking-refresh`. The request reader remains disabled until reload. Reset request-read busy state when mode changes while preserving generation guards, and cover a deferred read mode round trip. Parent notified with the concrete result `requestButtonDisabledAfterModeRoundtrip:true`.

The parent reports expanded local actual-HTTP/browser checks passing360×800,800×360 landscape,768 and1440 with Thai font fixture, no overflow/errors, exact namespace selection/back, all401/403/404 request purges, exact empty404 purge and44px refresh target. These are local synthetic-source checks, not live owner or production verification. Enlarged-font behavior, a full keyboard-only traversal and measured scroll restoration were not separately established by the evidence reviewed here.

Demo packaging inspection found no new concrete breakage in the scoped changes: startup is explicitly DEMO, the live option is removed, data APIs are blocked by the existing fetch guard, required DOM IDs remain present, and the retained device inference path still requires its explicit synthetic consent. Parent reports the existing demo routing test passing. The reviewer did not independently render the generated demo.

The deliverable remains usable code and tested integration ports within the approved boundary; no live owner source, deployed MCP transport, result-byte verification, authority changes or production E2E success is claimed.


### Final closure after Minor follow-up

**Final verdict: I1–I4 and the new Minor request-button regression are addressed. No unresolved Critical, Important or concrete Minor defect remains from this scoped review.**

Source recheck confirms the mode-change handler now resets `#read-request.disabled=false` when it advances the read generation, while completion/finally remains generation-guarded. The added real-workspace deferred-fetch regression verifies the LIVE→DEMO→LIVE transition, the ability to start a new lookup, rejection of the obsolete result, and that old cleanup cannot release a newer pending request. The reported focused UI result is15/15 plus syntax pass; no redundant full-suite run was performed by this reviewer. Parent final suite/browser/demo verification is underway and remains separate evidence.

The preceding Minor paragraph records the original reproduced issue and is superseded by this closure. Residual verification/production limits remain as stated above; approval of this local code scope does not assert live integration or deployment success.
