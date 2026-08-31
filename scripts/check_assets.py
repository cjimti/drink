#!/usr/bin/env python3
"""Every local file index.html asks for should actually be in the repo.

A typo'd href on a static site fails silently — the page just loses its
stylesheet on someone's phone. Catch it before the deploy does not.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    html = (ROOT / "index.html").read_text()
    refs = re.findall(r'(?:href|src)="([^"]+)"', html)

    local = [r for r in refs if not r.startswith(("http:", "https:", "//", "#", "data:"))]
    missing = [r for r in local if not (ROOT / r).exists()]

    for r in missing:
        print(f"  MISSING {r}")
    if missing:
        return 1

    print(f"  assets  {len(local)} local reference(s) resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
