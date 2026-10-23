# Concrete continuation from PR #19

PR #19 at `8fe9ca6f87af457ae61a229074477a3b592cc2f3` is independently reviewed
LOCAL_TEST readback only. Its 24 concurrent replays are **notification reads**,
not producer writes or durable delivery deduplication. Preserve that evidence.

The continuation adds `request-owner-http.mjs`, a real HTTP source reader, and
`GET /api/greenhouse/requests/:requestId` in the local server and existing Pages
Functions project. It consumes the existing GO endpoint:

`GET https://yggmetro.com/api/v1/admin/requests/:requestId`

The caller supplies its **existing GO admin bearer** in the Authorization
header. Greenhouse forwards it only to that fixed GO origin, without redirects,
query parameters, storage or logs. GO authenticates every read using its existing
YGG_ADMIN_CREDENTIALS. No credential is generated/copied from infrastructure,
no secret binding or new database access is needed. This is a selected-request
admin read, not a public inbox or Greenhouse OAuth session. Missing, denied,
ambiguous or malformed source results fail closed. Private source response
fields are discarded; only submission metadata reaches Office.

No signed event delivery is claimed by this HTTP pull route. Persistence remains
GO's existing confirm transaction. The response marks OWNER_HTTP_READBACK,
receiptStatus MISSING, execution NOT_ASSERTED. This permits the real chain
source → existing persisted event → Greenhouse HTTP reader → Office readback
without inventing an ingestion write or ledger.

## Fresh configuration evidence (2026-10-23 ~12:03–12:05 UTC)

Read-only Cloudflare settings inspection, account
`e100c4619cd8f6eff0ce6603756bc439`:

| Existing resource | Confirmed state | Consequence |
| --- | --- | --- |
| Worker yggmetro-web | REQUESTS_DB = 22b59dc3-e07c-4ae7-b5b1-2646d3e8a975; YGG_ADMIN_CREDENTIALS present | Existing persistence/auth owner; no binding change proposed |
| Worker yggmetro-shop-sandbox | SHOP_ORDERS present; no REQUESTS_DB or request admin secret | Not an authorized ready request staging target; do not repurpose its commerce database |
| Pages greenhouse-owner | greenhouse-owner.pages.dev; production branch main; no D1 or env bindings | Deploy only Pages code to add selected-request read; no configuration additions |
| Pages preview policy | custom include only feat/unified-workplace-personal-planner-20261016 | Pushing atlas/request-event-readback does not deploy this continuation |
| Worker greenhouse-transport | PIXIE_DB and queue; METROPOLIS_SERVICE service_deleted=true | Unrelated transport; leave unchanged |

Current Pages canonical production deployment:
`41829745-666c-4093-8604-5e9f1f6eab0b`,
`https://41829745.greenhouse-owner.pages.dev`.

Endpoint probes from this execution environment were **blocked by outbound
proxy**, HTTP 403 CONNECT, for both yggmetro.com and greenhouse-owner.pages.dev.
No request reached either application; application status is unverified. No
alternate network route was used to bypass that restriction.

## Exact owner handoff through parent

GO does not need to edit its producer for the first selected-request read. Use
its existing endpoints and keep the canonical source event UUID/timestamp:

1. Obtain a new synthetic customer session with `GET /api/v1/requests` (a new
   session sees only its own empty list).
2. `POST /api/v1/requests/synthetic-greenhouse-atlas-20261023` with a synthetic
   brief and the returned HttpOnly session cookie, same-origin Origin header.
3. `POST /api/v1/requests/synthetic-greenhouse-atlas-20261023/confirm` twice;
   verify one STATUS/DRAFT/SUBMITTED event in the responses.
4. Existing Office admin client calls
   `/api/greenhouse/requests/synthetic-greenhouse-atlas-20261023` on the approved
   Greenhouse deployment with its existing GO admin Authorization header.
5. Display category, sourceEventId, occurredAt, persistedAt and evidence; always
   show receipt MISSING. Do not display a Work pointer as an issued WorkPass.

GO owns the UI call/display. ATLAS supplies the route and response contract.
The existing UI was not edited. For private Office readbacks do not use cache,
localStorage or query-string credentials. No global customer listing is needed.

`scripts/verify-request-chain.mjs` makes this exact bounded test repeatable after
approval. It requires protected-environment `YGG_ADMIN_TOKEN` (existing operator
credential), `GREENHOUSE_APPROVED_ORIGIN` (the exact approved Pages URL), and
`GREENHOUSE_APPROVED_SYNTHETIC_REQUEST_ID`. It first requires an authenticated
404 for that exact request through Greenhouse before writing anything; it never
prints credentials, cookies or private brief content. It creates one new
customer session/request/submission/system message using existing APIs, repeats
confirm, then compares Office readback to the real source event. No new secrets
are provisioned. **Prepared but not run against a deployed service.**

## Action-specific approval bundle — not executed

Preferred first release is a manually uploaded **preview** of the existing
`greenhouse-owner` Pages project, branch `atlas/request-event-readback`, using
the reviewed continuation commit. No change to the project's preview policy,
main production branch, environment, bindings, permissions or secrets.

- Resource/change: existing Pages project `greenhouse-owner`; upload branch
  snapshot including new selected-request Function. No change to
  `greenhouse-transport` and no new Worker/database.
- Impact: preview URL exposes authenticated read-only forwarding of a selected
  GO request. The bearer is validated by GO; unauthorized callers get no data.
- Rollback: remove the exact new preview deployment; production canonical
  deployment `41829745-666c-4093-8604-5e9f1f6eab0b` remains untouched. Record the
  new deployment ID before executing any removal.
- Separate synthetic-write scope: existing `yggmetro-web` / `pantheon-workhub`,
  exact request `synthetic-greenhouse-atlas-20261023`; one new synthetic session,
  request, STATUS event and system message through existing customer APIs. No
  real customer records read/changed. Keep resulting synthetic evidence under
  that ID. Existing API has no delete route; cleanup, if wanted, requires an
  owner-scoped database operation reviewed separately, not a blanket rollback.
- Existing credential: authorized GO operator provides/uses its existing admin
  credential through protected runtime input. No permission/secret change is
  requested. Parent coordinates this operator step; do not paste it in chat.
- Network prerequisite: the execution channel must allow HTTPS to the two exact
  approved origins. Current environment proxy rejects CONNECT; use the normal
  platform approval/access process, not another route to bypass it.

Production deployment is **not** included in this preview approval bundle.
A later production release would replace the existing Pages deployment with
this exact tested snapshot and roll back to the recorded canonical deployment;
that requires its own specific approval. Source code edits and local tests are
complete without either deployment permission.

## New executable evidence and limits

The new local integration uses actual HTTP requests to a child-process server
running the frozen GO producer and existing schema with a durable SQLite D1
interface. Its serialized batch transactions model D1 atomic batches. **24
concurrent producer confirm POSTs** succeed with exactly one persisted STATUS
submission event. Greenhouse's actual HTTP Office route calls the owner's
existing admin endpoint, validates its response, strips private data, and
returns the same UUID and timestamp after the owner process restarts.

This closes the earlier concurrency coverage gap locally. SQLite is not deployed
D1, and this does not claim a live delivery ack, receipt, UI acceptance or B2E
production PASS. Pages Function routing compiles successfully using Wrangler;
no upload/deployment occurred. Remaining gates are the concrete preview,
synthetic-write/operator and network steps above, then GO's UI integration.

Local validation at the continuation: 106/106 tests, zero skips; 16/16 offline
drills; syntax and diff checks pass. Functional red against reviewed PR #19
server: Office HTTP route returned 404; continuation returns 200. The prepared
verification runner itself is exercised against the real local HTTP producer
and Office servers, including authenticated preflight, synthetic creation,
confirm replay and event equality. It has not run against deployed services.

A reviewable upload directory was assembled locally at
`/tmp/greenhouse-request-preview`: only existing root static assets, `greenhouse/`
static assets and compiled Pages `_worker.js`. No tests, producer fixture,
source credentials or repository metadata are copied. Reproduce it with the
installed Wrangler Pages Functions compiler and the explicit asset allowlist;
do not deploy the repository root or the transport `wrangler.jsonc`.

After explicit approval, the proposed deployment command is:

```sh
wrangler pages deploy /tmp/greenhouse-request-preview --project-name greenhouse-owner --branch atlas/request-event-readback
```

This command has **not** been executed. Record its preview URL/deployment ID,
then obtain/use the existing admin credential and run the named synthetic chain
only within the separately approved write scope. No production deployment or
configuration mutation is implicit in that command.
