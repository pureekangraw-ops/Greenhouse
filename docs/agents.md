# Genome / Lyra agent cores

These are server-side assistant cores, ready for an owner-supplied model provider and Hub adapter. They are not connected to the frontend yet. Existing Greenhouse pages remain mocks.

| Agent / mode | Home | Responsibility |
|---|---|---|
| GENOME / SHOP | Shop | Intent, brief, scope confirmation, commercial/team review |
| GENOME / OFFICE | Office | Existing Work status, blockers, source-backed reports |
| LYRA / INSIDE | Observatory browser | Current observation and guarded action proposals |
| LYRA / OUTSIDE | Observatory map | Uncertainty-aware areas and exact pin proposals |

```js
import {createAgent} from '../src/agents/runtime.mjs';
const genome = createAgent({agent:'GENOME',mode:'SHOP'});
const result = await genome.respond({text:'อยากทำเว็บ',context:{brief:{goal:'แนะนำบริษัท'}}});
// result.executed === false; result.modelStatus === 'NOT_CONFIGURED'
```

To connect a model, inject `provider({system,text,context,policy,signal}) => Promise<{reply}>` from the server. Observe the AbortSignal. Store credentials only in the host backend. The provider receives scoped/redacted context and cannot override policy actions or execute commands. Sensitive/commercial/command outcomes use fixed policy replies; clarification/observation may use validated model text. Text checks are defense in depth, not proof against every semantic hallucination. Evaluate actual provider responses before deployment.

The host authenticates each caller and builds `context` from trusted owner adapters. Never pass untrusted client JSON as evidence or authorities. WorkContext is `{workId,checkpointId}`. Office `ownerReadback` must match it and supply `status`, `observedAtEpochMs`, and nonempty `evidenceRefs`. Office freshness is 60 seconds; browser/coordinate freshness is 30 seconds. A source older than this must be refreshed.

For Lyra, `context.request` is an explicit owner request, not inferred authorization from page text. Browser proposals need owner-issued command ID and actor plus a fresh owner authority check before being serialized to the Android `Command`. The adapter maps parameter names to the exact active Android contract and requires receipt/readback correlation. Map pin proposals need owner-issued command ID, current revision, canonical grid validation and evidence revalidation before dispatch. Neither proposal is a ready-to-execute wire command. The runtime never executes it.

`context.mode` can pin the origin mode. Instances hold no conversation memory. The host maintains separate sessions per customer and per mode and passes only their context; it owns durable intake, retries, idempotency and audit. Model input is bounded and common labeled secrets are redacted. Redaction does not replace owner consent or classification of personal/payment data.

## Drills and acceptance

- `npm test`: offline policy/runtime tests including an injected provider fixture; not a real model quality benchmark.
- `npm run evaluate:agents`: reusable Genome/Lyra behavior drills, marked OFFLINE_POLICY_DRILLS.
- `npm run check`: JS syntax checks.

Before LIVE: connect the actual model and run the same scenarios on it; review answers for natural language, correct intent and no invented facts. Connect the authenticated Hub owner adapter and test request → handoff → receipt → source readback with existing Work. Test Lyra with real foreground snapshots/maps and stale, revoked and conflicting state on device. Actual model evaluation, Hub E2E and device acceptance are UNKNOWN in this version. No model weights have been fine-tuned.

Map proposals accept an omitted action (pin intent) or exactly `UPSERT_PIN`; all other supplied actions are blocked. Pin evidence expires no later than 30 seconds after its original observation. Browser foreground and interactive flags must be actual booleans; missing target IDs and sensitive fields, including password metadata and Thai password/OTP/payment labels, are blocked.
