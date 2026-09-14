#!/usr/bin/env python3
"""Compat path for Cursor sessions still bound to this filename.

APM deploys the real script at .cursor/hooks/cursor-hooks/.
"""
from pathlib import Path
import runpy

here = Path(__file__).resolve().parent
candidates = (
    here / "cursor-hooks" / "strip-agent-coauthor.py",
    here.parents[1] / "cursor-hooks" / ".apm" / "hooks" / "strip-agent-coauthor.py",
)
for path in candidates:
    if path.is_file():
        runpy.run_path(str(path), run_name="__main__")
        raise SystemExit(0)
raise SystemExit(0)
