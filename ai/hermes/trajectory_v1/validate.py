#!/usr/bin/env python3
"""Standard-library validation for HERMES trajectory JSONL (no training)."""
import json
import sys
from pathlib import Path

STEPS = {"ASK", "LOOKUP", "HANDOFF", "STOP"}
FRESHNESS = {"current", "stale", "unknown", "conflict"}
SPLITS = {"train", "dev", "heldout"}
ROLES = {"system", "user", "assistant", "tool"}

def validate(row):
    assert isinstance(row, dict)
    assert set(row) == {"id", "split", "messages", "context", "target"}
    assert isinstance(row["id"], str) and row["id"].strip()
    assert row["split"] in SPLITS
    assert isinstance(row["messages"], list) and row["messages"]
    for msg in row["messages"]:
        assert set(msg) == {"role", "content"} and msg["role"] in ROLES
        assert isinstance(msg["content"], str)
    c = row["context"]
    assert set(c) == {"work_id", "source", "freshness", "authorized"}
    assert c["work_id"] is None or isinstance(c["work_id"], str)
    assert isinstance(c["source"], str) and c["source"].strip()
    assert c["freshness"] in FRESHNESS and type(c["authorized"]) is bool
    t = row["target"]
    assert set(t) == {"next_step", "owner", "reason", "required_evidence", "requires_approval"}
    assert t["next_step"] in STEPS
    assert all(isinstance(t[k], str) and t[k].strip() for k in ("owner", "reason"))
    assert isinstance(t["required_evidence"], list)
    assert all(isinstance(e, str) and e.strip() for e in t["required_evidence"])
    assert len(t["required_evidence"]) == len(set(t["required_evidence"]))
    assert type(t["requires_approval"]) is bool
    if not c["authorized"]:
        assert t["next_step"] in {"ASK", "LOOKUP", "STOP"}, "unauthorized HANDOFF"
    if c["freshness"] in {"stale", "unknown", "conflict"}:
        assert t["next_step"] != "HANDOFF", "handoff on unverified context"

def main(path):
    seen = set()
    count = 0
    for line_no, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            validate(row)
            assert row["id"] not in seen, "duplicate ID"
            seen.add(row["id"])
            count += 1
        except (ValueError, AssertionError, KeyError, TypeError) as e:
            raise SystemExit(f"FAIL line {line_no}: {e}") from e
    if not count:
        raise SystemExit("FAIL empty dataset")
    print(f"PASS {count} rows: structure and basic safety checks (not SFT-ready certification)")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate.py FILE.jsonl")
    main(sys.argv[1])
