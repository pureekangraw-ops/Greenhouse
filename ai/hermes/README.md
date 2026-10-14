# HERMES Mobile-first Model Lab

Experimental branch only. No merge/deploy. This lab trains Qwen2.5-1.5B-Instruct with synthetic command examples using a free Colab GPU when available. It does not use private data.

1. Open `notebooks/01_train_qlora_colab.ipynb` from GitHub in Colab and select T4 GPU if offered.
2. Run cells, inspect any library compatibility errors, and save `/content/hermes-lora` to Drive or download it.
3. Open `notebooks/02_merge_export_litertlm.ipynb`, restore the adapter, and merge.
4. Follow current LiteRT-LM exporter documentation. Conversion and HERMES compatibility are **not verified**.

Do not commit model weights, secrets, tokens, or personal data to GitHub. Colab's GitHub integration does not automatically sync training artifacts to Drive. This is a minimal reproducible lab; the original ZIP kit remains a separate download.
