# HERMES Academy recovery

**PARTIAL BUILD — NOT TRAINED / NOT VERIFIED END TO END.** This recovery preserves the existing notebooks, Adapter v1 and historical benchmarks. It adds working validation/training/evaluation components, but does not certify a nine-capability corpus or a production model. The Colab CPU path has actually run; GPU training, candidate inference and sandbox system execution have not.

Open `HERMES_Academy_Recovery.ipynb` in Colab using File → Open notebook → GitHub → `pureekangraw-ops/Greenhouse`, branch `recovery/hermes-academy-20261015`. The notebook embeds package, tests, legacy 40-case test and code corpus with SHA-256 checks. No companion uploads are required for its CPU validation path.

## What the original audit established

See `evidence/original-audit.json` and `REPORT.md`. The standalone 540 rows are all `synthetic_author_created` / `UNREVIEWED`: 108 base requests multiplied by five prefix variants, with no KEEP, DISCARD or DEFER labels. The non-standalone v4 records a missing-companion error. Reviewed replacement rows do not replace its split variables, and its “all reviewed must be false” assertion prevents qualified replacement data from working. Its final status depends partly on requested flags rather than actual execution records. Those notebooks remain unchanged; this package avoids those defects.

Original v1 package: Drive file `1fhouSQxwuYLjyB-m-s3KeDc4KP-f7uWZ`, SHA-256 `a8687ec549673599dbce9b3534f395851d158aea6c5a114cd295ca7bca8d1a56`. Restore a copy under `MyDrive/HERMES_Academy_Recovery/original/adapter_v1`; do not replace the original archive or adapter. Its 17 manifest entries were verified locally. Source metadata specifies Qwen revision `989aa7980e4cf806f80c7fef2b1adb7bc71aa306`, rank 8, alpha 16, q/k/v/o, PEFT 0.21.1. Architecture metadata and byte verification do not prove GPU compatibility.

## Data and qualification

`data/code-commits` contains **300 real repository commit pairs**, selected from pinned CommitPackFT Python data, MIT-marked repositories. The corpus has 100 train, 100 validation, 100 held-out examples. Repository lineage is disjoint; both source versions parse as Python, targets differ from inputs, and source commit links are retained. These checks do **not** prove code behavior, intent/RCA correctness or complete benchmark decontamination. Benchmark-name quarantine is a limited filter, not proof that pretraining or upstream datasets were uncontaminated. Do not present these 300 rows as a fully reviewed Academy training corpus.

All 300 have been tokenized using the actual original v1 tokenizer and explicit ChatML on CPU. The full HF chat-template/runtime and GPU backward checks still execute in the training preflight. No code taken from a dataset is executed by curation.

Each qualified row has `id`, `lineage`, `source`, `source_record`, `origin`, `capabilities`, `quality`, and `messages`. Optional `response_schema` defines exact generated JSON validation; the answer appears only in the last assistant message. Quality evidence must describe how a source answer was checked. Sources have URL, immutable revision, license evidence, raw SHA-256, benchmark exclusion and explicit upstream-synthetic policy. Test fixtures under `tests/` are synthetic and never enter the corpus.

**Remaining data gate:** independently checked examples across all nine capabilities, all six decisions in every split, real authorized tool arguments, recovery traces and evidence-based collaboration labels. Glaive is an available public Apache-2.0 dataset with generated conversations, not human operation evidence; use requires resolving the user's requested origin policy. xLAM's pinned payload returned HTTP 401 in this environment; metadata alone is not a downloaded/qualified dataset.

## Reproduce available checks

Run from repository root with Python 3.12+ and jsonschema:

```sh
python -m unittest discover -s ai/hermes/academy/tests -v
python -m compileall -q ai/hermes/academy
npm test
python -c "from ai.hermes.academy.data import verify_manifest; print(verify_manifest('ai/hermes/academy/data/code-commits')['counts'])"
```

The complete Academy gate intentionally rejects the component-only corpus:

```sh
python -m ai.hermes.academy validate ai/hermes/academy/data/code-commits
```

To reproduce curation, download the immutable URL in `data/code-commits/sources.json`, verify its raw SHA-256, then run:

```sh
python -m ai.hermes.academy prepare-commits /path/to/commitpack-python.jsonl /fresh/output
```

To reproduce the original audit, download the source notebooks (IDs in `evidence/drive-inventory.json`) and original package without modifying them:

```sh
python -m ai.hermes.academy.audit_originals /path/to/notebooks /path/to/HERMES_v2_Preparation_for_LIGHT_20261014.zip /fresh/audit.json
```

## GPU training and exact resume

The notebook installs the pinned requirements only when a fully qualified corpus passes and training is requested. Keep Colab's CUDA-enabled torch, restart after changing already imported packages, then rerun PREPARE. Preflight verifies exact user-space versions, 12 GiB disk, 6 GiB system RAM, 12 GiB VRAM and CUDA. Full tokenizer masking happens before loading model weights; each assistant turn is masked by verified offsets, with boundary-spanning tokens excluded and no target truncation.

```sh
python -m ai.hermes.academy validate /qualified/data --write-manifest
python -m ai.hermes.academy train /qualified/data /preserved/adapter_v1 /fresh/persistent/run
python -m ai.hermes.academy train /qualified/data /preserved/adapter_v1 /same/run --resume /same/run/checkpoints/checkpoint-20
```

Manifest creation refuses overwrite. Starting a new run refuses an existing run directory. Resume requires matching corpus/base/source bytes/package versions/configuration and a complete optimizer/scheduler/RNG/checkpoint. A fresh optimizer continuation from v1 is not resume. Saved adapter reload must reproduce deterministic validation token IDs. The original adapter's inventory is checked again after training.

## Actual model evaluation and export

```sh
python -m ai.hermes.academy evaluate /qualified/data /run/adapter /new/candidate-heldout.json
python -m ai.hermes.academy regression /preserved/adapter_v1 /new/v1-regression.json
python -m ai.hermes.academy regression /run/adapter /new/candidate-regression.json
python -m ai.hermes.academy verify /run
python -m ai.hermes.academy export /run /new/hermes-run.zip
```

Generation is scored with raw outputs, exact fields, required JSON schema, tool argument validation, unnecessary ASK and authorization violations, split by capability. Missing predictions fail. Exact match alone is insufficient for semantically variable planning/RCA; those domains still need independently reviewed executable/rubric acceptance criteria. Legacy 40 cases are synthetic classification regression only, stored separately and never trained. Compare baseline/candidate on the same locked tests; do not tune on the heldout.

Export is a byte-verified **LoRA adapter/run ZIP**, not a merged base model or `.litertlm` conversion. No unsupported conversion is claimed.

## Integration boundary

`integration.py` snapshots actual GO tool names and validates required task IDs and independent owner approval. `repo_read`, `receipt_read` and `repo_ci_read` in the old synthetic curriculum are not automatically executable GO tools. Unit tests check that model-controlled `approved=true` cannot grant authority. No unit test dispatches real work.

`evidence/live-pantheon.json` and `live-factory.json` contain actual authorized read-only health responses. They prove connectivity only: LOGIC READY, CODE/VISUAL UNKNOWN. They do not prove HERMES inference, a sandbox job, a Factory receipt, LIGHT runtime execution or end-to-end acceptance. Those integrations remain **UNVERIFIED**. No production task, queue, dispatch, merge or deployment was performed.
