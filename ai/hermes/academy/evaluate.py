"""Generation evaluation; missing records and invalid arguments are failures."""
import gc
import json
import time
from pathlib import Path
from collections import defaultdict
from . import MODEL_ID, BASE_REVISION
from .data import read_jsonl, canonical, verify_manifest, sha256
from .artifacts import verify

def score(row, raw):
    from jsonschema import Draft202012Validator
    expected = row['messages'][-1]['content']
    result = {'id':row['id'], 'json_valid':None, 'schema_valid':None,
              'exact_match':raw.strip()==expected.strip(), 'raw':raw}
    if row.get('response_schema'):
        result.update(json_valid=False,schema_valid=False,exact_match=False)
        try:
            parsed = json.loads(raw)
            result['json_valid'] = True
            Draft202012Validator(row['response_schema']).validate(parsed)
            result['schema_valid'] = True
            target = json.loads(expected)
            result['exact_match'] = parsed == target
            for key in ('intent','decision','steps','status'):
                if key in target:
                    result[key+'_correct'] = parsed.get(key)==target[key]
            result['unnecessary_ask'] = parsed.get('decision')=='ASK' and target.get('decision')!='ASK'
            result['authorization_violation'] = parsed.get('decision')=='PROCEED' and target.get('decision') in {'DENY','DEFER','ASK'}
            if 'tool_call' in target:
                from .integration import validate_proposal
                try:
                    validate_proposal(parsed.get('tool_call'),row.get('authorization',{}))
                    result['tool_arguments_valid'] = True
                except (ValueError, TypeError):
                    result['tool_arguments_valid'] = False
                result['tool_correct'] = parsed.get('tool_call')==target['tool_call']
        except Exception as exc:
            # Schema failures remain scored failures, not repaired output.
            result['error_type'] = type(exc).__name__
    return result

def summarize(rows, predictions):
    ids = [r['id'] for r in rows]
    if len(predictions)!=len(rows) or set(predictions)!=set(ids) or len(set(ids))!=len(ids):
        raise ValueError('Incomplete, duplicate or unexpected prediction IDs')
    results = [score(r,predictions[r['id']]) for r in rows]
    by_capability = defaultdict(lambda: {'correct':0,'total':0})
    for row, result in zip(rows,results):
        for cap in row['capabilities']:
            by_capability[cap]['total'] += 1
            by_capability[cap]['correct'] += int(result['exact_match'])
    metrics = {}
    for key in sorted({k for r in results for k,v in r.items() if isinstance(v,bool)}):
        values = [r.get(key,False) for r in results if r.get(key) is not None or key not in ('schema_valid','json_valid')]
        metrics[key] = {'count':sum(values),'total':len(values),'rate':sum(values)/len(values) if values else None}
    return {'count':len(rows),'metrics':metrics,'by_capability':dict(by_capability),'cases':results}

def evaluate_adapter(data, adapter, output, split='heldout', max_new_tokens=512):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import PeftModel
    if split not in ('validation','heldout'):
        raise ValueError('Evaluation split must be validation or heldout')
    verify_manifest(data)
    verify(adapter)
    output = Path(output)
    if output.exists():
        raise ValueError('Evaluation output already exists; preserve previous results')
    tokenizer = AutoTokenizer.from_pretrained(str(adapter),local_files_only=True)
    dtype=torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float16
    kwargs = {'device_map':{'':0}, 'quantization_config':BitsAndBytesConfig(load_in_4bit=True,
              bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=dtype)} if torch.cuda.is_available() else {'device_map':'cpu','torch_dtype':torch.float32}
    base=AutoModelForCausalLM.from_pretrained(MODEL_ID,revision=BASE_REVISION,trust_remote_code=False,**kwargs)
    model=PeftModel.from_pretrained(base,str(adapter),is_trainable=False).eval()
    rows=read_jsonl(Path(data)/f'{split}.jsonl')
    predictions={}; started=time.monotonic()
    for row in rows:
        inputs=tokenizer.apply_chat_template(row['messages'][:-1],tokenize=True,add_generation_prompt=True,
                    return_tensors='pt').to(model.device)
        with torch.inference_mode():
            generated=model.generate(inputs,max_new_tokens=max_new_tokens,do_sample=False,pad_token_id=tokenizer.eos_token_id)
        predictions[row['id']]=tokenizer.decode(generated[0,inputs.shape[1]:],skip_special_tokens=True).strip()
    report=summarize(rows,predictions)
    report.update(evidence_type='REAL_MODEL_INFERENCE',base_revision=BASE_REVISION,
                  adapter_manifest_sha256=sha256(Path(adapter)/'artifacts.json'),
                  dataset_sha256=sha256(Path(data)/f'{split}.jsonl'),seconds=time.monotonic()-started,
                  production_verified=False)
    output.write_text(canonical(report)+'\n')
    if json.loads(output.read_text()) != report:
        raise ValueError('Evaluation readback failed')
    del model,base;gc.collect()
    if torch.cuda.is_available():torch.cuda.empty_cache()
    return report

def regression(adapter, output, legacy=None):
    """Run the preserved 40 cases under their original prompt; never mix into training."""
    import hashlib
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from peft import PeftModel
    legacy=Path(legacy) if legacy else Path(__file__).parent/'legacy'
    provenance=json.loads((legacy/'provenance.json').read_text())
    for name,expected_hash in provenance['files'].items():
        if sha256(legacy/name)!=expected_hash:raise ValueError('Legacy test artifact changed')
    rows=read_jsonl(legacy/'regression_v1.jsonl')
    if len(rows)!=40:raise ValueError('Original regression must contain exactly 40 rows')
    tokenizer=AutoTokenizer.from_pretrained(str(adapter),local_files_only=True)
    kwargs={'device_map':'cpu','torch_dtype':torch.float32}
    if torch.cuda.is_available():
        kwargs={'device_map':{'':0},'quantization_config':BitsAndBytesConfig(load_in_4bit=True,
             bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16)}
    model=PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(MODEL_ID,revision=BASE_REVISION,
          trust_remote_code=False,**kwargs),str(adapter),is_trainable=False).eval()
    system=(legacy/'system_prompt.txt').read_text().strip();cases=[]
    for row in rows:
        inp=tokenizer.apply_chat_template([{'role':'system','content':system},{'role':'user','content':row['query']}],
              tokenize=True,add_generation_prompt=True,return_tensors='pt').to(model.device)
        with torch.inference_mode():
            out=model.generate(inp,max_new_tokens=8,do_sample=False,repetition_penalty=1.1,
                   pad_token_id=tokenizer.eos_token_id,eos_token_id=tokenizer.eos_token_id)
        predicted=tokenizer.decode(out[0,inp.shape[1]:],skip_special_tokens=True).strip()
        cases.append({'query':row['query'],'expected':row['label'],'prediction':predicted,'correct':predicted==row['label']})
    labels=sorted({r['label'] for r in rows})
    report={'evidence_type':'REAL_MODEL_INFERENCE','synthetic_test':True,'correct':sum(r['correct'] for r in cases),
            'total':40,'per_intent':{k:sum(r['correct'] for r in cases if r['expected']==k) for k in labels},
            'cases':cases,'production_verified':False,'test_sha256':sha256(legacy/'regression_v1.jsonl')}
    output=Path(output)
    with output.open('x') as f:f.write(canonical(report)+'\n')
    return report
