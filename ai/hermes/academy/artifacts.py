"""Content-addressed readback with explicit file and path boundaries."""
import json
from pathlib import Path
from .data import sha256

def inventory(root):
    root = Path(root).resolve()
    result = {}
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            raise ValueError(f'Symlink not allowed: {p.name}')
        if p.is_file() and p != root / 'artifacts.json':
            result[p.relative_to(root).as_posix()] = {'sha256': sha256(p), 'bytes': p.stat().st_size}
    if not result:
        raise ValueError('Empty artifact directory')
    return result

def seal(root):
    root = Path(root)
    manifest = inventory(root)
    path = root / 'artifacts.json'
    # Explicitly refuse resealing changed artifacts as though their old evidence still held.
    if path.exists() and json.loads(path.read_text()) != manifest:
        raise ValueError('Existing seal differs; create a new artifact directory')
    path.write_text(json.dumps(manifest, indent=2) + '\n')
    return verify(root)

def verify(root):
    root = Path(root).resolve()
    expected = json.loads((root / 'artifacts.json').read_text())
    for name in expected:
        path = (root / name).resolve()
        if not path.is_relative_to(root) or Path(name).is_absolute():
            raise ValueError('Unsafe manifest path')
    if expected != inventory(root):
        raise ValueError('Artifact readback failed (missing, changed or unexpected file)')
    return {'files_verified': len(expected), 'manifest_sha256': sha256(root / 'artifacts.json')}

def export_archive(root, output):
    import zipfile
    root,output=Path(root).resolve(),Path(output).resolve()
    verify(root)
    if output.exists() or output.is_relative_to(root):
        raise ValueError('Export must be a new file outside the artifact directory')
    with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(root.rglob('*')):
            if p.is_file():z.write(p,p.relative_to(root).as_posix())
    with zipfile.ZipFile(output) as z:
        if z.testzip() is not None:raise ValueError('ZIP CRC verification failed')
        for name in z.namelist():
            import hashlib
            if hashlib.sha256(z.read(name)).hexdigest()!=sha256(root/name):
                raise ValueError('Export readback mismatch')
    return {'archive':output.name,'sha256':sha256(output),'bytes':output.stat().st_size,
            'format':'Verified adapter/run ZIP, not a merged model or LiteRT-LM container'}
