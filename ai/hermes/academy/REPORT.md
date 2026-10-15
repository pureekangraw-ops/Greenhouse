# HERMES Academy recovery — observed results

Status: **PARTIAL BUILD / CPU COMPONENTS TESTED / END-TO-END NOT VERIFIED**.

Branch: `recovery/hermes-academy-20261015`, based on Greenhouse main `8f295a0352349a5453ff9a1d42eb568e7d6da0ef`. Original HERMES branches and Drive artifacts are unchanged. No merge, deployment, new paid service, Factory queue or dispatch occurred.

## Existing-system audit

Read the HERMES branches and historical training notebook revisions; downloaded and parsed Academy Term1, Nursery, 3 Stages, two distinct v4 revisions, standalone v4 and v2 Preflight. `evidence/original-audit.json` records original file hashes and recorded errors; `drive-inventory.json` maps names to original IDs.

- Standalone v4: 540 synthetic, unreviewed rows, 360/90/90. Exactly 540 distinct strings, but only 108 base requests after removing the four observed request prefixes: 432 prefix variants. PROCEED 285, DENY 150, ASK 105; KEEP/DISCARD/DEFER absent. **0 of these 540 qualified for the requested real-data corpus.** Independent semantic label verification has not occurred.
- Non-standalone v4: actual recorded missing-companion AssertionError, followed by DATASET_READY NameError. Replacing `rows` with reviewed JSONL leaves `splits` pointing at old data; its false-review assertion conflicts with fully reviewed data. Its sandbox uses invented tool aliases rather than the actual GO argument contract.
- Older Academy “lessons” include prompted inference, which does not update weights. The 3 Stages notebook uses SFT without demonstrated assistant-only masking and transient `/content` outputs. Training against prompt tokens and losing checkpoints are material risks.
- Standalone v4 fixes delivery of the synthetic files, not their provenance, label quality, full runtime tool schema or end-to-end execution. A requested training flag is not evidence of a successful run.
- Original v1 preparation ZIP hash matches `a8687ec549673599dbce9b3534f395851d158aea6c5a114cd295ca7bca8d1a56`; ZIP CRC and all 17 manifest entries verified. Adapter architecture and recorded package versions were inspected; original inference was not rerun here. Historical 40/40 and fresh 38/40 remain historical source reports, not this task's results.

## Built and actually checked

- Provenance/license registry, repository-lineage split validation, exact duplicate rejection, source-record checks, six-decision/nine-capability gates, dataset manifest/readback, benchmark source quarantine and upstream-synthetic controls.
- 300 source-linked repository commit pairs from pinned CommitPackFT Python: 100 train, 100 validation, 100 held-out. MIT-marked source repositories, changed before/after files, AST syntax validation, preserved source and commit references. This is **component structural qualification**, not behavior certification or full Academy qualification. Authorship is not independently proven human.
- Assistant-only masking uses real tokenizer offsets at every assistant turn. Actual v1 tokenizer exposed boundary-spanning tokens that invalidate the old token-prefix assertion. The fix masks those boundary tokens. All 300 records passed the actual-original-tokenizer CPU check; maximum length is below 2048. Full HF template compatibility still needs its runtime preflight.
- QLoRA v1 continuation, pinned versions verified to exist on PyPI, no-overwrite run/source guards, memory/disk/CUDA checks, exact identity-based optimizer resume, backward probe, logging, deterministic save/reload token comparison and immutable source readback. **GPU path has not run.**
- Generated-response evaluation, schema checks, arguments/authorization checks, unnecessary ASK metrics, preserved 40-case regression runner, verified adapter/run export and SHA-256/ZIP readback. **No candidate model inference or export of trained candidate occurred.**
- Self-contained Colab notebook with embedded package, component corpus, tests and test-only legacy files. All CPU cells ran sequentially. Its full Academy gate correctly reports missing eight capabilities; TRAIN and model TEST stay disabled.
- **27/27 local unit/contract tests passed**; **98/98 existing Node tests passed**. Compile checks passed. These do not establish production or model quality.
- Actual authorized GO calls returned PANTHEON HEALTHY and Factory CONNECTED, LOGIC READY; CODE/VISUAL UNKNOWN. Saved responses prove read-only connectivity, not a HERMES-driven sandbox execution.

## Material blockers and unmet acceptance

1. There is no qualified, source-grounded nine-capability corpus or independently checked RCA/planning/recovery/collaboration labels in the inspected materials. The original 540 cannot be promoted by changing their review flags. No new synthetic rows were authored to fill that gap.
2. Glaive's real upstream payload downloaded (112,960 records; raw hash in status.json), but it contains generated conversations. The user's distinction between real data and permitted public generated datasets needs resolution before admission. None was used for training or counted as qualified. xLAM metadata is accessible but its pinned payload returned HTTP 401.
3. This executor has no CUDA GPU or callable Colab execution tool. No training, candidate backward execution, resume execution, candidate save/reload or actual regression generation can be asserted.
4. HERMES-driven PANTHEON/Factory sandbox job, multi-step error recovery, runtime receipt/readback and LIGHT runtime acceptance remain unrun. Read-only health and local policy tests cannot substitute for them.
5. Exact-match metrics are insufficient alone for open-ended RCA/planning; independently verified rubrics or executable acceptance criteria and test traces are still required. Benchmark-name filtering alone does not prove semantic decontamination.

**BUILD acceptance is not complete. TEST acceptance is not complete. No model is declared ready for PANTHEON, Factory District, GO or LIGHT.** The draft recovery remains reviewable and rerunnable; it is not presented as the final HERMES system.

## Reproduce and continue

Use README.md for exact CLI commands and Colab opening steps. CPU validation requires no companion files. Keep the original adapter read-only; provide a qualified full corpus with provenance/quality evidence, rerun full validation, then perform an authorized GPU run. Run baseline and candidate against the same locked regression and heldout, inspect raw failures, and execute the controlled system sandbox with real receipts before changing any readiness status. No production deployment follows automatically.
