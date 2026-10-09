# Greenhouse · Metropolis Genome Hub

A local v0.1 web surface for the Metropolis architecture:

- **Genome Shop** — shop web surface
- **Genome Office** — office/work web surface
- **Genome Greenhouse** — build and technical web surface
- **Genome Hub** — request intake, coordination, receipt, evidence, and readback

## Current status

This scaffold is a **local mock implementation**. It does not claim a live connection to HERMES, GO, LIGHT, MIMIR, or any Owner Source.

The report contract keeps three dimensions separate:

- `freshness`: `CURRENT | STALE | UNKNOWN`
- `workStatus`: `BLOCKED | WAITING | null`
- `confidence`: `CONFIRMED | PROBABLE | UNKNOWN`

Every report sample includes `observedAt`, `ownerSource`, `evidence`, `nextAction`, `limitations`, and `workId` when available.

## Run locally

The UI can still run without any external access; opening `index.html` is mock-only.

To use the new **Genome Office → Metropolis read-only adapter**, run a local-only backend:

```bash
# On a trusted local machine, supply a BIG-delegated GO OAuth access token
# via your shell's protected environment (never paste it into chat or the frontend).
npm start
```

This server binds to `127.0.0.1:4173`, never exposes the OAuth token to the browser,
accepts only existing Work IDs, and calls only `metropolis_work(action=read)`. The
Office panel is mock until the server has an actual `METROPOLIS_ACCESS_TOKEN`.
The adapter refuses actor-only legacy tokens and does not fabricate a
BIG → GO delegation. If the owner source is stale, the report says STALE.

Without a token, you can still preview the mock interface with a static server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Genome / Lyra agent cores

Server-side role prompts, policy and injectable provider runtime now live in `src/agents/`.
Run `npm test` and `npm run evaluate:agents`. See [agent usage and verification boundaries](docs/agents.md).
The frontend is still a mock; live model/Hub/device acceptance is not claimed.

### Frontend integration still pending

1. Implement the owner-authorized OAuth login/callback and server-side token storage.
2. Perform and verify one authenticated Greenhouse backend → Metropolis live Work readback.
3. Add explicit owner login before any public deployment or multi-user access.
4. Connect Genome's report action to the validated owner adapter; preserve read-only permissions.

## Genome Office: read-only Metropolis connection (in development)

The Office page now includes a Work ID reader powered by an optional **local-only backend** (`server.mjs`).
The backend requests `metropolis_work:read` from Metropolis with a server-side
owner-delegated credential and returns a sanitized report. It never creates Work
or controls Metropolis. Source update age is kept separate from read time.

```bash
npm run check && npm test && npm run evaluate:agents
npm run preview
```

Open `http://127.0.0.1:4173` → Genome Office.
Without a server-owned delegated OAuth access token, the reader shows
`OWNER_CONNECTION_REQUIRED`; other pages remain explicitly mock.
The existing ChatGPT connection is **not** a credential that this application
can copy or reuse automatically. Do not paste OAuth tokens into browser inputs.
Production authentication, owner consent callback, and live Greenhouse-to-Metropolis
end-to-end acceptance are not yet complete.

See [owner-readback integration and restrictions](docs/metropolis-office-read.md).

## Greenhouse Owner Workspace PWA candidate

A separate installable shell is available at `/greenhouse/`. Its All-in-One AI Workplace navigation groups Work, tools, PIXIE EXPRESS, artifacts, Observatory evidence, and review policy in one owner workspace. The offline worker caches only the static shell, never `/api/*` or private readbacks.

The current UI is a read-only workspace projection. Tool cards and PIXIE EXPRESS tracking explicitly show UNKNOWN/not connected until existing-Hub and owner-source adapters return evidence; the UI does not invent Work, Parcel, Artifact, or execution records. Routine in-scope work may run automatically through its authorized tool path. Final actions remain stopped for GO + LIGHT review and owner execution; this UI does not dispatch commands.

Session, inbox, event-sink, and command adapters remain owner-controlled integration boundaries. See [Greenhouse Owner Inbox v1 implementation boundary](docs/greenhouse-full-v1.md) and [Owner Workspace UI slice](docs/greenhouse-owner-workspace-ui.md) for the live-proof limits. This candidate is not merged or deployed.
