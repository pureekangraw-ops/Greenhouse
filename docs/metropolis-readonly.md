# Greenhouse → Metropolis: read-only integration boundary (Draft)

Architecture A: **Metropolis remains the existing Work / Checkpoint / authority system.** Greenhouse is a consumer and reporting interface, not a new Hub, Work owner, Station, gate, or source of operational truth. Nothing in this PR changes Metropolis, GO Hub, or owner systems.

## Implemented

- Server-only MCP JSON-RPC client, restricted to metropolis_arrive and metropolis_work with action=read.
- Caller-supplied HTTPS /mcp endpoint and a server-side access-token provider. OAuth login, refresh, identity and grants remain owned by the existing host and Metropolis.
- Each read discovers current actor + granted Work ID + Checkpoint via metropolis_arrive, then reads only the same Work. Rejects mismatched actor, Work, Checkpoint, owner system, unverified readback, stale arrival, or absent grant.
- Projects a verified Work lifecycle read into contracts/report-contract.json fields, with the Work lifecycle state alongside it. No payment, job completion or owner operation is inferred.
- UNKNOWN on failed, stale or denied paths. Static mock UI is unchanged; nothing in the browser is silently promoted to live.

## Trusted server usage

Place this on a trusted backend which already has an authenticated, authorized Metropolis GO/LIGHT session:

    import {createMetropolisMcpClient, createMetropolisReportReader}
      from './src/adapters/metropolis-read.mjs';

    const client = createMetropolisMcpClient({
      endpoint: serverConfiguration.metropolisMcpUrl,
      getAccessToken: () => authorisedMetropolisSession.accessToken,
    });
    const reader = createMetropolisReportReader({client});
    const result = await reader.readWork(approvedExistingWorkId);
    // result.report: schema-compatible report
    // result.work: Work System lifecycle only; null when not verified
    // result.verification.ownerExecutionVerified is ALWAYS false

The host, not browser-supplied JSON, must choose Work ID from the authenticated scope. The backend must additionally authorize which caller may ask about a Work, separate SHOP customers from OFFICE identities, and never expose raw Work records from other customers or leak tokens in logs.

Do not configure secrets in static index.html/app.js, a public client environment variable, or a demo. This change does not add a login system, fake Work, token endpoint, credential storage, Work grant, new Hub, or custom relay.

## Source contracts reviewed

- pureekangraw-ops/Metropolis/src/shared-mcp.mjs
  - metropolis_arrive returns actor, observedAt and current.works[] with grants/checkpoint.
  - metropolis_work read returns actor, record, readbackVerified and ownerExecutionVerified.
  - Work readback consistency does not verify execution by an Owner System.
- pureekangraw-ops/Metropolis/docs/shared-mcp-entry.md
  - OAuth and Work grants / Work Pass belong to Metropolis.
- Greenhouse/contracts/report-contract.json
  - freshness, workStatus and confidence are separate; workStatus remains null unless the lifecycle state is explicitly BLOCKED or WAITING.

There is no assumed GREENHOUSE Work ID. The Work ID shown by the existing scaffold is mock, not verified evidence.

## Verification and release gate

Offline tests exercise the tool allow-list, HTTPS/redirect boundaries, successful read, no grant, checkpoint/actor mismatch, stale arrival, denied responses, invalid MCP content and source outage. Run: npm run check && npm test && npm run evaluate:agents.

Remaining UNKNOWN:
1. Real Metropolis server-side session/token provisioned for Greenhouse.
2. A current authorized existing Work ID and genuine metropolis_arrive → metropolis_work(read) runtime response.
3. An authenticated backend host route and frontend wiring for OFFICE (static mock is not suitable).
4. Owner-source operational readback, evidence authenticity, live model evaluation and device acceptance.

Passing offline tests is not live acceptance. Do not merge, deploy, label the Office source as CURRENT, or mark Work completed until an actual authorized destination readback is checked. Keep this PR stacked on the unmerged Genome/Lyra draft until base integration is reviewed.
