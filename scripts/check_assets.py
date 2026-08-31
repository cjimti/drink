#!/usr/bin/env python3
"""Every local file index.html asks for should actually be in the repo.

A typo'd href on a static site fails silently — the page just loses its
stylesheet on someone's phone. Catch it before the deploy does not.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check_files(html):
    """Every local href/src in index.html points at a file that exists."""
    refs = re.findall(r'(?:href|src)="([^"]+)"', html)
    local = [r for r in refs if not r.startswith(("http:", "https:", "//", "#", "data:"))]
    missing = [r for r in local if not (ROOT / r).exists()]

    for r in missing:
        print(f"  MISSING {r}")
    return missing, len(local)


def check_ids(html, js):
    """Every id app.js reaches for is an id something actually renders.

    Deleting an element from index.html without deleting the line that
    writes to it throws during boot and takes the whole app down with it —
    silently, because nothing on a static site is watching. The ids the app
    renders itself count too, so collect those from the JS as well.
    """
    wanted = set(re.findall(r"""\$\(['"]#([\w-]+)['"]\)""", js))
    wanted |= set(re.findall(r"""getElementById\(['"]([\w-]+)['"]\)""", js))
    wanted |= set(re.findall(r"""querySelector\(['"]#([\w-]+)['"]\)""", js))

    present = set(re.findall(r'id="([\w-]+)"', html))
    present |= set(re.findall(r'id="([\w-]+)"', js))

    dangling = sorted(wanted - present)
    for i in dangling:
        print(f"  DANGLING #{i} — app.js reaches for it, nothing renders it")
    return dangling, len(wanted)


def check_worker(js, sw):
    """A service worker must never be able to take over a dev origin.

    Workers own the whole origin, and every static site in this workspace
    serves './', 'index.html' and 'assets/app.js'. One registered on
    http://localhost:8000 answers for whatever project runs there next,
    cache-first, and keeps answering with no server at all.

    Declining to register is not sufficient — a worker already installed
    goes on serving the old app.js, so the guard never runs. The app has
    to evict, and the worker has to be able to take itself out.
    """
    errs = []

    if "serviceWorker" in js:
        if "location.protocol === 'https:'" not in js:
            errs.append("app.js registers a worker without an https guard")
        if "unregister()" not in js:
            errs.append("app.js never unregisters — a stale worker cannot be evicted")

    if "self.registration.unregister()" not in sw:
        errs.append("sw.js cannot take itself out when it wakes up off https")

    for e in errs:
        print(f"  WORKER {e}")
    return errs


def main():
    html = (ROOT / "index.html").read_text()
    js = (ROOT / "assets" / "app.js").read_text()
    sw = (ROOT / "sw.js").read_text()

    missing, n_refs = check_files(html)
    dangling, n_ids = check_ids(html, js)
    worker = check_worker(js, sw)

    if missing or dangling or worker:
        return 1

    print(f"  assets  {n_refs} local reference(s) resolve, {n_ids} element id(s) exist")
    print("  worker  registration guarded, eviction present in app.js and sw.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
