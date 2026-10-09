# Greenhouse Owner Workspace — UI slice

Status: **FEATURE-BRANCH UI ONLY**. This page records the current interface slice; it is not a claim that Greenhouse is connected to production tools or ready for deployment.

## User-facing direction

Greenhouse presents an **All-in-One AI Workplace** shell. Meetings are not a primary product area. A meeting record may later be attached as context to an existing Work, but the workspace is organized around Work continuity and authorized tools.

## Current navigation

- Overview — owner connection state and read-only Hub readback
- Work — read-only projection of the same readback
- Tools — connector/capability readiness with unknown states kept explicit
- PIXIE EXPRESS — proposed coordination/return view; its live contract and exact runtime role are not verified
- Artifacts — references returned by an authorized source; no copied or fabricated artifacts
- Observatory — observation/evidence view; observation is not execution
- Review — policy preview only; no review queue or command action is connected

## Responsibility boundary

- METROPOLIS remains the connection and authority boundary; it resolves access to existing Work without replacing its owner.
- The Work System remains the source of Work identity, lifecycle, and continuity truth; this UI does not create a Work Ledger.
- CITY HALL owns intake, return, and records/data handling through its existing path where configured.
- HERMES handles intake/registration/index; MIMIR handles return/organization/index, within their existing contracts.
- PIXIE owns technical knowledge and creation/modification lineage; it does not control Work Lifecycle or execute the work.
- PIXIE EXPRESS routing, Branch/HQ roles, and runtime are UNKNOWN until verified from their existing contract.
- Existing Runner/Station and destination Owner System perform the work and own domain truth.
- Greenhouse coordinates agents/tools within existing authority and scope, then displays sanitized readbacks and evidence references. It does not create authority or lifecycle state.

## Automation / review policy

- Authorized, routine work can complete automatically when it stays within the existing Work scope and does not cross a final-action boundary.
- Final actions remain stopped by policy. GO and LIGHT review the prepared action before the responsible owner executes it.
- High-risk, out-of-scope, conflicting, or unverifiable work stops with an explicit next action and blocking owner.
- The present UI is informational; it does not dispatch remote commands.

## Current live-proof boundary

- The existing Greenhouse backend has an optional read-only Metropolis Work adapter, but production owner login/session, global inbox adapter, event sink, command adapters, and production host are not established by this UI change.
- Tool cards other than the partial Metropolis source-read path remain `UNKNOWN`; do not infer readiness from a label or card.
- The inbox server passes a bounded allowlist of Work/Checkpoint status, `nextAction`, evidence references, and limitations from the existing readback. Unknown or omitted values stay UNKNOWN; the UI does not infer tool execution from a City Hall receipt.
- The PWA service worker caches only static application-shell assets and excludes `/api/*` and private responses.

## Verification for this slice

```bash
npm run check
npm test
npm run evaluate:agents
```

These checks validate local code and offline policy only. They do not prove OAuth/session integration, live tool execution, a durable runner, or production readiness.

## Next safe integration step

Keep the bridge small: verify one read-only path and show the source-owned readback fields before adding any tool command or runner path:

```text
METROPOLIS access/authority check
→ existing Work System resolution
→ authorized read from the existing owner path
→ source evidence + readback
→ Greenhouse projection
→ existing CITY HALL / MIMIR return path (when configured)
```

PIXIE records technical lineage only; it is not the Work Lifecycle owner. Do not add another Work ledger, capability registry, runner runtime, OAuth boundary, or approval barrier if an existing owner path already provides it.