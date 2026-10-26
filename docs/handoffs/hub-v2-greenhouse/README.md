# Hub / GO read-only integration patch proposals

Prepared 2026-10-26. Offline candidates only; nothing pushed, merged, deployed, bound or enabled. No Greenhouse/shared source was edited.

## Exact source bases

- Hub canonical GitLab `pureekangraw/hubstation`, branch `go/work-hub-provider-capability-20261026`, `e4d7a9c1898f62858cde5bdb957fdc6c8612b111`.
- GO GitHub `pureekangraw-ops/Go-Together`, branch `go/work-provider-actions-20261026`, `d5ba9dd20a0c0967d922c1b01fa6bfa9c00eb745`.
- Hub's checked-in `releases/go-provider-candidate.json` pins this exact GO SHA. Read both current branch pointers and exact trees. Neither inspected tree contains AGENTS.md. All locally materialized base files match their Git blob hashes. `source-manifest.json` also records SHA256 of those files.
- These are newer provider-aware release sources, not the older main branches in the initial audit. Their equality to current deployed runtime is **unverified**. No deployment-ready claim is made.

## Separate reviewable patches

`hub-read-only.patch` changes three source files plus one new test. `HubBridge.receipt({connectorId,messageId})` performs one exact read from existing Store.receipt. It validates strings/IDs, denies unmanaged connector scopes, and returns NOT_FOUND for absent or cross-connector rows. It uses the existing public receipt serialization; no request hash or body is returned. It does not run managed configuration sync, discovery, schema refresh, relay or a state update. Transport UNKNOWN remains UNKNOWN and taskSuccess remains null.

Authorization is the existing private HubBridge capability held by explicitly bound trusted callers, plus deployment-declared managed connector scope. There is no caller/tenant column in the existing delivery ledger. This proposal **does not** invent per-record caller ownership, provide multi-tenant authorization, or add a public HTTP receipt endpoint. Caller identity expansion would need a separately reviewed owner contract and migration. GO's public tool keeps its existing owner authentication.

`go-read-only.patch` adds exactly the three proposed Greenhouse read tools and `hub_delivery_receipt`, with readOnlyHint. It routes only the three exact Greenhouse tool names through existing HUB_V2 and validates their bounded inputs before relay. attemptId uses the actual PIXIE regex `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, maximum128. List limit is optional integer1..30. Unknown fields are denied. Each read gets a fresh Hub message identity. The exact Hub receipt tool calls the new receipt RPC directly, never relay. A malformed Greenhouse response preserves the Hub receipt in a structured error with no retry. Existing six-provider writes, required requestId behavior, Factory visual routes and status polling remain unchanged.

There is no Greenhouse GO AppTools source entrypoint: Greenhouse remains its own source. No managed connector, endpoint, origin, credential, service binding or queue configuration is added by either patch. Consequently Greenhouse tools will fail closed until the owning rooms explicitly complete the source/binding contract.

## Verification and evidence

- `hub-red.txt`, `go-red.txt`: observed initial failures for absent features. `hub-validation-red.txt`: observed numeric-ID validation gap, then fixed.
- `hub-green.txt`: 3/3 new Hub tests pass against real production SQL in SQLite. Includes exact scope, redaction, immutable state, no connector registration/network, malformed/type/extra-field denial.
- `go-green.txt`: 7/7 new tests pass. Includes public catalog, owner gate, fresh read IDs, no relay for invalid inputs, receipt-only lookup, malformed response receipt preservation, actual PIXIE ID boundary.
- `go-baseline-suite.txt`: 87/87 existing GO tests pass. `go-suite.txt`: 94/94 candidate tests pass, including the existing provider, Factory, routing, auth and OAuth cases. Command: `cd go-candidate && node --test tests/*.test.mjs`.
- `hub-suite.txt`: full `npm test` now passes **94/94**, including pinned Wrangler vendor patch/integrity tests. The earlier missing-Wrangler environment blocker is resolved through exact package-lock installation. `hub-check.txt` and `hub-build.txt` show successful check and local dry-run build; no workerd/cross-worker runtime acceptance is claimed.
- Both patches pass `git apply --check` against their exact isolated base directories.

To rerun narrow tests: `node --test hub-candidate/test/receipt-read.test.js` and `node --test go-candidate/tests/greenhouse-read.test.mjs`. Hub candidate now has its own exact package-lock dependencies installed using `npm ci --no-audit --no-fund`; its unchanged postinstall verified the pinned supplier patch. Do not deploy the candidate directory directly.

## Remaining gates

Independent review; current release owner and active-runtime/source equality confirmation; exact Greenhouse source MCP adapter/read authorization; owner-approved connector binding/configuration; real named-entrypoint RPC test; no-effect deployed acceptance if later authorized. Work owner/grant verifier remains unresolved. No submit, cancel, retry, queue resume or new authority is exposed here.

## Review fixes and actual adapter contract check

Review follow-up adds an explicit four-code allowlist for structured Greenhouse MCP errors: READ_ARGUMENTS_INVALID, READ_NOT_AUTHORIZED, READER_UNAVAILABLE and SOURCE_READBACK_REJECTED. Only the exact JSON object code becomes status; arbitrary text, JSON-RPC messages, unknown codes and all extra/private fields are omitted. Every error retains the exact Hub receipt, with no retry. Greenhouse successful content must decode to an object; arrays, null and primitive JSON are rejected as INVALID_HUB_RESPONSE with the receipt. Existing provider behavior is unchanged.

`go-safe-errors-red.txt` and `go-domain-shape-red.txt` record observed failures before these fixes. New test coverage includes the four exact codes, private fields accompanying allowed codes, unknown/private text, JSON-RPC private messages, and five invalid domain shapes.

`greenhouse-boundary.test.mjs` imports the actual separately owned `greenhouse-build/src/hub/greenhouse-mcp.mjs` candidate. Three tests pass (`greenhouse-boundary-output.txt`): exact tool names/read-only discovery/protocol2025-06-18; optional list default30 and owner-scoped coverage; station/operation-correlated result with domainCompleted:false; mismatched station proof safely rejected; actual authorization and missing-reader safe error codes preserved through GO. This is a local MCP/GO contract integration test using synthetic authorized reader data and a stub Hub RPC boundary. It does not prove named service bindings, Hub discovery approval, Cloudflare runtime or live authorization.

GO full suite after fixes: **94/94 pass**. Narrow GO suite:7/7; actual adapter boundary suite:3/3. Hub patch unchanged from the previously reported verification. Both patches still pass exact-base application checks. Independent review of these follow-up fixes remains required before promotion.

## Hub toolchain verification completed

Installed exact declared dependencies locally with `npm ci --no-audit --no-fund` (62 packages). Wrangler4.152.0 and Undici7.30.1 are exact locked versions. The project's unchanged postinstall applied and verified its SHA-pinned Wrangler supplier remediation. No integrity bypass, version override or source modification was used.

- Install/postinstall: `hub-install.txt`, exit0.
- Full Hub tests: `npm test`, **94/94 passed**, `hub-suite.txt`, exit0.
- Required check: `npm run check`, pinned remediation plus syntax checks passed, `hub-check.txt`, exit0.
- Local build: `npm run build` invoked precisely `wrangler deploy --dry-run --outdir dist`, exit0, `hub-build.txt`. Output ends `--dry-run: exiting now.` Bundle184.71KiB/gzip45.56KiB. This compiled existing configuration; it did not deploy or change any binding, secret, database, queue or environment.

An existing proxy configuration warning and npm's unknown http-proxy environment configuration warning appeared; no checks were disabled. Both source patches and package/lock/vendor-patch sources remain unchanged by dependency setup/build. Runtime-source equality, real named-entrypoint RPC integration and live acceptance remain unverified.
