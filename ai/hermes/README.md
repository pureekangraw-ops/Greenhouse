# HERMES Mobile-first Model Lab

Experimental branch only. No merge, production integration, or public model release. This lab prepares a QLoRA experiment using `Qwen/Qwen2.5-1.5B-Instruct` and a free Colab GPU only when offered.

## Verified-data gate

The notebook no longer trains on the former eight synthetic command labels (`FIND`, `INTAKE`, etc.): those labels are not defined by the current Greenhouse/HERMES runtime contract. The current repository also does not contain a qualified HERMES training corpus or an approved HERMES response JSON Schema. The notebook therefore stops before loading the base model unless the owner supplies source-reviewed inputs in private Google Drive:

- `MyDrive/HERMES/data/train.jsonl`
- `MyDrive/HERMES/data/eval.jsonl`
- `MyDrive/HERMES/data/response-schema.json`

Each JSONL row must contain `id`, `group_id`, `case_type`, `prompt`, `expected`, and `evidence_ref`. Evaluation must include `normal`, `ambiguous`, `unknown`, and `unsafe` cases. Train/eval groups must be disjoint; expected outputs must pass the supplied schema. The preflight performs duplicate, leakage, schema, and basic secret/PII checks; these checks do not replace human data review.

## Run

1. Open `notebooks/01_train_qlora_colab.ipynb` from this branch in Colab.
2. Select **T4 GPU** only. Free GPU allocation is not guaranteed; do not upgrade or choose paid hardware.
3. Review the corpus/schema in Drive, then run cells in order. The notebook records baseline results, trains QLoRA, evaluates on held-out cases, writes checkpoints/adapter/tokenizer/config/logs/evaluation/checksums to `MyDrive/HERMES/runs/<UTC run id>/`, reloads the adapter, and verifies a held-out response against the schema.
4. Keep datasets and model weights in Drive; do not commit them to GitHub.

`notebooks/02_merge_export_litertlm.ipynb` currently merges a Hugging Face adapter only. It does not implement or verify the `.litertlm` conversion workflow. LiteRT-LM compatibility and Xiaomi/HERMES device acceptance remain pending until an actual converter and device inference test pass. A merged Hugging Face checkpoint is not a `.litertlm` file.

No model training, adapter creation, LiteRT conversion, or device acceptance is claimed by this repository update.
