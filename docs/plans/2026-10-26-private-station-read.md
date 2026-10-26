# Private station delivery read integration

The existing PIXIE ledger belongs to the Greenhouse transport station. It has no per-record owner or tenant contract, and its actor field cannot grant Work access. Historical Metropolis Work contracts do not establish a current live Work owner.

Implement a dormant named `GreenhouseRead` service entrypoint using MCP read tools and a redacted SELECT-only PIXIE projection. Deployment must explicitly declare station-wide private Service Binding read authority; no declaration or public request grants reads. Distinguish station scope from existing owner-scoped adapters. Keep Work references unresolved and result evidence unavailable without independent source proof.

1. Add failing integration tests against real SQLite and existing migrations, exercising scope, denial, bounded exact reads, and redaction.
2. Add the minimal station projection, private HTTP handler and named Worker entrypoint; retain the default transport worker and all queue behavior.
3. Run all repository tests and syntax checks; deliver an exact patch and contract to the Hub/GO owner. No deploy, binding installation, key change, queue activation or replay.

## Reopened HTTP/UI connection

Private MCP is only one stream. The real Pages LIVE tracking handlers and Node default remained unconnected. Add shared HTTP integration with a genuine signed Cloudflare Access owner verifier using separately configured Greenhouse origin/team/audience/owner (all unset by default). Never reuse GO Brain OAuth or infer ownership from identity. The verified actor gets only station read access through the explicit private GreenhouseRead capability; return typed delivery tracking projection with unresolved Work/result semantics. Wire actual Pages routes, status and Node runtime option to this adapter. Test real signed JWT/JWKS and real local workerd named binding/D1, then browser LIVE list/detail and denial cases. Production Access application and binding/config installation remain outside source-only work.
