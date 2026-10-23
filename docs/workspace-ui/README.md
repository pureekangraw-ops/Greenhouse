# Greenhouse workspace — visible WORK deliverable

Continues PR #19 from reviewed `61494955a66b08884a82f0aafd290721945791bd`.
The approved PLAN is implemented in Greenhouse's existing `/greenhouse/` UI.
No GO storefront/Office files were edited; this is an integration-ready workspace,
not a production Office replacement.

## Inspect the interface

- [Overview, desktop](screenshots/01-overview-desktop.png)
- [Searchable/filterable event list](screenshots/02-events-desktop.png)
- [Detail, history, source and evidence](screenshots/03-detail-desktop.png)
- [Local AI panel, disconnected](screenshots/04-local-ai-disconnected.png)
- [Overview, mobile](screenshots/05-overview-mobile.png)
- [Local AI panel, mobile](screenshots/06-local-ai-mobile.png)
- [Self-contained offline review artifact](preview.html) — download/open only in
  an environment that permits it; no network, credentials or model calls.

The actual app was inspected and exercised in installed Chromium through its
existing local Node server bound to an ephemeral **127.0.0.1-only** port. This is
our known test server, not a discovered AI runtime or exposed public port.
Direct `file://` navigation to preview.html was blocked by browser policy with
`ERR_BLOCKED_BY_ADMINISTRATOR`; no bypass/alternate route was attempted for that
file. The screenshot evidence is from the actual app route, not the standalone
artifact. No public preview URL or deployment exists for this change.

## WORK complete

1. **Overview**: explicit DEMO/live selector, timestamps, counts only for the
   displayed set, disconnected AI state and unavailable live aggregate notice.
   Existing owner-session status, inbox and Operational Log remain in an
   expandable panel instead of occupying the whole interface.
2. **Events**: search title/event/request/source; filter category and source;
   empty-result state; selected-request readback form. Uses the existing reviewed
   GET `/api/greenhouse/requests/:requestId`. No token input or token storage.
3. **Details**: exact source event/request IDs, occurred/persisted timestamps,
   evidence references as text, MISSING Hub receipt and NOT_ASSERTED execution.
   History shows only available events. Demo history is labeled synthetic;
   the existing real API exposes submission only, not complete request history.
4. **Local AI Lab**: disconnected/configured-not-tested state, allowlisted model,
   editable synthetic-only input, test reply, elapsed milliseconds, error/fallback
   and clear controls. AI off does not break navigation or readback. Configured
   test responses in browser tests are fixtures, not proof of a live model.

Demo fixtures never merge with readback data. Switching to live before a read
shows no invented records/counts. No full live list or system aggregate endpoint
has been invented. No receipts, WorkPasses, queues, ledgers or services are added.

## Typed connector boundary

`createLocalAITestConnector({models, provider, timeoutMs})` reuses the existing
`createAgent({agent:'GENOME', mode:'SHOP', provider})` runtime, redaction, policy
fallback and timeout behavior. The owner injects an already-authorized provider
function; the browser cannot supply a URL/host or model outside the allowlist.
Only synthetic text and empty context are supplied, never selected request data.
Provider exceptions are not returned to UI. Results always say `executed:false`.

The existing Node server accepts optional `localAIConnector`; default is null.
GET `/api/greenhouse/local-ai` reports DISCONNECTED without any runtime call.
When a connector exists, an existing owner session with CSRF is required to get
its model list/test nonce; POST also requires exact same origin and CSRF. The
UI keeps this nonce in memory only. Input/output are neither logged nor stored.

The existing Pages Function has **no provider or owner session wired** and stays
disconnected. No endpoint discovery, localhost/private-network probing, model
download, port exposure, credentials or external runtime calls occurred.

Parent/owner still must supply the runtime name, exact approved address/protocol,
model and authority before a transport adapter can be bound to that provider.
No user-supplied browser URL, secret storage or permissive CORS is proposed.

## Real readback / Office boundary

The reviewed request API requires existing GO admin authorization. This UI sends
only a same-origin read with existing session cookies; it does not prompt for or
forward a pasted admin credential. With the current unconfigured session adapter,
the form shows an explicit authentication/integration-needed state. A successful
result can be rendered when the existing authorized same-origin server adapter
is connected. UI protocol tests inject a synthetic response for this case.

GO still owns the cross-origin Office cutover and authenticated same-origin
server-side proxy described in ../request-chain-rollout.md. CORS is not loosened.
The HTTP reader relies on GO's authenticated response; it does not independently
compare owner_hash, which is not present in that API response. Receipt MISSING.

## TEST evidence

- Actual browser interaction: four views; search; both filters; empty filters;
  detail/history; separate live-empty mode; auth error; synthetic selected-read
  rendering; disconnected AI; configured model fixture; synthetic consent gate;
  reply/fallback/error fixtures; elapsed display; clear; core still usable after
  AI failure. Zero browser errors, zero external requests, zero localStorage or
  sessionStorage entries. No horizontal overflow across four views at 390px.
- Provider boundary tests: default off; allowlist/schema; synthetic-only;
  authorization/CSRF/origin; redaction; reply; error/timeout/unsafe output fallback;
  actual existing Node HTTP injection path. No actual AI server involved.
- Full regression: **120/120 tests, zero skips**; syntax/diff checks and **16/16** offline policy drills pass.
- Existing Pages Functions compile locally. No deployment/upload occurred.

Run using an installed Playwright package/Chromium (no dependency install needed
in this workspace):

```sh
PLAYWRIGHT_MODULE=file:///workspace/yggmetro-web/node_modules/playwright/index.mjs node scripts/test-workspace-ui.mjs
npm run check
npm test
npm run evaluate:agents
ESBUILD_MODULE=file:///workspace/yggmetro-web/node_modules/esbuild/lib/main.js node scripts/build-workspace-preview.mjs
```

The paths above only use existing tooling; no GO source is changed. Set the
module paths to your own installed packages outside this execution environment.
Screenshots intentionally show DEMO and disconnected real AI. Browser tests use
explicit fixtures for responses; they are not production/model acceptance.

Remaining gates: approved runtime details/provider binding; authorized same-origin
owner readback adapter; separately approved preview/deployment; GO Office UI
cutover. Live chain, production auth and real model acceptance remain unproven.

## Android device loopback continuation

Owner-provided screenshot reports HERMES-R5 RUNNING on Android CPU, API base
`http://localhost:8000/v1`, auth off, CORS all origins, client all, and explicit
loopback-only accessibility on that device (not Wi-Fi). Reported load was 7.9s,
request count zero. This is owner screenshot context, not this environment's
health check; no device connection/inference has been verified.

The Local AI panel now has an explicit **HERMES on this device / loopback** path.
The user must open the workspace in a browser on that same Android device.
No Cloudflare/Node server fetches localhost. No runtime/private-network discovery
or port exposure is introduced. The exact URL is fixed; there is no free-text
host, credentials field, /models probe, redirect following or alternate target.

No available repository runtime documentation verified the API contract. `/v1`
alone is insufficient. Therefore the initial state is PROTOCOL UNVERIFIED, model
ID is blank, and inference is disabled. The user must explicitly select the
Chat Completions-compatible **experiment**, enter a confirmed runtime Model ID,
and confirm both protocol uncertainty and synthetic-only input before clicking.
This tests only POST `/v1/chat/completions` with one synthetic user message,
stream:false and bounded output. It does not assert HERMES supports that route.

The device path runs only in the browser with credentials omitted, redirect
rejection, normal CORS mode and no referrer. No bearer/CSRF from the server
provider path is sent to the device. Browser HTTPS-to-HTTP/private-network
policies may reject it; use only supported normal device permissions, never
bypass security. No runtime auth/CORS/client/port settings were changed.
The local preview CSP permits only the exact reported `http://localhost:8000`
origin in addition to self; it adds no wildcard or other private destinations.
No deployed policy was modified.

Separate UI states distinguish not-tested, HTTP-reached-but-protocol-unverified,
blocked-or-unreachable, inference response, timeout and cancellation. A browser
failure is not presented as proof HERMES stopped. A returned synthetic model
reply is not a Work action or Hub receipt. The generic authorized server-provider
path remains intact. Abort/cancel and a 10-second device timeout bound each test.

[Device-loopback configuration screenshot](screenshots/07-device-loopback-unverified.png)
shows the unverified/disabled state. Browser screenshot testing made **no** device
request; network behavior was tested only with an injected fetch implementation
(no socket). Tests cover no-fetch before consent/config, one fixed destination,
no credentials/discovery, response schema/size, HTTP/protocol vs network failure,
timeout and cancellation. Real Android/browser/runtime inference is pending.

The previous Library upload remains requested. Its prepared transfer helper
failed before preparation at hosted-app tool discovery (network failure); no
Library IDs exist yet. Keep all screenshots and the updated offline artifact
for transfer through a working Library connection; this is separate from deploy.
