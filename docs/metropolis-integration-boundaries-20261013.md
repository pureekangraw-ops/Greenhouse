# Greenhouse AI Engine boundary

Status: implementation plan, NOT runtime acceptance.

Greenhouse owns AI model/provider adapters, inference and local compute availability, including HERMES and PIXIE integration when supported. It does not own Metropolis Work identity, delegation, receipts, or lifecycle state.

## Integration contract
- Accept only authenticated, scoped requests routed by Metropolis, with Work ID and Checkpoint ID.
- Preserve actor attribution and source evidence; do not accept a client-supplied authorization assertion as authority.
- Return model/provider identifier, execution outcome, timestamps, machine evidence and explicit UNKNOWN on unavailable runtime.
- Keep provider credentials server-side. No token or model artifact in Work signal.
- Local machine OFFLINE means unavailable, never fabricate successful inference; cloud fallback requires explicit authorization and cost controls.

## Acceptance
- Provider adapter unit tests and negative authorization tests.
- Real local inference with independent input and evidence.
- Metropolis request -> Greenhouse execution -> correlated receipt/readback.
- Shutdown/restart and unavailable-machine recovery verified.
