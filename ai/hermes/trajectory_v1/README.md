# HERMES Trajectory SFT v1 — candidate only

This is a **CPU-safe, no-training preparation track**. It does not change `ai/hermes/phase2/HERMES_LiteRTLM_CPU_Trial.ipynb`, existing adapters, checkpoints, or deployment. Gemini in Colab is an optional coding assistant, not an autonomous runner or an authenticated tool.

## Objective
Predict **one next step** per observation: `ASK`, `LOOKUP`, `HANDOFF`, or `STOP`. The model proposes; the authorized runtime verifies permissions and performs any real action. Never treat generated state as observed state.

## Data contract
Each JSONL row contains `id`, `split`, `messages`, `context`, and `target`. `target` holds `next_step`, `owner`, `reason`, `required_evidence`, and `requires_approval`. Context has provenance, freshness, and authorization flags. Examples are **synthetic fixtures**, not approved training data.

## Preparation
```bash
python ai/hermes/trajectory_v1/validate.py ai/hermes/trajectory_v1/examples.synthetic.jsonl
```
Do not train from these fixtures. Before SFT: curate and approve independent training rows, deduplicate by workflow/source lineage, create leakage-resistant train/dev/held-out splits, review PII/secrets, test chat-template assistant-only loss masks, and keep historical 40 + fresh 40 evaluation cases out of training. No GPU start until explicit human approval.

## Acceptance gates
1. Schema + provenance + label validity; zero unauthorized actions.
2. Holdout trajectory next-step accuracy and refusal/STOP safety by scenario.
3. Runtime tool and approval gates tested separately; trace replay and end-state checks.
4. Compare candidate against v1 baseline on the same locked tests; promote only after explicit approval.

## Gemini collaboration
In Colab, ask Gemini to **explain or draft** schema-validation and SFT-preflight cells from this contract, then review generated code/diffs. Never paste credentials, Drive secrets, private datasets or access tokens into Gemini prompts. Keep `RUN_TRAINING=False` by default; do not grant Gemini execution authority.
