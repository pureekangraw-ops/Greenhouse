"""QLoRA continuation and optimizer resume are distinct, evidence-bound operations."""
import gc
import json
import platform
import shutil
import time
from functools import partial
from importlib.metadata import version
from pathlib import Path
from . import MODEL_ID, BASE_REVISION, CAPABILITIES
from .data import read_jsonl, verify_manifest, sha256, canonical
from .artifacts import inventory, seal, verify
from .masking import encode, collate

VERSIONS = {'transformers': '5.18.0', 'peft': '0.21.1', 'accelerate': '1.15.0',
            'bitsandbytes': '0.50.2', 'safetensors': '0.8.0'}

def check_adapter(path):
    path = Path(path)
    config = json.loads((path / 'adapter_config.json').read_text())
    if config.get('base_model_name_or_path') != MODEL_ID or config.get('peft_type') != 'LORA':
        raise ValueError('Adapter architecture mismatch')
    if config.get('revision') not in (None, BASE_REVISION):
        raise ValueError('Adapter base revision mismatch')
    if config.get('r') != 8 or config.get('lora_alpha') != 16 or set(config.get('target_modules', [])) != {'q_proj','k_proj','v_proj','o_proj'}:
        raise ValueError('Unexpected v1 adapter structure')
    if config.get('peft_version') != VERSIONS['peft']:
        raise ValueError('Adapter requires a separately verified PEFT version')
    if not (path / 'adapter_model.safetensors').is_file():
        raise ValueError('Missing original adapter weights')
    return inventory(path)

def preflight(data, original, run, config):
    manifest = verify_manifest(data)
    if set(manifest['required_capabilities']) != CAPABILITIES:
        raise ValueError('Academy training requires all nine capabilities, not a component corpus')
    source = check_adapter(original)
    original, run = Path(original).resolve(), Path(run).resolve()
    if run == original or run.is_relative_to(original) or original.is_relative_to(run):
        raise ValueError('Run directory overlaps immutable adapter')
    if shutil.disk_usage(run.parent).free < 12 * 2**30:
        raise ValueError('Require 12 GiB free disk for base/cache/checkpoints')
    try:
        mem = next(line for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        if int(mem.split()[1]) * 1024 < 6 * 2**30:
            raise ValueError('Require 6 GiB available system RAM')
    except FileNotFoundError:
        raise ValueError('Cannot verify available system RAM on this runtime')
    for p, expected in VERSIONS.items():
        if version(p) != expected:
            raise ValueError(f'{p}: expected {expected}; restart after installing pinned dependencies')
    import torch
    if not torch.cuda.is_available():
        raise ValueError('CUDA GPU unavailable: no training performed')
    props = torch.cuda.get_device_properties(0)
    if props.total_memory < 12 * 2**30:
        raise ValueError('Require at least 12 GiB GPU VRAM')
    if any(config[k] <= 0 for k in ('max_length', 'epochs', 'learning_rate', 'save_steps')):
        raise ValueError('Training parameters must be positive')
    return {'model_id': MODEL_ID, 'base_revision': BASE_REVISION,
            'dataset_manifest_sha256': sha256(Path(data)/'manifest.json'),
            'source_adapter': source, 'versions': {p: version(p) for p in VERSIONS},
            'torch': torch.__version__, 'cuda': torch.version.cuda,
            'python': platform.python_version(), 'config': config,
            'gpu': props.name, 'vram_bytes': props.total_memory}

def run_training(data, original, run, *, resume=None, epochs=2, max_length=2048,
                 learning_rate=2e-5, save_steps=20):
    config = dict(epochs=epochs, max_length=max_length, learning_rate=learning_rate, save_steps=save_steps)
    run = Path(run).resolve()
    run.parent.mkdir(parents=True, exist_ok=True)
    identity = preflight(data, original, run, config)
    if resume:
        if not run.is_dir() or json.loads((run/'identity.json').read_text()) != identity:
            raise ValueError('Resume identity mismatch: dataset/base/adapter/config/runtime changed')
        checkpoint = Path(resume).resolve()
        if checkpoint.parent != run/'checkpoints' or not checkpoint.name.startswith('checkpoint-'):
            raise ValueError('Resume must name a checkpoint in this exact run')
        for f in ['trainer_state.json', 'optimizer.pt', 'scheduler.pt', 'rng_state.pth', 'adapter_model.safetensors']:
            if not (checkpoint/f).is_file():
                raise ValueError(f'Incomplete optimizer resume: {f}')
        if (run/'adapter').exists():
            raise ValueError('Completed run cannot be resumed in place')
    else:
        run.mkdir(exist_ok=False)
        (run/'identity.json').write_text(canonical(identity)+'\n')
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, Trainer, TrainingArguments, set_seed
    from peft import PeftModel, prepare_model_for_kbit_training, get_peft_model_state_dict
    from safetensors.torch import load_file
    set_seed(42)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=BASE_REVISION, trust_remote_code=False)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = 'right'
    splits = {s: read_jsonl(Path(data)/f'{s}.jsonl') for s in ('train','validation')}
    encoded = {s: [encode(tokenizer, r['messages'], max_length) for r in rows] for s, rows in splits.items()}
    (run/'mask-preflight.json').write_text(canonical({'status':'VERIFIED_REAL_TOKENIZER',
         'rows': {s:len(v) for s,v in encoded.items()},
         'max_tokens':{s:max(len(r['input_ids']) for r in v) for s,v in encoded.items()}})+'\n')
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4',
            bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=dtype)
    def load_base():
        return AutoModelForCausalLM.from_pretrained(MODEL_ID, revision=BASE_REVISION,
            quantization_config=quant, device_map={'':0}, torch_dtype=dtype, trust_remote_code=False)
    model = PeftModel.from_pretrained(prepare_model_for_kbit_training(load_base()), str(original), is_trainable=True)
    saved, loaded = load_file(str(Path(original)/'adapter_model.safetensors')), get_peft_model_state_dict(model)
    if set(saved) != set(loaded) or any(not torch.equal(saved[k].float(), loaded[k].detach().cpu().float()) for k in saved):
        raise ValueError('Loaded adapter differs from immutable v1 weights')
    del saved, loaded
    model.config.use_cache = False
    batch = collate(tokenizer, encoded['train'][:2])
    loss = model(**{k:v.to(model.device) for k,v in batch.items()}).loss
    if not torch.isfinite(loss):
        raise ValueError('Non-finite backward preflight loss')
    loss.backward()
    grads = [p.grad for p in model.parameters() if p.requires_grad and p.grad is not None]
    if not grads or not all(torch.isfinite(g).all() for g in grads):
        raise ValueError('Non-finite or missing adapter gradients')
    model.zero_grad(set_to_none=True)
    args = TrainingArguments(output_dir=str(run/'checkpoints'), num_train_epochs=epochs,
        per_device_train_batch_size=1, per_device_eval_batch_size=1, gradient_accumulation_steps=8,
        learning_rate=learning_rate, save_strategy='steps', save_steps=save_steps,
        eval_strategy='steps', eval_steps=save_steps, save_total_limit=3, logging_steps=5,
        bf16=dtype==torch.bfloat16, fp16=dtype==torch.float16, gradient_checkpointing=True,
        gradient_checkpointing_kwargs={'use_reentrant':False}, report_to='none', seed=42,
        remove_unused_columns=False, save_safetensors=True, push_to_hub=False)
    trainer = Trainer(model=model, args=args, train_dataset=encoded['train'], eval_dataset=encoded['validation'],
        data_collator=partial(collate,tokenizer), processing_class=tokenizer)
    started = time.monotonic()
    try:
        result = trainer.train(resume_from_checkpoint=str(checkpoint) if resume else None)
        trainer.save_state()
        trainer.save_model(str(run/'adapter'))
        tokenizer.save_pretrained(str(run/'adapter'))
        (run/'training.json').write_text(canonical({'metrics':result.metrics,'seconds':time.monotonic()-started,
            'global_step':trainer.state.global_step,'history':trainer.state.log_history})+'\n')
        probe = splits['validation'][0]['messages'][:-1]
        def infer(m):
            m.eval(); m.config.use_cache=True
            inp = tokenizer.apply_chat_template(probe, tokenize=True, add_generation_prompt=True, return_tensors='pt').to(m.device)
            with torch.inference_mode(): out=m.generate(inp,max_new_tokens=256,do_sample=False,pad_token_id=tokenizer.pad_token_id)
            return out[0,inp.shape[1]:].detach().cpu().tolist()
        before = infer(model)
        del trainer, model
        gc.collect(); torch.cuda.empty_cache()
        reloaded = PeftModel.from_pretrained(load_base(),str(run/'adapter'),is_trainable=False)
        after = infer(reloaded)
        if before != after:
            raise ValueError('Save/reload deterministic inference mismatch')
        if inventory(original) != identity['source_adapter']:
            raise ValueError('Original adapter was changed')
        (run/'reload.json').write_text(canonical({'status':'VERIFIED','same_tokens':True,
             'token_ids':after,'source_adapter_unchanged':True})+'\n')
        seal(run/'adapter')
        seal(run)
        return verify(run)
    except Exception as exc:
        (run/'failure.json').write_text(canonical({'status':'FAILED','exception_type':type(exc).__name__,
                                                   'message':str(exc)})+'\n')
        raise
