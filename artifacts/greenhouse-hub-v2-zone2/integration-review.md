# Independent Hub / GO integration review

Reviewed 2026-10-26 against `integration-patches/hub-base`, `hub-candidate`, `go-base`, `go-candidate`, their separate patches, and the actual Greenhouse MCP adapter in `greenhouse-build/src/hub/greenhouse-mcp.mjs`. This is an offline patch review, not authorization to push, merge, deploy, install bindings, refresh live catalogs, or resume queues.

## Verdict

**Spec: pass. Quality: pass for the reviewed offline Hub/GO patch proposals and updated Greenhouse interface. No outstanding findings remain in this review scope.** The previous P2 and P3 findings were corrected and the fixes independently inspected. Acceptance requires the updated Greenhouse adapter to remain part of the reviewed assembly. No authorization widening or unsafe replay was found in these patches. The current Work owner and grant verifier remain unresolved. Nothing here establishes Work lifecycle truth or makes the integration deployment ready.

The initial source-contract mismatch (GO list limit optional; Greenhouse required limit) was observed in a direct GO-to-actual-adapter probe. The Greenhouse adapter has since changed to an optional default of 30. A second direct probe passed both `{}` -> producer limit 30 and `{limit:1}` -> producer limit 1, with recent-window coverage and Hub receipt preserved. Treat the old required-limit adapter as incompatible; the Hub/GO patches alone do not repair it.

## Scoped re-review: findings resolved

**P2 resolved — malformed non-object Greenhouse result retains the exact receipt.** In `integration-patches/go-candidate/worker/hub-client.mjs:39`, an explicit Greenhouse-only check rejects null, arrays and non-object JSON values before the generic return. The catch returns `INVALID_HUB_RESPONSE` with the original `_hubReceipt`, without another relay. The new test covers array, null, string, boolean and numeric values and asserts one relay per case. Legacy non-Greenhouse result behavior is unchanged.

**P3 resolved — safe source diagnostics are retained without private content.** At `worker/hub-client.mjs:29`, the Greenhouse MCP error path parses the structured source text and returns only one of four exact codes: `READ_ARGUMENTS_INVALID`, `READ_NOT_AUTHORIZED`, `READER_UNAVAILABLE`, or `SOURCE_READBACK_REJECTED`. Unknown codes, arbitrary source text and JSON-RPC error messages become `UPSTREAM_TOOL_ERROR`; private extra fields are not copied. All these paths preserve the original receipt and do not retry. New tests cover each code, extra private data on an allowed code, unknown codes, arbitrary text, null and a private JSON-RPC error message.

**Interface compatibility confirmed within local scope.** `integration-patches/greenhouse-boundary.test.mjs` imports the actual updated Greenhouse adapter, rather than a duplicate contract. Its three recorded passing tests cover exact tool names, source read-only discovery, protocol `2025-06-18`, omitted list limit default 30, producer owner scope and recent-window coverage, exact station/operation proof, preservation of `domainCompleted:false` and unresolved Work reference, mismatched station proof rejection, denied authorization and missing reader diagnostics through GO. Hub's actual `src/protocols.js` supports and requests `2025-06-18`. The list default and result object contracts now match GO's inputs and parser.

The boundary test uses synthetic authorized rows and a stub Hub RPC boundary. It is credible local interface evidence, not a Cloudflare service-binding or deployed-authority test. This re-review makes no broader claim that arbitrary object contents are fully validated in GO; source-owned projection validation remains in Greenhouse, as designed.

Reviewed assembly SHA256:

- `go-read-only.patch`: `666c1e0d74121da4ca1f072f789f58b5b091ceb97c87ca2a4a700b29e4f02a3f`.
- `hub-read-only.patch`: `c72b44dc7989e4d9be73096c488a4149a6c5bd404d3603e93d995975f3732d06`.
- `greenhouse-build/src/hub/greenhouse-mcp.mjs`: `c9aff0e085560335c6d593ee4d4f61389a35cf6b7769f2d2593f6e1dd421b939`.

## Confirmed properties

- Hub adds only the `HubBridge.receipt(input)` delegation, existing receipt serializer export, and private exact lookup. The lookup validates exact input keys and string IDs, checks deployment-managed connector membership, reads the existing delivery row once, requires the row's tool prefix to match `connectorId + '::'`, and returns indistinguishable NOT_FOUND for missing and cross-connector rows.
- The receipt path does not call `ensure`, `syncManaged`, discovery, schema refresh, relay, or any database write. It retains the existing public receipt projection, preserves UNKNOWN, and keeps `taskSuccess:null`. Request hashes and response bodies are not exposed.
- The correct authority model is the pre-existing **trusted private HubBridge capability**, held by explicitly bound callers, plus managed connector membership. The existing ledger has no per-caller identity column. Inventing a per-caller receipt ownership check would misstate the available evidence and require a new authority contract. The GO public receipt tool remains behind the existing owner-authenticated tools/call gate. This is not multi-tenant access control and should not be described as such.
- Exactly `greenhouse_delivery_list`, `greenhouse_delivery_get`, and `greenhouse_result_get` route to the Greenhouse connector. No wildcard Greenhouse route or submit/cancel/retry surface is added. The Hub receipt tool calls receipt directly and cannot relay.
- `attemptId` matches the actual PIXIE identifier rule (alphanumeric first character; alphanumeric/dot/underscore/colon/hyphen thereafter; maximum 128). Inputs reject added authority/owner fields. Reads receive fresh Hub message IDs rather than reusing attempt IDs as delivery deduplication keys.
- The six provider routes, write requestId rule, Factory visual routing, and existing polling exclusions are unchanged. The Greenhouse-only error catch rethrows for legacy routes.
- No endpoint, origin, credential, managed connector, service binding, migration or queue setting is changed. Current checked-in Hub management configuration does not install Greenhouse. The proposal therefore depends on an explicit source/binding contract and remains unenabled.
- Updated Greenhouse source initialize is `2025-06-18`, and its result proof now checks station and operation in addition to source/attempt/Work/checkpoint/receipt/evidence. Those source changes are outside these two patches and must remain separately reviewed.

## Evidence and limitations

Reviewed complete original patch text and candidate/base differences, followed by a scoped inspection of the regenerated GO patch, actual source adapter, new tests, README and recorded red/green evidence. No candidate source files were modified. No provider mutations or live requests were made. Identical tests were not rerun in this scoped re-review. Recorded follow-up verification: GO 94/94 full suite, GO 7/7 narrow suite, actual source adapter boundary 3/3. The recorded pre-fix failures demonstrate both reviewed gaps before their corrections. Hub remains unchanged: 3/3 narrow tests; 92 passing in its full suite, with one toolchain file failing because `wrangler` is unavailable. Earlier independent direct probes established actual-adapter default-limit compatibility and reproduced the original malformed-value defect before its correction.

No full dependency-backed Hub build, workerd named-entrypoint receipt RPC test, live runtime/source equality, current release owner, binding installation, canonical Work owner, grant verifier, or deployed no-effect readback has been established. These remain review/release gates, not permission to continue upstream. User Zone 2 authorization remains Greenhouse-only.
