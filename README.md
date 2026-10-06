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

Open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Next implementation slice

1. Freeze the Hub request/response schema.
2. Add a real `hub-adapter` boundary without exposing credentials to the browser.
3. Run one read-only report round trip.
4. Verify the response against the report contract before adding mutations.