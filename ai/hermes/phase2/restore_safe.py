#!/usr/bin/env python3
"""Safely restore HERMES GGUF package from Drive chunks, validating SHA-256."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import zipfile

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def validate_entries(entries):
    names = [x["name"] for x in entries]
    if not names or len(names) != len(set(names)):
        raise ValueError("Empty or duplicate manifest entries")
    for entry in entries:
        name = entry["name"]
        if (not isinstance(name, str) or not name or name.startswith(".")
                or "/" in name or "\\" in name or ":" in name):
            raise ValueError("Unsafe manifest filename")
        if not isinstance(entry["size_bytes"], int) or entry["size_bytes"] < 0:
            raise ValueError("Invalid manifest size")
        if len(entry["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in entry["sha256"]):
            raise ValueError("Invalid SHA-256")
    return names

def verify(path, entry):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing or unsafe file: " + path.name)
    if path.stat().st_size != entry["size_bytes"] or digest(path) != entry["sha256"]:
        raise ValueError("Size/hash mismatch: " + path.name)
    print("PASS", path.name, flush=True)

def restore(source, output):
    manifest = json.loads((source / "HERMES_Drive_Manifest.json").read_text(encoding="utf-8"))
    parts, files = manifest["parts"], manifest["files"]
    part_names = validate_entries(parts)
    file_names = validate_entries(files)
    archive_name = "HERMES_Phase2_Drive.zip"
    if manifest["archive_name"] != archive_name:
        raise ValueError("Unexpected archive name")
    if part_names != [f"{archive_name}.part{i:03d}" for i in range(1, len(parts) + 1)]:
        raise ValueError("Missing or out-of-order chunks")
    if sum(p["size_bytes"] for p in parts) != manifest["archive_size_bytes"]:
        raise ValueError("Manifest size mismatch")
    for entry in parts:
        verify(source / entry["name"], entry)
    if output.exists():
        raise ValueError("Refusing to overwrite output: " + str(output))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".hermes-restore-", dir=output.parent) as work:
        work = Path(work)
        archive = work / archive_name
        with archive.open("wb") as target:
            for entry in parts:
                with (source / entry["name"]).open("rb") as chunk:
                    shutil.copyfileobj(chunk, target, 1024 * 1024)
        verify(archive, {"name": archive_name, "size_bytes": manifest["archive_size_bytes"],
                         "sha256": manifest["archive_sha256"]})
        staged = work / "HERMES_Phase2"
        staged.mkdir()
        expected = {f["name"]: f for f in files}
        with zipfile.ZipFile(archive) as z:
            members = z.infolist()
            if len(members) != len(file_names) or {m.filename for m in members} != set(file_names):
                raise ValueError("ZIP members differ from manifest")
            for member in members:
                if (member.is_dir() or member.flag_bits & 1
                        or member.file_size != expected[member.filename]["size_bytes"]
                        or (member.external_attr >> 16) & 0o170000 == 0o120000):
                    raise ValueError("Unsafe ZIP entry: " + member.filename)
                dest = staged / member.filename
                with z.open(member) as reader, dest.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                verify(dest, expected[member.filename])
        staged.rename(output)
    print("PASS: verified parts, archive and extracted files:", output)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("HERMES_Phase2"))
    args = parser.parse_args()
    try:
        restore(args.source.resolve(), args.output.resolve())
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        print("FAIL:", exc, file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
