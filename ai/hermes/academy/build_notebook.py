"""Generate a self-contained Colab artifact from the reviewed local package/data."""
import base64
import hashlib
import json
import zlib
from pathlib import Path

def build():
    root=Path(__file__).parent
    files={}
    include=list(root.glob('*.py'))+[root/'requirements.txt']+list((root/'tests').glob('*.py'))
    include+=list((root/'data/code-commits').glob('*'))+list((root/'legacy').glob('*'))
    for path in sorted(include):
        if path.name=='build_notebook.py':continue
        raw=path.read_bytes()
        files[path.relative_to(root).as_posix()]={'sha256':hashlib.sha256(raw).hexdigest(),
                                                  'data':base64.b64encode(zlib.compress(raw,9)).decode()}
    cells=[]
    def md(text):cells.append({'cell_type':'markdown','metadata':{},'source':text.splitlines(keepends=True)})
    def code(text):cells.append({'cell_type':'code','metadata':{},'execution_count':None,'outputs':[],
                                'source':text.splitlines(keepends=True)})
    md('''# HERMES Academy Recovery — PREPARE / TRAIN / TEST

**Status: PARTIAL BUILD.** This artifact embeds all package files and 300 source-linked repository code-commit records (100/100/100). Those records have structural, syntax and repository-lineage checks; behavior and all nine capabilities are NOT certified. The original 540 synthetic curriculum rows are quarantined, not relabeled as real data.

Run PREPARE on CPU first. Training stays blocked until a qualified nine-capability corpus, immutable Adapter v1 and GPU preflight all pass. No subscription, production deployment, WorkHub dispatch or original-adapter overwrite is performed. A CPU run is not proof of GPU training or production readiness.''')
    code("from pathlib import Path\nimport json, hashlib, base64, zlib, sys, subprocess, tempfile\nWORK=Path('/content/hermes_academy_recovery') if Path('/content').exists() else Path(tempfile.mkdtemp(prefix='hermes-academy-'))\nPACKAGE=WORK/'ai/hermes/academy'\nPACKAGE.mkdir(parents=True,exist_ok=True)\nBUNDLE="+repr(files)+"\nfor name,entry in BUNDLE.items():\n    target=(PACKAGE/name).resolve()\n    assert target.is_relative_to(PACKAGE.resolve()), 'Unsafe bundle member'\n    raw=zlib.decompress(base64.b64decode(entry['data']))\n    assert hashlib.sha256(raw).hexdigest()==entry['sha256'], name\n    if target.exists(): assert target.read_bytes()==raw, 'Existing bundle differs; use a fresh WORK folder'\n    target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(raw)\nsys.path.insert(0,str(WORK))\nprint('Embedded files read back:',len(BUNDLE))")
    md('## PREPARE — CPU validation and honest coverage gate')
    code("import importlib.util\nif importlib.util.find_spec('jsonschema') is None:\n    subprocess.check_call([sys.executable,'-m','pip','install','jsonschema==4.23.0'])\nfrom ai.hermes.academy.data import verify_manifest, validate_dataset\nDATA=PACKAGE/'data/code-commits'\ncomponent=verify_manifest(DATA)\nprint('Component structural counts:',component['counts'])\nACADEMY_READY=False\ntry:\n    validate_dataset(DATA)\n    ACADEMY_READY=True\nexcept ValueError as exc:\n    print('ACADEMY DATA BLOCKED:',str(exc))\ntest_run=subprocess.run([sys.executable,'-m','unittest','discover','-s',str(PACKAGE/'tests'),'-v'],cwd=WORK,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)\nprint(test_run.stdout)\ntest_run.check_returncode()\nprint('Unit tests are local contract tests; no model or production acceptance implied.')")
    md('## TRAIN — persistent run, preserved v1 and exact resume\nFor actual training, supply a fully qualified corpus in DATA and validate it; change RUN_TRAINING only after PREPARE passes. Select an available authorized GPU; do not purchase compute. Drive mounts interactively only when training is requested. Original package location and checksum are in legacy/provenance.json.')
    code("RUN_TRAINING=False\nRESUME_CHECKPOINT=None\nif RUN_TRAINING:\n    assert ACADEMY_READY, 'Qualified nine-capability corpus is missing; training blocked'\n    from google.colab import drive\n    drive.mount('/content/drive')\n    DRIVE=Path('/content/drive/MyDrive/HERMES_Academy_Recovery')\n    ORIGINAL=DRIVE/'original/adapter_v1'\n    assert (ORIGINAL/'adapter_config.json').is_file(), 'Restore original v1 package without overwriting it'\n    subprocess.check_call([sys.executable,'-m','pip','install','-r',str(PACKAGE/'requirements.txt')])\n    from datetime import datetime, timezone\n    RUN=DRIVE/'runs'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')\n    # For resume, set RUN to the existing run and RESUME_CHECKPOINT to its exact checkpoint-N.\n    from ai.hermes.academy.train import run_training\n    print(run_training(DATA,ORIGINAL,RUN,resume=RESUME_CHECKPOINT))\nelse:\n    print('TRAIN NOT RUN')")
    md('## TEST — actual saved adapter inference, regression and export\nHeld-out results are never fed back into training. Baseline v1 and candidate must use the same protocol; compare per-capability raw counts. Local contract tests do not call PANTHEON/Factory; production read-only health is not sandbox model execution. Controlled live sandbox execution and LIGHT runtime acceptance remain separate prerequisites.')
    code("if RUN_TRAINING:\n    from ai.hermes.academy.evaluate import evaluate_adapter, regression\n    from ai.hermes.academy.artifacts import verify, export_archive\n    print(verify(RUN))\n    evaluate_adapter(DATA,RUN/'adapter',RUN.parent/(RUN.name+'-heldout.json'))\n    regression(ORIGINAL,RUN.parent/(RUN.name+'-v1-regression.json'))\n    regression(RUN/'adapter',RUN.parent/(RUN.name+'-candidate-regression.json'))\n    print(export_archive(RUN,RUN.parent/(RUN.name+'.zip')))\nelse:\n    print('MODEL EVALUATION / RELOAD / REGRESSION NOT RUN')\nprint(json.dumps({'build':'PARTIAL','dataset_all_nine':ACADEMY_READY,'training_requested':RUN_TRAINING,'production_verified':False},indent=2))")
    for i,cell in enumerate(cells):cell['id']=f'hermes-{i:03d}'
    notebook={'cells':cells,'metadata':{'kernelspec':{'display_name':'Python 3','language':'python','name':'python3'},
               'language_info':{'name':'python'},'colab':{'name':'HERMES_Academy_Recovery.ipynb'}},'nbformat':4,'nbformat_minor':5}
    path=root/'HERMES_Academy_Recovery.ipynb'
    path.write_text(json.dumps(notebook,ensure_ascii=False,indent=1)+'\n')
    return path

if __name__=='__main__':print(build())
