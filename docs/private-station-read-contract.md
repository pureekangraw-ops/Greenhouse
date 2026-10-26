# Greenhouse private station delivery read

This source adds a dormant `GreenhouseRead` named Cloudflare Worker entrypoint. Its only application interface is `fetch(Request)`, using MCP JSON-RPC POST at `https://greenhouse.internal/mcp`. The default transport Worker does not expose MCP. No binding, grant, credential, public route, queue or production deployment is installed by this change.

## Authority and scope

An explicitly authorized private Service Binding must target Worker `greenhouse-transport`, entrypoint `GreenhouseRead`. The source deployment must also declare `GREENHOUSE_STATION_READ=PRIVATE_SERVICE_BINDING`; the repository deliberately does not set this value. A declaration alone cannot reach the private entrypoint. Only trusted callers whose existing owner gate is appropriate for **all station delivery rows** may hold the binding. The source does not accept a caller-supplied owner ID, actor, Work Pass or bearer as authority.

PIXIE has no per-record owner/tenant column. The returned scope is `{kind:"STATION",stationId:"GREENHOUSE_STATION"}`; the `stationId` on each delivery separately identifies its destination. The adapter projects only the attached PIXIE ledger with source namespace `greenhouse`. It never maps transport `actor` to record ownership, never claims user isolation, and never treats station authority as Work access. Existing externally supplied owner-scoped MCP adapters retain their contract.

Historical Metropolis documentation describes Work arrival/grants, but does not establish a current live Work owner. `workRef.resolution` remains `UNRESOLVED`. Delivery acceptance/readback does not prove Work lifecycle or business completion. Result reads remain `UNAVAILABLE` until independent source-owned result evidence can be verified.

## MCP contract

Protocol `2025-06-18`. Initialize and tool discovery require no storage reads. All tools have read-only annotations, reject extra fields, and use JSON-RPC IDs from the request.

| Tool | Arguments | Output |
| --- | --- | --- |
| `greenhouse_delivery_list` | `limit` optional integer 1–30, default 30 | Explicit station scope, `coverage:{kind:"RECENT_WINDOW",complete:false,total:null}`, bounded recent items |
| `greenhouse_delivery_get` | Required `attemptId` | Exact delivery projection, or scoped `availability:"NOT_FOUND"` |
| `greenhouse_result_get` | Required `attemptId` | Scoped `availability:"UNAVAILABLE"` for an existing attempt; `NOT_FOUND` for an exact miss |

Attempt IDs match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Delivery fields are sourceSystem, attemptId, unresolved workRef, checkpointId, destination stationId, operation, precise delivery state, receivedAt, readbackAt, receiptRef and evidenceRef. Payload, Work Pass, actor, reason, retry counters and business-completion claims are excluded from SELECT and output.

MCP tool errors use HTTP200 and `result.isError:true`: undeclared source authority → `READ_NOT_AUTHORIZED`; absent DB → `READER_UNAVAILABLE`; malformed/unavailable source read → `SOURCE_READBACK_REJECTED`; invalid tool arguments → `READ_ARGUMENTS_INVALID`. No partial projection is returned on malformed source data. HTTP envelope errors: unknown path404, non-POST405, query400, body exceeding16384bytes413, invalid JSON400. Responses have `cache-control:no-store`. Initialized notifications return202 with no body.

## Delivery boundary

The Hub may install a dormant adapter to its private `GREENHOUSE_READ` binding. It must rewrite to the fixed internal MCP URL, strip caller credentials, retain its existing owner gate, and fail closed without an installed binding/approved connector. Public HTTP network fallback is not part of this contract. Installing deployment binding/grants remains separately authorized work.

Verification: new SQLite integration tests use actual existing PIXIE migrations and SELECT-only access, require explicit station scope, reject identity argument injection and ungranted reads before DB access, and preserve unresolved Work/result semantics. Full repository suite and local named-entrypoint runtime evidence are recorded in the handoff; no production equality is claimed.

### Reproduce local named-entrypoint acceptance

Use Node24.22.1 with development tools `wrangler@4.152.0` and `miniflare@5.20261019.2-beta`. The runtime script uses Miniflare's exported `convertV4MiniflareOptions` compatibility converter. Install those exact tools locally for verification, then run:

```sh
npx wrangler deploy --dry-run --outdir dist
node scripts/verify-private-station-runtime.mjs dist/read-entry.js
```

`MINIFLARE_MODULE` may point to an already installed Miniflare package directory; no particular workspace path is required. The script creates ephemeral local Workers and D1 only, imports the existing migrations, and closes the runtime. It must print all assertions as true. It does not invoke deployed bindings, production databases, queues, or provider APIs. The grant declaration and synthetic data inside this test are local fixtures only.
