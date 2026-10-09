# Greenhouse Owner Workspace — UI slice

Status: **FEATURE-BRANCH UI ONLY**. This page records the current interface slice; it is not a claim that Greenhouse is connected to production tools or ready for deployment.

## User-facing direction

Greenhouse presents an **All-in-One AI Workplace** shell. Meetings are not a primary product area. A meeting record may later be attached as context to an existing Work, but the workspace is organized around Work continuity and authorized tools.

## Current navigation

- Overview — owner connection state and read-only Hub readback
- Work — read-only projection of the same readback
- Tools — connector/capability readiness with unknown states kept explicit
- PIXIE EXPRESS — intended Branch → Greenhouse → HQ → existing Runner/Tool flow
- Artifacts — references returned by an authorized source; no copied or fabricated artifacts
- Observatory — observation/evidence view; observation is not execution
- Review — policy preview only; no review queue or command action is connected

## Responsibility boundary

- METROPOLIS remains the identity/access/Work-resolution boundary.
- The existing Work-truth owner remains the only source of Work identity/lifecycle truth; this UI does not create a Work Ledger.
- CITY HALL/its existing intake-return path owns the durable handoff/receipt path where configured.
- PIXIE Branch preflights Parcel shape and correlation; it does not mint permission.
- PIXIE HQ routes and tracks through existing capabilities; it is not an execution runtime.
- Existing Runner/Station and destination Owner System perform the work and own domain truth.
- Greenhouse displays sanitized readbacks and evidence references only.

## Automation / review policy

- Authorized, routine work can complete automatically when it stays within the existing Work scope and does not cross a final-action boundary.
- Final actions remain stopped by policy. GO and LIGHT review the prepared action before the responsible owner executes it.
- High-risk, out-of-scope, conflicting, or unverifiable work stops with an explicit next action and blocking owner.
- The present UI is informational; it does not dispatch remote commands.

## Current live-proof boundary

- The existing Greenhouse backend has an optional read-only Metropolis Work adapter, but production owner login/session, global inbox adapter, event sink, command adapters, and production host are not established by this UI change.
- Tool cards other than the partial Metropolis source-read path remain `UNKNOWN`; do not infer readiness from a label or card.
- The inbox server currently sanitizes only a small readback field allowlist. If a source omits `nextAction`, the UI shows `UNKNOWN` rather than inventing one.
- The PWA service worker caches only static application-shell assets and excludes `/api/*` and private responses.

## Verification for this slice

```bash
npm run check
npm test
npm run evaluate:agents
```

These checks validate local code and offline policy only. They do not prove OAuth/session integration, live tool execution, a durable runner, or production readiness.

## Next safe integration step

Inspect the existing Work/inbox owner contract and registered Runner/Station capabilities. Then select one read-only path and verify:

```text
Metropolis authorization
→ existing Work resolution
→ authorized read
→ source evidence + readback
→ Greenhouse projection
```

Do not add another Work ledger, capability registry, runner runtime, OAuth boundary, or approval barrier if an existing owner path already provides it.