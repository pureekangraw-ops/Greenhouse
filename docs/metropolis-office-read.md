# Greenhouse → Metropolis: Genome Office readback v1

## Ownership and boundaries

- **BIG** authorizes the Metropolis connection; **GO** acts on behalf of BIG.
- **Metropolis City Hall** is Work source. GREENHOUSE does not create, modify, return, cancel, or complete a Work.
- The server adapter calls exactly MCP `metropolis_work` with `action:"read"` and a supplied Work ID.
- The server verifies `delegatedAccess.owner=BIG`, `actingAgent=GO`, `authority=OWNER_DELEGATED`, Work ID, checkpoint, owner system, and `readbackVerified=true`.
- A Metropolis City Hall readback **does not prove external owner-system execution**. The report preserves this limitation even when receipt refs exist.

## Run the local-only preview

```bash
npm run check
npm test
npm run evaluate:agents
npm run preview
```

Open `http://127.0.0.1:4173`, then Genome Office. The Work ID reader returns `OWNER_CONNECTION_REQUIRED` until **an authenticated server-side OAuth token** is available in the environment.

The local integration supports `METROPOLIS_ACCESS_TOKEN` for a trusted development environment only. Do not paste an access token into the frontend, a public repo, a chat, logs, or URL parameters; do not scrape or export ChatGPT-managed connector tokens. The next production step is to implement a server-side Metropolis OAuth authorization-code flow under the existing BIG consent authority, then store and rotate its token securely.

The preview binds **only `127.0.0.1`**, serves an explicit allowlist of frontend files, is read-only, rejects foreign `Origin`, and responds with `Cache-Control: no-store`. It does **not** implement multi-user login and MUST NOT be exposed publicly or deployed as a production internet-facing service.

## Report semantics

`observedAt` is the read time; `freshness` is based on Work `updatedAt` in City Hall, not the time of the HTTP call:

- **CURRENT**: latest Work update is at most 60 seconds old.
- **STALE**: valid but older than 60 seconds.
- **UNKNOWN**: missing, invalid, or future update timestamp.

Evidence entries are limited to the source Work's journey/return evidence and receipt references. Empty source evidence stays empty; the report has `confidence: UNKNOWN`. `ownerExecutionVerified=false` is **never** treated as a completed external action.

Every report conforms to `contracts/report-contract.json`. `workStatus` remains independent of freshness/confidence.

## Acceptance status

- Adapter/protocol and local endpoint: covered by offline deterministic tests.
- Metropolis live Work read from ChatGPT: available as separate operator proof, but is **not** a Greenhouse backend read.
- Greenhouse backend → Metropolis with its own delegated OAuth token: **NOT CONNECTED / NOT ACCEPTED** until the owner authorization flow is installed and a source-backed read is verified live.
- Browser/devices and remote deployment: **NOT ACCEPTED**.

No new Owner Source, GO HUB route, Work authority, Work ID, or agent login is created.
