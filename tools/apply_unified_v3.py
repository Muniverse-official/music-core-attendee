#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path.cwd().resolve()
CHUNK_DIR = ROOT / "tools" / ".apply-v3"
DELETE_PATHS = ["site/privacy-processing.js"]
SELF_PATHS = [
    "tools/.apply-v3",
    "tools/apply_unified_v3.py",
    ".github/workflows/apply-unified-v3.yml",
]


def safe_path(relative: str | Path) -> Path:
    target = (ROOT / relative).resolve()
    if target != ROOT and ROOT not in target.parents:
        raise SystemExit(f"unsafe path: {relative}")
    return target


parts = sorted(CHUNK_DIR.glob("*.part"))
if not parts:
    raise SystemExit("archive chunks are missing")
encoded = "".join(path.read_text(encoding="utf-8").strip() for path in parts)
payload = base64.b64decode(encoded, validate=True)

for relative in DELETE_PATHS:
    target = safe_path(relative)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()

with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
    for member in archive.getmembers():
        safe_path(member.name)
    archive.extractall(ROOT)

for relative in SELF_PATHS:
    target = safe_path(relative)
    if target.is_dir():
        shutil.rmtree(target)
    elif target.exists():
        target.unlink()

subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
subprocess.run(["git", "add", "-A"], check=True)
if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
    print("No changes to commit")
    raise SystemExit(0)
subprocess.run(["git", "commit", "-m", "Apply unified Music Core registration v3"], check=True)
subprocess.run(["git", "push", "origin", "HEAD:feat/unified-attendee-v3-20260825"], check=True)
