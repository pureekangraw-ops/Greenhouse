"""Curate actual repository commits, never generate replacement answers or execute source code."""
import ast
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from .data import canonical, sha256, validate_dataset
REVISION='fc56fe33c030c6daa414c2b112c932b8eed085e6'
RAW_SHA256='d167da37e1058371c48e057cd8815d03700c867dd8bcf58e61420d4dcd288d73'
URL=f'https://huggingface.co/datasets/bigcode/commitpackft/resolve/{REVISION}/data/python/data.jsonl'

def prepare(raw, output, per_split=100):
    if sha256(raw)!=RAW_SHA256:
        raise ValueError('Raw source differs from pinned downloaded dataset')
    if per_split<=0:raise ValueError('per_split must be positive')
    root=Path(output)
    root.mkdir(parents=True,exist_ok=False)
    records={s:[] for s in ('train','validation','heldout')}
    reasons=Counter(); seen=set(); scanned=0
    raw_hash=sha256(raw)
    with Path(raw).open() as f:
        for line_number,line in enumerate(f,1):
            row=json.loads(line);scanned+=1
            repo=row.get('repos',''); commit=row.get('commit',''); license_name=row.get('license','')
            before,after=row.get('old_contents',''),row.get('new_contents','')
            path=row.get('new_file','')
            if license_name!='mit' or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo) or not re.fullmatch('[a-f0-9]{40}',commit):
                reasons['license_or_provenance']+=1;continue
            if re.search('humaneval|mbpp|benchmark|evalplus|codecontests',repo+'/'+path,re.I):
                reasons['benchmark_name_quarantine']+=1;continue
            if not (isinstance(before,str) and isinstance(after,str) and before.strip() and after.strip() and before!=after and
                    80<=len(before)+len(after)<=4500 and row.get('subject','').strip()):
                reasons['size_or_empty']+=1;continue
            try:ast.parse(before);ast.parse(after)
            except (SyntaxError,ValueError):reasons['invalid_python']+=1;continue
            # Hash whole repository lineage so all files/commits from the repository stay together.
            bucket=int(hashlib.sha256(repo.casefold().encode()).hexdigest()[:8],16)%10
            split='heldout' if bucket==0 else 'validation' if bucket==1 else 'train'
            key=hashlib.sha256(canonical([before,row['subject']]).encode()).hexdigest()
            if key in seen:reasons['duplicate']+=1;continue
            seen.add(key)
            if len(records[split])>=per_split:reasons['curation_limit']+=1;continue
            record_id=hashlib.sha256(canonical([repo,commit,path]).encode()).hexdigest()
            commit_url=f'https://github.com/{repo}/commit/{commit}'
            records[split].append({'id':'commitpack-'+record_id,'source':'commitpack-python',
                'source_record':f'{commit}:{path}','lineage':'repo:'+repo.casefold(),
                'origin':'repository_commit','capabilities':['code'],
                'messages':[{'role':'system','content':'Apply the supplied repository commit instruction to the Python file. Return the entire updated file only; do not claim tests ran.'},
                    {'role':'user','content':canonical({'instruction':row['subject'],'path':path,'old_contents':before})},
                    {'role':'assistant','content':after}],
                'quality':{'label_verified':True,'method':'Existing repository commit target; both before/after parse as Python; changed-file check. Behavior not executed or independently certified.',
                    'evidence':f'{commit_url}; source line {line_number}; raw sha256 {raw_hash}'},
                'attribution':{'repository':repo,'commit':commit,'file':path,'license':license_name,
                    'copyright_notice':'Preserve notices in source contents; upstream corpus licenses are metadata assertions, not a legal guarantee.'}})
    sources={'commitpack-python':{'url':URL,'revision':REVISION,'license':'MIT dataset; selected rows also marked MIT',
             'license_evidence':f'https://huggingface.co/datasets/bigcode/commitpackft/blob/{REVISION}/README.md',
             'raw_sha256':raw_hash,'benchmark':False,'license_approved':True,'allow_upstream_synthetic':False}}
    (root/'sources.json').write_text(json.dumps(sources,indent=2)+'\n')
    for split,rows in records.items():
        (root/f'{split}.jsonl').write_text(''.join(canonical(r)+'\n' for r in rows))
    report=validate_dataset(root,{'code'})
    (root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    (root/'curation.json').write_text(json.dumps({'scanned':scanned,'excluded':reasons,
        'qualified_scope':'code syntax and source provenance only; NOT nine-capability Academy readiness',
        'label_semantics_not_independently_verified':True},indent=2)+'\n')
    return report
