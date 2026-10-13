"""Offline synthetic acceptance tests for restore_safe.py (no model downloads)."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from restore_safe import restore

def sha(data):
    return hashlib.sha256(data).hexdigest()

def entry(name, data):
    return {"name": name, "size_bytes": len(data), "sha256": sha(data)}

def fixture(root, *, tamper=False, unsafe=False):
    payload = b"synthetic GGUF test bytes"
    name = "../escape.gguf" if unsafe else "model.gguf"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr(name, payload)
    archive = buffer.getvalue()
    parts = [archive[:len(archive)//2], archive[len(archive)//2:]]
    prefix = "HERMES_Phase2_Drive.zip"
    manifest = {
        "archive_name": prefix,
        "archive_size_bytes": len(archive),
        "archive_sha256": sha(archive),
        "parts": [entry(f"{prefix}.part{i:03d}", part) for i, part in enumerate(parts, 1)],
        "files": [entry(name, payload)],
    }
    for item, data in zip(manifest["parts"], parts):
        (root / item["name"]).write_bytes(data)
    (root / "HERMES_Drive_Manifest.json").write_text(json.dumps(manifest))
    if tamper:
        (root / manifest["parts"][0]["name"]).write_bytes(b"bad")
    return payload

class RestoreTests(unittest.TestCase):
    def test_restore_valid(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            payload = fixture(root)
            output = root / "out"
            restore(root, output)
            self.assertEqual((output / "model.gguf").read_bytes(), payload)

    def test_reject_tampered_part(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fixture(root, tamper=True)
            with self.assertRaises(ValueError):
                restore(root, root / "out")
            self.assertFalse((root / "out").exists())

    def test_reject_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fixture(root, unsafe=True)
            with self.assertRaises(ValueError):
                restore(root, root / "out")
            self.assertFalse((root / "escape.gguf").exists())

    def test_refuse_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            fixture(root)
            output = root / "out"
            output.mkdir()
            with self.assertRaises(ValueError):
                restore(root, output)

if __name__ == "__main__":
    unittest.main()
