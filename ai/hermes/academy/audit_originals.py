"""Read-only audit: parse notebook JSON and literals; never execute notebook cells."""
import ast
import base64
import hashlib
import json
import zlib
import zipfile
from collections import Counter
from pathlib import Path
from .data import canonical, sha256

def audit(notebooks, package, output):
    inventory=[];splits={}
    for path in sorted(Path(notebooks).rglob('*.ipynb')):
        n=json.loads(path.read_text())
        errors=[{'cell':i,'type':o.get('ename'),'message':o.get('evalue')}
                for i,c in enumerate(n['cells']) for o in c.get('outputs',[]) if o.get('output_type')=='error']
        inventory.append({'file':path.name,'sha256':sha256(path),'bytes':path.stat().st_size,
                          'cells':len(n['cells']),'recorded_errors':errors})
        for cell in n['cells']:
            source=''.join(cell.get('source',[]))
            if 'EMBEDDED_DATASETS = ' not in source:continue
            tree=ast.parse(source)
            node=next(x for x in tree.body if isinstance(x,ast.Assign) and
                      any(isinstance(t,ast.Name) and t.id=='EMBEDDED_DATASETS' for t in x.targets))
            for name,entry in ast.literal_eval(node.value).items():
                raw=zlib.decompress(base64.b64decode(entry['data']))
                if hashlib.sha256(raw).hexdigest()!=entry['sha256']:raise ValueError('Embedded data hash mismatch')
                splits[name]=[json.loads(line) for line in raw.splitlines()]
    rows=[r for part in splits.values() for r in part]
    prefixes=('โปรดดำเนินการตามขอบเขตนี้: ','คำขอจากระบบงาน: ','ช่วยพิจารณาอย่างระมัดระวัง: ','งานที่ส่งต่อมา: ')
    def base_request(row):
        q=row['input']['request']
        return next((q[len(p):] for p in prefixes if q.startswith(p)),q)
    with zipfile.ZipFile(package) as z:
        if z.testzip() is not None:raise ValueError('Original ZIP CRC mismatch')
        manifest=json.loads(z.read('HERMES_v2_Preparation/package_manifest.json'))
        for entry in manifest:
            data=z.read('HERMES_v2_Preparation/'+entry['path'])
            if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:
                raise ValueError('Original package manifest mismatch')
        original_config=json.loads(z.read('HERMES_v2_Preparation/adapter_v1/adapter_config.json'))
    report={'evidence_type':'STATIC_ORIGINAL_BYTES_AND_EMBEDDED_DATA_AUDIT','notebooks':inventory,
      'original_v1_package':{'sha256':sha256(package),'manifest_entries_verified':len(manifest),
         'adapter_structure':{k:original_config.get(k) for k in ['base_model_name_or_path','revision','r','lora_alpha','target_modules','peft_version']},
         'inference_executed':False,'source_modified':False},
      'embedded_540':{'counts':{k:len(v) for k,v in splits.items()},'total':len(rows),
         'origin':dict(Counter(r.get('provenance') for r in rows)),
         'review':dict(Counter(r.get('review_status') for r in rows)),
         'decisions':dict(Counter(r['expected']['decision'] for r in rows)),
         'unique_exact_requests':len({r['input']['request'] for r in rows}),
         'unique_requests_after_removing_four_observed_prefixes':len({base_request(r) for r in rows}),
         'prefix_variant_excess':len(rows)-len({base_request(r) for r in rows}),
         'missing_decisions':sorted({'PROCEED','ASK','KEEP','DISCARD','DEFER','DENY'}-{r['expected']['decision'] for r in rows}),
         'training_qualified_rows':0,'label_semantics_independently_verified':False}}
    Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('notebooks');p.add_argument('package');p.add_argument('output')
    a=p.parse_args();audit(a.notebooks,a.package,a.output)
