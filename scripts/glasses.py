#!/usr/bin/env python3
"""Every glass drawing in one file, for the menu to fetch in one request.

A row on the Menu draws the glass its serve token calls for, and the
app used to ask for each of the twenty drawings on its own before the
first row could paint. It asks for assets/glasses/all.json instead: the
name of each drawing and its SVG text. The SVGs stay on disk, because
this file is made from them and pages.py and cards.py read them.

`python3 scripts/glasses.py` writes the file.
`python3 scripts/glasses.py --check` refuses a copy that no longer
matches the drawings. check_assets.py runs the same comparison.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLASS_DIR = ROOT / "assets" / "glasses"
OUT = GLASS_DIR / "all.json"


def drawings():
    """{name: svg text} for every drawing in assets/glasses."""
    return {f.stem: f.read_text() for f in sorted(GLASS_DIR.glob("*.svg"))}


def dumps(art):
    """One drawing per line, so a redrawn glass is a one-line diff."""
    rows = [f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}"
            for k, v in sorted(art.items())]
    return "{\n" + ",\n".join(rows) + "\n}\n"


def shipped():
    """What all.json holds now, or None when there is no readable copy."""
    try:
        return json.loads(OUT.read_text())
    except (OSError, ValueError):
        return None


def main(argv):
    art = drawings()
    name = OUT.relative_to(ROOT)
    if "--check" in argv:
        if shipped() != art:
            print(f"  GLASS  {name} does not match assets/glasses: run make glasses")
            return 1
        print(f"  glass   {name} carries all {len(art)} drawing(s)")
        return 0
    OUT.write_text(dumps(art))
    print(f"  glass   wrote {name}, {len(art)} drawing(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
