"""Identify the backend source loaded by a running local server."""
import hashlib
import os
from pathlib import Path


def backend_revision(root: Path) -> str:
    sources = [root / "start_app.py", root / "backend" / "requirements.txt"]
    for directory, subdirectories, filenames in os.walk(root / "backend"):
        subdirectories[:] = [name for name in subdirectories
                             if not name.startswith(".") and name != "__pycache__"]
        sources.extend(Path(directory) / name for name in filenames if name.endswith(".py"))
    digest = hashlib.sha256()
    for path in sorted(sources):
        digest.update(path.relative_to(root).as_posix().encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()
