"""Validate qualified source data; never invent or silently repair labels."""
import hashlib
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from . import CAPABILITIES

SPLITS = ('train', 'validation', 'heldout')
DECISIONS = {'PROCEED', 'ASK', 'KEEP', 'DISCARD', 'DEFER', 'DENY'}

def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def normalized(text):
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())

def read_jsonl(path):
    rows = []
    with Path(path).open(encoding='utf-8') as f:
        for line_no, line in enumerate(f, 1):
            if line.strip():
                try:
                    row = json.loads(line)
                except ValueError as exc:
                    raise ValueError(f'{Path(path).name}:{line_no}: invalid JSON') from exc
                if not isinstance(row, dict):
                    raise ValueError(f'{Path(path).name}:{line_no}: row must be object')
                rows.append(row)
    if not rows:
        raise ValueError(f'Empty corpus: {path}')
    return rows

def validate_dataset(directory, required_capabilities=CAPABILITIES):
    """Return report only after every declared gate succeeds. No review-by-flag."""
    from jsonschema import Draft202012Validator
    root = Path(directory)
    sources = json.loads((root / 'sources.json').read_text())
    if not isinstance(sources, dict) or not sources:
        raise ValueError('Missing source registry')
    ids, prompts, lineages, fingerprints = set(), {}, {}, set()
    coverage = {s: Counter() for s in SPLITS}
    decisions = {s: Counter() for s in SPLITS}
    counts = {}
    for split in SPLITS:
        rows = read_jsonl(root / f'{split}.jsonl')
        counts[split] = len(rows)
        for row in rows:
            required = {'id', 'lineage', 'source', 'source_record', 'messages',
                        'capabilities', 'quality', 'origin'}
            if not required <= row.keys():
                raise ValueError(f'Missing fields: {row.get("id")}')
            rid = row['id']
            if not isinstance(rid, str) or not rid or rid in ids:
                raise ValueError('Missing or duplicate id')
            ids.add(rid)
            src = sources.get(row['source'], {})
            for field in ('url', 'revision', 'license', 'license_evidence', 'raw_sha256'):
                if not isinstance(src.get(field), str) or not src[field]:
                    raise ValueError(f'Source missing {field}: {rid}')
            if not re.fullmatch('[0-9a-f]{64}', src['raw_sha256']):
                raise ValueError('Invalid source SHA-256')
            if src.get('benchmark') is not False:
                raise ValueError(f'Benchmark or unknown source cannot enter corpus: {rid}')
            if src.get('license_approved') is not True:
                raise ValueError(f'License not approved: {rid}')
            if row['origin'] not in {'human', 'repository_commit', 'observed_execution', 'upstream_synthetic'}:
                raise ValueError(f'Unqualified origin: {rid}')
            if row['origin'] == 'upstream_synthetic' and not src.get('allow_upstream_synthetic'):
                raise ValueError(f'Upstream synthetic source not allowed: {rid}')
            quality = row['quality']
            if not isinstance(quality,dict) or quality.get('label_verified') is not True:
                raise ValueError(f'Unverified label: {rid}')
            if not isinstance(quality, dict) or not all(quality.get(k) for k in
                    ('method', 'evidence', 'label_verified')):
                raise ValueError(f'Unverified label: {rid}')
            # A boolean alone is insufficient: preserve verifier identity and evidence.
            if not isinstance(quality['evidence'], str) or not isinstance(quality['method'], str):
                raise ValueError(f'Invalid quality evidence: {rid}')
            if not isinstance(row['source_record'], str) or not row['source_record']:
                raise ValueError('Missing source record')
            caps = row['capabilities']
            if not isinstance(caps, list) or not caps or set(caps) - CAPABILITIES:
                raise ValueError(f'Invalid capability: {rid}')
            coverage[split].update(caps)
            messages = row['messages']
            if not isinstance(messages, list) or not messages or messages[-1].get('role') != 'assistant':
                raise ValueError(f'Missing terminal assistant: {rid}')
            for m in messages:
                if m.get('role') not in {'system', 'user', 'assistant', 'tool'} or not isinstance(m.get('content'), str):
                    raise ValueError(f'Invalid message: {rid}')
            if not any(m['role'] == 'user' for m in messages):
                raise ValueError('Missing user message')
            prompt = normalized(canonical([m for m in messages if m['role'] != 'assistant']))
            lineage = row['lineage']
            if not isinstance(lineage, str) or not lineage:
                raise ValueError('Missing lineage')
            if lineage in lineages and lineages[lineage] != split:
                raise ValueError(f'Lineage leakage: {rid}')
            lineages[lineage] = split
            if prompt in prompts:
                raise ValueError(f'Duplicate prompt (including cross-split): {rid}')
            prompts[prompt] = split
            fingerprint = (row['source'], row['source_record'])
            if fingerprint in fingerprints:
                raise ValueError(f'Duplicate source record: {rid}')
            fingerprints.add(fingerprint)
            payload = canonical(row)
            if re.search(r'(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AIza[\w-]{30,})', payload):
                raise ValueError(f'Potential secret: {rid}')
            if 'response_schema' in row:
                Draft202012Validator.check_schema(row['response_schema'])
                Draft202012Validator(row['response_schema']).validate(json.loads(messages[-1]['content']))
            if 'decision' in caps:
                decision = json.loads(messages[-1]['content']).get('decision')
                if decision not in DECISIONS:
                    raise ValueError(f'Invalid decision: {rid}')
                decisions[split].update([decision])
    for split in SPLITS:
        missing = set(required_capabilities) - coverage[split].keys()
        if missing:
            raise ValueError(f'{split}: missing capabilities {sorted(missing)}')
        if 'decision' in required_capabilities and set(decisions[split]) != DECISIONS:
            raise ValueError(f'{split}: missing decisions {sorted(DECISIONS-set(decisions[split]))}')
    files = {name: {'sha256': sha256(root / name), 'bytes': (root / name).stat().st_size}
             for name in ['sources.json'] + [f'{s}.jsonl' for s in SPLITS]}
    return {'status': 'VALIDATED', 'counts': counts, 'coverage': coverage,
            'decisions': decisions, 'files': files,
            'required_capabilities': sorted(required_capabilities),
            'semantic_review_limit': 'Lineage and exact checks do not prove semantic independence; source quality evidence remains mandatory.'}

def verify_manifest(directory):
    root = Path(directory)
    saved = json.loads((root / 'manifest.json').read_text())
    actual = validate_dataset(root, set(saved['required_capabilities']))
    if actual != saved:
        raise ValueError('Dataset manifest differs from current validated corpus')
    return actual
