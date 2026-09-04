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


WELL_KNOWN = [
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "llms-full.txt",
    "humans.txt",
    "assets/og.png",
]


def check_well_known():
    """Crawlers and agents look at well-known paths, not at index.html."""
    missing = [p for p in WELL_KNOWN if not (ROOT / p).exists()]
    for p in missing:
        print(f"  MISSING {p}")
    return missing


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
        if "updateViaCache" not in js:
            errs.append("app.js registers without updateViaCache: 'none' — Safari will serve a four-hour-cached sw.js")
        if ".update()" not in js:
            errs.append("app.js never pokes update() — an iOS home-screen WebView will not check on its own")

    if "self.registration.unregister()" not in sw:
        errs.append("sw.js cannot take itself out when it wakes up off https")
    if sw.count(".navigate(") < 2:
        errs.append("sw.js must navigate clients both off https and when a new cache replaces an old one")

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
    well = check_well_known()

    if missing or dangling or worker or well:
        return 1

    print(f"  assets  {n_refs} local reference(s) resolve, {n_ids} element id(s) exist")
    print(f"  well    {len(WELL_KNOWN)} crawler/agent file(s) present")
    print("  worker  registration guarded, eviction present in app.js and sw.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
