#!/usr/bin/env python3
"""Copy what the site serves into a directory, stamped with the tag.

    python3 scripts/stage.py v1.5.0 _site

The deploy uploads that directory and nothing else. Uploading the repo
put the working notes, the Makefile and every checker on the origin
beside the menu, crawlable under the site's own name. SERVED below is
the one list of what the origin hands out; check_assets.py reads it too
and fails on a link to anything outside it, so a new asset directory
cannot be forgotten here and found missing after a tag.

Stamping happens in the copy, never in the tree. The tag goes into
sw.js, which keys its cache on it, and into app.js, which prints it. It
also goes onto the stylesheet and script tags as `?v=<tag>`: the edge
holds js and css for four hours and html for ten minutes, and a visitor
with no worker (a private window, a drink page opened cold) would
otherwise get the new page against the old script. Each stamp has to
land exactly once. A token that occurs twice stamps the wrong one, and
one that occurs nowhere leaves the cache named after the placeholder,
so either refuses the stage and the deploy stops before an upload.
"""
import base64
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pages  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent

# Everything the origin serves. A directory carries everything tracked
# under it. Anything not named here is not on the site.
SERVED = [
    "index.html", "404.html", "offline.html", "sw.js",
    "manifest.webmanifest", "CNAME", ".nojekyll", "robots.txt",
    "sitemap.xml", "humans.txt", "llms.txt", "llms-full.txt",
    "assets", "data",
    # The pages pages.py writes: a drink each, the index over them, one
    # per section of the card and one per shape.
    "drink", "menu", "shape",
]
# Inside a served directory and never on the site: the README's
# screenshots live under assets/ beside the rest of the pictures, and
# nothing the site serves links them.
NOT_SERVED = ("assets/readme/",)

# What a tag or a branch name may be before it is written into a script
# string and an HTML attribute. A quote in a ref name would be neither.
VERSION = re.compile(r"^[A-Za-z0-9._+/-]+$")


# An inline script, which a Content-Security-Policy has to name by hash. A
# script with a src is named by its host, and JSON-LD is data, which CSP
# does not govern.
INLINE = re.compile(r"<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>", re.S)


class StageError(Exception):
    """A stage that would upload something wrong."""


def is_page(name):
    """A page pages.py writes, and so one the deploy stamps.

    Read off that script's own list rather than restated here: a hub
    left out would link the stylesheet with no ?v= on it and take the
    edge's four-hour-old copy after a release.
    """
    return any(PurePosixPath(name).match(g) for g in pages.OWNED)


def stamps(version, names):
    """(file, token, replacement) for every stamp a release makes."""
    out = [
        ("sw.js", "__BUILD__", version),
        ("assets/app.js", "__VERSION__", version),
        ("index.html", 'href="assets/app.css"',
         f'href="assets/app.css?v={version}"'),
        ("index.html", 'src="assets/app.js"',
         f'src="assets/app.js?v={version}"'),
    ]
    static = ["404.html", "offline.html"]
    static += sorted(n for n in names if is_page(n))
    out += [(p, 'href="/assets/app.css"', f'href="/assets/app.css?v={version}"')
            for p in static]
    return out


def stamp(name, text, token, value):
    """The text with its one token replaced, or a StageError."""
    n = text.count(token)
    if n != 1:
        raise StageError(f"{name}: {token} occurs {n} time(s), not once")
    return text.replace(token, value)


def tracked():
    """Every file under SERVED that git tracks or would, sorted.

    Asking git rather than walking the tree keeps a .DS_Store or an
    editor swap file off the site on a laptop rehearsal, and on the
    runner there is nothing untracked to find.
    """
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard",
         "--", *SERVED],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return sorted({n for n in out.split("\0") if n and (ROOT / n).is_file()
                   and not n.startswith(NOT_SERVED)})


def inline_hashes(root, names):
    """{'sha256-<base64>': [page, ...]} for every inline script served.

    The hash is over the exact text between the tags, which is what a
    browser hashes, so a changed space in the GTM snippet is a new hash
    and a CSP naming the old one blocks it.
    """
    out = {}
    # Top-level pages first, so a hash shared by 186 pages is shown by
    # index.html rather than whichever drink sorts first.
    pages = sorted((n for n in names if n.endswith(".html")),
                   key=lambda n: (n.count("/"), n))
    for name in pages:
        for attrs, body in INLINE.findall((Path(root) / name).read_text()):
            if "application/ld+json" in attrs:
                continue
            digest = hashlib.sha256(body.encode()).digest()
            key = "sha256-" + base64.b64encode(digest).decode()
            out.setdefault(key, []).append(name)
    return out


def stamped(version, names):
    """{file: stamped text} for every file a stamp touches."""
    out = {}
    for name, token, value in stamps(version, names):
        if name not in names:
            raise StageError(f"{name}: carries a stamp and is not staged")
        text = out.get(name) or (ROOT / name).read_text()
        out[name] = stamp(name, text, token, value)
    return out


def stage(version, dest):
    """Copy and stamp into dest. Returns (files staged, files stamped)."""
    if not VERSION.match(version):
        raise StageError(f"{version!r} is not a version this can write "
                         f"into a script string")
    if dest.exists() and any(dest.iterdir()):
        raise StageError(f"{dest} is not empty; stage into a fresh directory")
    names = tracked()
    texts = stamped(version, set(names))
    for name in names:
        out = dest / name
        out.parent.mkdir(parents=True, exist_ok=True)
        if name in texts:
            out.write_text(texts[name])
        else:
            shutil.copy2(ROOT / name, out)
    return len(names), len(texts)


def main():
    """Stage, or say why not and exit non-zero."""
    if len(sys.argv) != 3:
        print("usage: stage.py <version> <dest>")
        return 2
    version, dest = sys.argv[1], Path(sys.argv[2])
    try:
        n, touched = stage(version, dest)
    except StageError as e:
        print(f"  STAGE  {e}")
        return 1
    print(f"  stage   {n} file(s) into {dest}, {touched} stamped {version}")
    # The policy lives in a Cloudflare Transform Rule, not in the tree, so
    # a release that changes an inline script says so here, where the
    # person cutting it will see it. `make probe` checks the live header.
    for key, pages in inline_hashes(dest, tracked()).items():
        more = f" and {len(pages) - 1} more" if len(pages) > 1 else ""
        print(f"  csp     '{key}'  {pages[0]}{more}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
