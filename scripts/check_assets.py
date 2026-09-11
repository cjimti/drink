#!/usr/bin/env python3
"""Every local file index.html asks for should actually be in the repo.

A typo'd href on a static site fails silently — the page just loses its
stylesheet on someone's phone. Catch it before the deploy does not.
"""
import re
import struct
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


GLASS_DIR = ROOT / "assets" / "glasses"


def js_function(js, name):
    """One top-level function of app.js, found by matching its braces."""
    try:
        start = js.index("function " + name + "(")
    except ValueError:
        raise SystemExit(f"  GLASS  app.js has no {name}() any more; "
                         f"check_glasses reads the art names out of it") from None
    depth = 0
    for i in range(js.index("{", start), len(js)):
        depth += 1 if js[i] == "{" else -1 if js[i] == "}" else 0
        if not depth:
            return js[start:i + 1]
    return js[start:]


def check_glasses(js):
    """Every drawing a serve token can ask for exists, and none is spare.

    `pickGlassArt` turns the glass letter into a filename stem and
    `garnishArt` turns whatever follows it into a suffix. Cross the two and
    that is every name the app can build. A name with no file behind it
    fails the way static sites fail: `renderGlass` finds nothing in
    `glassMarkup`, returns an empty string, and the row loses its icon on
    somebody's phone with nothing in the console. Both lists are read off
    the app so there is no second copy here to go stale. This one reports
    rather than prints, because test_checks.py runs it over broken sources
    and a passing pipeline should say nothing about them.
    """
    stems = re.findall(r"return extra \? '[a-z-]+' \+ extra : '([a-z-]+)';",
                       js_function(js, "pickGlassArt"))
    suffixes = set(re.findall(r"return '([a-z]*)';",
                              js_function(js, "garnishArt")))

    wanted = set(stems)
    wanted |= {f"{stem}-{suf}" for stem in stems for suf in suffixes if suf}

    listed = re.search(r"var GLASS_FILES = \[(.*?)\];", js, re.S).group(1)
    listed = {n.strip() for n in listed.replace("'", "").split(",") if n.strip()}
    have = {f.stem for f in GLASS_DIR.glob("*.svg")}

    errs = [f"assets/glasses/{n}.svg: a serve token reaches it, nothing draws it"
            for n in sorted(wanted - have)]
    errs += [f"{n}: drawn but never fetched, so GLASS_FILES has to name it"
             for n in sorted(wanted - listed)]
    errs += [f"{n}: fetched by GLASS_FILES and not in assets/glasses"
             for n in sorted(listed - have)]
    return errs, len(wanted)


TOOL_DIR = ROOT / "assets" / "tools"
# What make-tools.py writes: half the generator's frame, RGBA (colour type 6).
PLATE = (624, 936, 6)


def plate_headers():
    """(width, height, colour type) of every PNG in assets/tools, off IHDR."""
    out = {}
    for f in sorted(TOOL_DIR.glob("*.png")):
        head = f.read_bytes()[:29]
        w, h, _, ctype = struct.unpack(">IIBB", head[16:26])
        out[f.name] = (w, h, ctype)
    return out


def check_plates(html, sw, headers):
    """Every tool plate is converted, on the Info tab, and in the shell.

    The generator writes an opaque 832x1248 frame with a letter in the
    corner; make-tools.py turns that into ink on nothing at half size.
    Serving the raw frame puts a black rectangle on the light theme, so a
    plate still in the generator's shape fails here with the command to
    run. A plate nothing shows is dead weight, like a stocked bottle no
    drink uses, and one the worker does not cache is a broken picture the
    first time the help tab opens with no signal.
    """
    errs = []
    for name, (w, h, ctype) in headers.items():
        if (w, h, ctype) != PLATE:
            errs.append(f"assets/tools/{name} is {w}x{h} colour type "
                        f"{ctype}, not ink on nothing: run make tools")
        if f'src="assets/tools/{name}"' not in html:
            errs.append(f"assets/tools/{name}: on disk, shown nowhere")
        if f"'assets/tools/{name}'" not in sw:
            errs.append(f"assets/tools/{name}: not in the worker's SHELL, "
                        f"so it is missing offline")
    return errs


WELL_KNOWN = [
    "robots.txt",
    "sitemap.xml",
    "llms.txt",
    "llms-full.txt",
    "humans.txt",
    "404.html",
    "assets/og.png",
    "assets/qr.svg",
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
    if "fetch(fresh(path)" not in sw or "'v=' + VERSION" not in sw:
        errs.append("sw.js installs its shell without a version query — an edge cache can hand it the previous release for ten minutes after a tag")
    if "if (res.ok)" not in sw:
        errs.append("sw.js caches responses without checking res.ok — a 404 or a 5xx would be pinned until the next tag")
    shell = re.search(r"var SHELL = \[(.*?)\];", sw, re.S)
    if "'offline.html'" not in (shell.group(1) if shell else ""):
        errs.append("sw.js does not cache offline.html with the shell — the one page a dead link can fall back on has to be there before the signal goes")
    elif not (ROOT / "offline.html").exists():
        errs.append("sw.js caches offline.html and the file is not in the repo — the install would throw and nothing would cache at all")
    if "caches.match('offline.html')" not in sw or "req.mode !== 'navigate'" not in sw:
        errs.append("sw.js never serves offline.html — a drink link opened with no signal lands on the browser's error page")

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
    glass, n_glass = check_glasses(js)
    for e in glass:
        print(f"  GLASS  {e}")
    plates = plate_headers()
    plate = check_plates(html, sw, plates)
    for e in plate:
        print(f"  PLATE  {e}")

    if missing or dangling or worker or well or glass or plate:
        return 1

    print(f"  assets  {n_refs} local reference(s) resolve, {n_ids} element id(s) exist")
    print(f"  glass   {n_glass} drawing(s) a serve token can ask for, all present")
    print(f"  plates  {len(plates)} tool plate(s) converted, shown and cached")
    print(f"  well    {len(WELL_KNOWN)} crawler/agent file(s) present")
    print("  worker  registration guarded, eviction present in app.js and sw.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
