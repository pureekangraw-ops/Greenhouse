# Metropolis Genome Hub v0.1

## Boundary

```text
Shop Web ───────┐
Office Web ────┼──> Genome Hub ───> HERMES / GO / LIGHT / MIMIR / Owner Sources
Greenhouse Web ┘
```

- **Genome Shop** owns the Shop domain.
- **Genome Office** owns the Office/work domain.
- **Genome Greenhouse** owns the build/technical domain.
- **Genome Hub** owns coordination, request/response correlation, receipt, evidence, and readback.
- The Hub is not an Owner Source and must not silently become a second truth.

## Report contract

Keep these dimensions independent:

1. `freshness`: `CURRENT | STALE | UNKNOWN`
2. `workStatus`: `BLOCKED | WAITING | null`
3. `confidence`: `CONFIRMED | PROBABLE | UNKNOWN`

Every report should carry:

- `observedAt`
- `ownerSource`
- `evidence`
- `nextAction`
- `limitations`
- `workId` when a Work exists
- `receiptId` when the return path is available

## Current implementation status

The web surface is a local mock. HERMES, GO, LIGHT, MIMIR, and external Owner Sources are not connected or verified by this repository yet.