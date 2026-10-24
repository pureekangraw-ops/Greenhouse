# HERMES AI Model Lab Plan

Owner authorized end-to-end: inspect both existing notebooks, correct QLoRA dependencies, recover runtime, train and evaluate independently, save Drive artifacts and read back, check LiteRT-LM feasibility. No purchase/subscription/merge/deploy.

1. Audit branch feat/hermes-colab-lab-20261012 source e9bbf751e1961a24243691d3b981c1d23f045b31.
2. Preserve its eight command labels. Replace 8 phrases repeated 8 times with 192 synthetic train phrases, 16 independent validation and 40 independent test phrases. No private data. Validate exact disjointness.
3. Prepare NF4 float16 QLoRA explicitly. Assistant-only loss; Trainer avoids version-sensitive TRL arguments. Resolve immutable base revision. Batch1/accum8/r8/3epochs/72steps.
4. Prove Drive write/readback before training; save checkpoints every24steps. Baseline, actual training, adapter save.
5. Destroy in-memory model; reload saved adapter and evaluate independent test. Save raw predictions and metrics; lab threshold95%, production acceptance remains false.
6. Hash all files and read them back; inspect adapter tensors/checkpoints and independent Drive metadata.
7. Inspect official Qwen2.5 LiteRT-LM export recipe. Conversion and physical-device acceptance require actual evidence.

Runtime recovery bounded to two reconnections with concrete error inspection. Do not touch another active session. Notebook-only validation and real inference are scope checks.
