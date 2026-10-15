import argparse
import json
from pathlib import Path
from .data import validate_dataset, verify_manifest

def main():
    parser=argparse.ArgumentParser(description='HERMES Academy evidence-gated recovery')
    commands=parser.add_subparsers(dest='command',required=True)
    p=commands.add_parser('validate');p.add_argument('data');p.add_argument('--write-manifest',action='store_true')
    p=commands.add_parser('train');p.add_argument('data');p.add_argument('original');p.add_argument('run');p.add_argument('--resume')
    p=commands.add_parser('evaluate');p.add_argument('data');p.add_argument('adapter');p.add_argument('output');p.add_argument('--split',default='heldout',choices=['validation','heldout'])
    p=commands.add_parser('regression');p.add_argument('adapter');p.add_argument('output')
    p=commands.add_parser('verify');p.add_argument('artifact')
    p=commands.add_parser('export');p.add_argument('artifact');p.add_argument('output')
    p=commands.add_parser('prepare-commits');p.add_argument('raw');p.add_argument('output');p.add_argument('--per-split',type=int,default=100)
    args=parser.parse_args()
    if args.command=='validate':
        result=validate_dataset(args.data)
        if args.write_manifest:
            p=Path(args.data)/'manifest.json'
            if p.exists():raise ValueError('Manifest already exists; preserve previous record')
            p.write_text(json.dumps(result,indent=2)+'\n')
    elif args.command=='train':
        from .train import run_training
        result=run_training(args.data,args.original,args.run,resume=args.resume)
    elif args.command=='evaluate':
        from .evaluate import evaluate_adapter
        result=evaluate_adapter(args.data,args.adapter,args.output,args.split)
    elif args.command=='regression':
        from .evaluate import regression
        result=regression(args.adapter,args.output)
    elif args.command=='prepare-commits':
        from .prepare_commitpack import prepare
        result=prepare(args.raw,args.output,args.per_split)
    elif args.command=='verify':
        from .artifacts import verify
        result=verify(args.artifact)
    elif args.command=='export':
        from .artifacts import export_archive
        result=export_archive(args.artifact,args.output)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
