# Approved demo-only Android preview

Preview URL: https://46316d97.greenhouse-owner.pages.dev
Branch alias: https://atlas-request-event-readback.greenhouse-owner.pages.dev

- Existing project: `greenhouse-owner`
- Environment: **preview** (confirmed by Cloudflare)
- Deployment ID: `46316d97-7b35-4c98-be61-d487cc276653`
- Deployed source commit: `51638e8d5465f8b0478fb6bf59b68fba067e7844`
- Uploaded worker SHA-256: `2d1640b33fcd7ef7c5bfe0064c0cbfb05ab0b067031dd31296c2103ce4eefcc8`
- Deployment completed: `2026-10-23T14:03:10.787883Z`, status **success**
- Production before and after: `41829745-666c-4093-8604-5e9f1f6eab0b` (unchanged)

## Exact scope

This is a separate deployment artifact built from existing Greenhouse UI assets
using `scripts/build-demo-deployment.mjs`, not a deployment of the full PR/runtime.
It contains the demo overview, event list, details and device-local HERMES test
panel. Live data selection and request form are hidden/removed from the public
experience. No existing request-reader, owner session or provider API module is
included. Every `/api/*` request receives 404 `PREVIEW_API_DISABLED` from a small
static Pages responder; there is no fetch/proxy path in that server responder.

Client requests are constrained to the exact owner-reported device inference
endpoint `http://localhost:8000/v1/chat/completions` and only from the explicit
consent/configuration-gated test panel. Other fetches are disabled locally in
this artifact. The CSP allows only that exact device origin for connections.
No auth/CORS/runtime settings, bindings, permissions or network exposure changed.
No customers, Shop writes, admin credentials or production services were used.

OlliteRT is the Android runtime app; HERMES-R5 is the imported model. `/v1` does
not prove the protocol or API Model ID. Both remain explicitly unverified and
blank/unselected until the user supplies compatible configuration. Opening the
preview performs no model inference or discovery. It must be opened on the same
Android device as OlliteRT to use its loopback endpoint; Cloudflare never calls
localhost. Browser security and normal device permission checks remain in force.

## Verification and exact remaining blocker

Before upload, the packaged artifact was exercised in Chromium at 390px on a
known local test server: root UI, search, detail, disabled unverified AI state,
consent gates, no overflow, version endpoint, all tested API paths denied. Zero
browser errors and zero device requests. The full repository regression passes
120 tests and 16 offline drills. The final build embeds the exact deployed SHA.

The existing local Wrangler CLI had no login. No login/credential change or
new temporary account was attempted. The deployment used the already-connected
Cloudflare account's documented Pages deployment API with explicit preview
branch, commit hash, empty asset manifest and the isolated static worker.
Cloudflare returned success and subsequently confirmed the preview deployment
stage succeeded. Production's canonical ID was re-read and unchanged.

**Public browser verification is blocked**, not passed. After deployment,
`scripts/test-demo-preview.mjs` attempted to open the exact public preview URL.
The execution environment browser failed at navigation with
`net::ERR_TUNNEL_CONNECTION_FAILED`, before UI/version/API checks could run.
No alternate network route, alias retry, proxy change or bypass was attempted.
Therefore the served public version and interactive controls have not been
independently read back from this environment. Deployment success is control-plane
evidence, not a substitute for that missing browser evidence.

To finish acceptance, an authorized browser with permitted access must open the
preview, confirm header `51638e8`, inspect `/preview-version.json`, check the four
views and disabled API routes, then separately test inference on BIG's Android.
The current environment needs permitted access to this exact preview origin to
run that public verification; do not redeploy or weaken security to address it.

## Device step

Open the Preview URL on the Android phone running OlliteRT. Explore DEMO views,
then select Local AI Lab. The device endpoint is already shown. Do not guess a
Model ID or protocol: choose the compatibility experiment only when the runtime
contract is confirmed, acknowledge synthetic-only/same-device use, then explicitly
start a test. A browser error does not mean OlliteRT is stopped. The cancel button
and bounded timeout are available. Real Android inference remains unverified.

Rollback, only if requested: remove this exact preview deployment ID. Production
has not moved and requires no rollback. No production merge/deployment is implied.
