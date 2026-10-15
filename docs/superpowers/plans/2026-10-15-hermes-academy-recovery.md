# HERMES Academy Recovery Implementation Plan

**Goal:** recover existing Academy into a reproducible, evidence-gated training and testing workflow; preserve v1 and historical results.

**Architecture:** retain the original notebooks as immutable references. Add one Python package for data validation, assistant-only tokenization, training/resume, generation evaluation, artifacts and sandbox integration. Generate a standalone Colab notebook embedding the exact package and qualified data, so its execution does not depend on mutable branch URLs or missing companions. The model proposes calls; an authorized runtime remains responsible for execution.

**Tech stack:** Python 3.12+, Qwen2.5-1.5B-Instruct pinned base revision, PEFT QLoRA, Transformers Trainer, JSON Schema, unittest. GPU training requires all corpus and runtime checks first.

**Spec:** user's HERMES Academy End-to-End Recovery requirements, 2026-10-15.

## Global constraints
- No merge, production deployment, paid provisioning or original-data deletion.
- Original v1 artifact and regression outputs remain immutable. Continuing an adapter is not optimizer resume.
- No synthetic examples authored to fill quotas; disclose upstream synthetic sources separately.
- Holdouts and benchmarks never become training data; split by source lineage, not shuffled paraphrases.
- Never equate unit/sandbox tests with production acceptance.

## Review focus
- Reviewed replacement data must replace the actual split inputs, without contradictory review assertions.
- Assistant-only masks must exclude tool/user tokens at every turn; reject truncated targets.
- Resume must bind optimizer/checkpoint to the same corpus, base, packages and run configuration.
- Evaluation must score generated responses and fail incomplete/malformed predictions, including missing fields.
- Saved adapters and manifests must read back unchanged; no success based on configuration flags.

## Tasks
- [x] Audit all branch and Drive notebook revisions; decode embedded 540 rows without running their model cells; verify original v1 package hashes.
- [ ] Build provenance/license-aware corpus validation with duplicate/lineage/coverage/benchmark quarantine and manifest hashes.
- [ ] Build preflight and assistant-only tokenization; test using the pinned real tokenizer before model loading.
- [ ] Implement QLoRA continuation, checkpoint identity and exact resume, structured logs, immutable source hashes, save/reload/inference.
- [ ] Implement per-capability generation metrics, legacy 40-case regression, tool schema/policy sandbox and explicit live-evidence status.
- [ ] Generate standalone Colab from the same tested modules; verify embedded readback, syntax, imports and paths.
- [ ] Execute local tests, corpus validation and available runtime checks; record GPU/live integration limitations truthfully.

Native execution follows the user's explicit instruction to continue PLAN → BUILD → TEST without repeated approval. Design review is performed against those supplied acceptance criteria; no production authority is implied.

## Observed stopping point

Partial implementation and CPU verification are delivered in `ai/hermes/academy/REPORT.md`. Whole-BUILD acceptance is blocked by missing qualified nine-capability data; GPU and system acceptance remain unverified. Unchecked tasks are intentionally not claimed complete.
