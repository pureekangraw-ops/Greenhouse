# Greenhouse ↔ Metropolis OAuth contract (candidate)

Status: **design only**. No OAuth client was registered, no credential was issued, and no Greenhouse runtime or callback is deployed.

## Boundary

- Metropolis remains the existing identity, authorization, and Work-access boundary. Greenhouse must not create an independent identity provider or infer permissions from a user-supplied Work ID.
- Greenhouse is a confidential server-side OAuth client of the existing Metropolis issuer. Never reuse or export a ChatGPT/Notion connector token as Greenhouse credentials.
- OAuth authenticates the Metropolis actor. It does not grant blanket Work access. Each read must refresh `metropolis_arrive`, find the exact existing Work pointer, require `authorizedActions` to include `read`, then call only `metropolis_work(action=read)` and verify the matching actor, Work, checkpoint, active Work Pass, and `READ_WORK` receipt.
- A successful Work receipt proves readback only. It does not prove Owner System execution or business completion. Keep the source Work `updatedAt` lifecycle timestamp separate from the read receipt `observedAt`.

## Candidate endpoints

| Setting | Candidate value | State |
|---|---|---|
| Public origin | `https://greenhouse.yggmetro.com` | Candidate only; active zone confirmed, exact DNS record absent, no Worker Domain attached |
| OAuth issuer | `https://metropolis.pureekangraw.workers.dev` | Existing Metropolis issuer; read-only discovery |
| MCP resource | `https://metropolis.pureekangraw.workers.dev/mcp` | Existing documented resource |
| Redirect URI | `https://greenhouse.yggmetro.com/auth/metropolis/callback` | Proposed exact callback; route not implemented or registered |
| OAuth client subject | `GO` | Candidate: delegated GO identity, not Greenhouse ownership |
| OAuth scope | `metropolis-go` | Candidate; still subject to the per-Work read grant |

The callback is a design target, not a deployed or approved endpoint. Do not register it until the Greenhouse callback implementation and host configuration have been reviewed.

## Existing Metropolis protocol to reuse

- Authorization Code grant with PKCE `S256`, exact redirect URI, issuer/resource checks, short-lived access tokens, single-use authorization codes, rotating single-use refresh tokens, and owner authorization on the existing Metropolis page.
- Confidential client authentication at the token endpoint uses `client_secret_basic`.
- BIG configures the registered client in Metropolis' existing `MCP_OAUTH_CLIENTS` secret using its own client ID/secret, `subject: GO`, `scope: metropolis-go`, and the exact callback URI. Do not add a new OAuth issuer or copy credentials from another client.
- Greenhouse must generate and validate `state` and a PKCE verifier per attempt; verify callback issuer/state; exchange the code server-to-server; keep access/refresh tokens out of browser storage, service-worker caches, logs, Git, and URL parameters after callback.
- Runtime must store refresh state server-side, rotate refresh tokens, and expose only an opaque `Secure; HttpOnly; SameSite=Lax` session cookie. Logout/revocation and CSRF protection must be implemented before private API access is exposed.

## Current implementation and proof boundary

- `src/hub/metropolis-read.mjs` implements the read-only MCP leg. It requires a server-supplied bearer token, refreshes arrival, checks the exact grant, and refuses every operation except exact Work read.
- The direct Metropolis MCP source read was verified as LIGHT on 2026-10-09. This proves the source-side grant/read shape only. It does **not** prove the Greenhouse backend can obtain or store a token.
- The current Node preview binds to `127.0.0.1`; it has no OAuth start/callback/session route and no production session store. No deployment runtime is selected or created by this contract.
- No authoritative global inbox/list API, event ingress, or command submission contract is established. Keep those routes unavailable; do not synthesize an inbox or reuse privileged Work actions.

## Go/no-go boundaries

1. Continue local adapter/runtime design and isolated tests with synthetic fixtures.
2. Before live backend authentication: implement and review the callback/session route and server-side storage; then BIG must approve/register the exact Metropolis client/callback and supply its secret through a secure configuration path.
3. Before attaching the candidate hostname or deploying: BIG separately approves the production resource change. Confirm the zone and record state again at that time.
4. Prove Greenhouse server → Metropolis arrival → exact authorized Work read → matching readback receipt. Keep event and remote-command interfaces disabled until their existing Hub contracts and owner permissions are established.
