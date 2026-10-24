# HERMES Phase 2 — Restore and Package

This branch prepares **existing** Q8_0 GGUF artifacts for reproducible delivery. Do not retrain, re-merge, commit model weights, or describe Android inference as verified.

## Source of truth

Google Drive folder: https://drive.google.com/drive/folders/1_0vuwBMdbPC_Bp87_J5LDBOyiUlPYfT0

Download into one working directory, preserving filenames:
- HERMES_Phase2_Drive.zip.part001 through part018
- HERMES_Drive_Manifest.json
- Restore_HERMES.py

The Drive package has 18 transport chunks totaling 1,656,883,590 bytes. Manifest archive SHA-256: `1aa08e547719d93184d2a557de60363957435e1e523fddbf3bb90f5482c997f4`. This is an **expected** checksum, not a successful readback from GitHub Actions.

## Restore on a machine with sufficient free space

```sh
python3 --version
python3 Restore_HERMES.py
```

Requires Python 3.11+ and enough available storage for both 1.66 GB input chunks and the rebuilt ZIP plus extracted GGUF (~1.65 GB), with headroom. Check available disk first.

The original script compares every part hash, assembled archive hash, and extracted file hash against the Drive manifest. For untrusted archives, avoid running the original ZIP extractall directly: use the hardened restore tool added in this branch instead. Never use GitHub Actions to fetch 1.66 GB of private Drive files through public download links or embed secrets in source.

## Acceptance gates

1. Source manifest and all 18 parts present, filenames and byte counts match.
2. Verify per-part SHA-256, rebuild ZIP, verify ZIP SHA-256.
3. Inspect ZIP members for path traversal, duplicate/unexpected names and size mismatches; extract to a fresh directory, verify every file SHA-256.
4. Record PASS/FAIL log with hashes and actual command output. Failure must not be relabeled PASS.
5. Deliver a single validated ZIP, instructions, and hash file. A ZIP without readback evidence is not final.
6. Independently test Android runtime and model loading. Existing Linux CPU classification reported 38/40; **Android remains UNVERIFIED**.
7. Consider LiteRT-LM only if GGUF runtime/device constraints require it.

No deployment, paid cloud, or model training is authorized by this preparation branch.
