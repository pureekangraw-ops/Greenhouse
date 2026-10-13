"""Run in the existing Colab kernel after conversion completed.

Repack metadata only, preserve binary sections, rerun the real 40-case test.
"""
from pathlib import Path
import os,json,hashlib,shutil,subprocess,time

assert 'ROOT' in globals() and 'DEST' in globals(), 'Use this cell in the existing HERMES Colab notebook/runtime; do not reset it.'
ROOT=Path(ROOT)
DEST=Path(DEST)
PY=str(ROOT/'venv/bin/python')
candidate=ROOT/'litert-output/model.litertlm'
assert candidate.is_file(), f'Converted model is not present: {candidate}'
assert (ROOT/'evaluate_litert.py').is_file()
assert (ROOT/'logs/merged-evaluation.json').is_file()

def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

def save_copy(source,target):
    expected=digest(source)
    if target.exists():
        assert digest(target)==expected, f'Existing file differs: {target}'
        return expected
    partial=Path(str(target)+'.partial')
    assert not partial.exists(), f'Incomplete copy exists: {partial}'
    shutil.copyfile(source,partial)
    assert digest(partial)==expected
    partial.rename(target)
    return expected

def persist():
    shutil.copytree(ROOT/'logs',DEST/'logs',dirs_exist_ok=True)

def run_step(args,name,extra_env=None):
    env=os.environ.copy()
    if extra_env:env.update(extra_env)
    try:
        with (ROOT/'logs'/name).open('w') as log:
            proc=subprocess.Popen(args,stdout=log,stderr=subprocess.STDOUT,env=env)
            while proc.poll() is None:
                time.sleep(10)
                lines=(ROOT/'logs'/name).read_text(errors='replace').splitlines()
                if lines:print(name,lines[-1][-300:],flush=True)
            if proc.returncode:
                print((ROOT/'logs'/name).read_text(errors='replace')[-7000:])
                raise RuntimeError(f'{name}: exit {proc.returncode}; logs saved in {DEST}')
    finally:
        persist()

backup=DEST/'HERMES-Converted-UNVERIFIED-original.litertlm'
backup_hash=save_copy(candidate,backup)
(ROOT/'logs/unverified-backup.json').write_text(json.dumps({'file':backup.name,'sha256':backup_hash,'size_bytes':backup.stat().st_size,'runtime_verified':False},indent=2))
persist()
print('Converted file backed up to Drive; not yet runtime verified:',backup,flush=True)

# Same ChatML token boundaries as the training prompt. Accept the runtime's
# list of text content parts as well as Hugging Face's plain string content.
TEMPLATE=r"""{%- for message in messages -%}
{{- '<|im_start|>' + message['role'] + '\n' -}}
{%- if message['content'] is string -%}
{{- message['content'] -}}
{%- else -%}
{%- for part in message['content'] -%}
{%- if part['type'] == 'text' -%}{{- part['text'] -}}{%- endif -%}
{%- endfor -%}
{%- endif -%}
{{- '<|im_end|>\n' -}}
{%- endfor -%}
{%- if add_generation_prompt -%}{{- '<|im_start|>assistant\n' -}}{%- endif -%}"""
template_path=ROOT/'hermes_text_chat_template.jinja'
template_path.write_text(TEMPLATE,encoding='utf-8')

repack_script=r"""from pathlib import Path
import os,json,hashlib,tomllib
from litert_lm_builder import LitertLmFileBuilder
from litert_lm_builder.runtime.proto import llm_metadata_pb2
from google.protobuf import text_format
root=Path(os.environ['HERMES_RUN_ROOT'])
source=root/'litert-output/model.litertlm'
original=root/'template-recovery-original'
fixed_dir=root/'template-recovery-fixed'
original.mkdir(exist_ok=True)
fixed_dir.mkdir(exist_ok=True)
LitertLmFileBuilder.unpack(str(source),str(original))
template=root/'hermes_text_chat_template.jinja'
builder=LitertLmFileBuilder.from_toml_file(str(original/'model.toml'),jinja_prompt_template_path=str(template))
fixed=fixed_dir/'model.litertlm'
partial=fixed_dir/'model.litertlm.partial'
assert not fixed.exists() and not partial.exists(), 'Recovery output already exists; do not overwrite it'
with partial.open('wb') as stream:builder.build(stream)
partial.rename(fixed)
readback=root/'template-recovery-readback'
readback.mkdir(exist_ok=True)
LitertLmFileBuilder.unpack(str(fixed),str(readback))
def sections(folder):
    data=tomllib.loads((folder/'model.toml').read_text())
    result=[]
    for section in data['section']:
        if section['section_type']=='LlmMetadata':continue
        p=Path(section['data_path'])
        if not p.is_absolute():p=folder/p
        with p.open('rb') as stream:h=hashlib.file_digest(stream,'sha256').hexdigest()
        result.append({'section_type':section['section_type'],'model_type':section.get('model_type'),'sha256':h,'size_bytes':p.stat().st_size})
    return result
before=sections(original)
after=sections(readback)
assert before==after, 'Non-template model sections changed'
data=tomllib.loads((readback/'model.toml').read_text())
section=next(s for s in data['section'] if s['section_type']=='LlmMetadata')
p=Path(section['data_path'])
if not p.is_absolute():p=readback/p
metadata=llm_metadata_pb2.LlmMetadata()
if p.suffix in ('.pb','.bin'):
    metadata.ParseFromString(p.read_bytes())
else:
    text_format.Parse(p.read_text(),metadata)
assert metadata.jinja_prompt_template==template.read_text(), 'Embedded template readback differs'
result={'template_repacked':True,'unchanged_sections':before,'model_path':str(fixed),'runtime_verified':False}
(root/'logs/template-repack.json').write_text(json.dumps(result,indent=2))
print('PASS: fixed template embedded; all other binary sections unchanged',flush=True)
"""
repair_path=ROOT/'repack_template.py'
repair_path.write_text(repack_script,encoding='utf-8')
fixed=ROOT/'template-recovery-fixed/model.litertlm'
if not fixed.exists():
    run_step([PY,'-u',str(repair_path)],'template-repack.log',{'HERMES_RUN_ROOT':str(ROOT)})
else:
    report=json.loads((ROOT/'logs/template-repack.json').read_text())
    assert report['template_repacked'] and report['model_path']==str(fixed)
fixed_backup=DEST/'HERMES-TemplateFixed-UNVERIFIED.litertlm'
save_copy(fixed,fixed_backup)

evaluation_source=(ROOT/'evaluate_litert.py').read_text()
selector="model_path=next((root/'litert-output').glob('*.litertlm'))"
assert selector in evaluation_source, 'Unexpected evaluation script; refusing to edit blindly'
evaluation_source=evaluation_source.replace(selector,"model_path=Path(os.environ['HERMES_LITERT_MODEL'])")
if 'import os' not in evaluation_source:evaluation_source='import os\n'+evaluation_source
evaluation_path=ROOT/'evaluate_litert_fixed.py'
evaluation_path.write_text(evaluation_source,encoding='utf-8')
run_step([PY,'-u',str(evaluation_path)],'litert-evaluation-fixed.log',{'HERMES_LITERT_MODEL':str(fixed),'HERMES_RUN_ROOT':str(ROOT)})
result=json.loads((ROOT/'logs/litert-evaluation.json').read_text())
print(json.dumps(result,indent=2),flush=True)
assert result['passed'], 'Model generated responses but did not pass the 95% CPU test threshold; see logs'
model=DEST/'HERMES-Qwen2.5-1.5B-Q4B32-ctx512.litertlm'
verified_hash=save_copy(fixed,model)
assert verified_hash==result['sha256']
verification={'model':model.name,'size_bytes':model.stat().st_size,'sha256':verified_hash,'cpu_test':result,'android_verified':False,'production_accepted':False}
(DEST/'verification.json').write_text(json.dumps(verification,indent=2))
persist()
print('CPU VERIFIED:',model,flush=True)
print('SHA-256:',verified_hash,flush=True)
print('Android/app import and inference still need actual phone testing.',flush=True)
