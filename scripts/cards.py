#!/usr/bin/env python3
"""One share card per drink: assets/cards/<id>.png, 1200 by 630.

This is the picture a link unfurls into in a message thread. The name
in tracked caps over the heavy rule, the ingredient lines in italic,
method and glass in grey, the shorthand set in mono, and the glass the
serve token calls for, drawn from the same art the menu uses. Dark
ground, because that is the site, and a crawler does not know what
theme the reader's phone is in.

Rendering needs Pillow and rsvg-convert, like make-og.py. The check
does not: every card carries a hash of what it was drawn from in a PNG
text chunk, so `python3 scripts/cards.py --check` reads 174 headers and
refuses a stale, missing or orphaned card with nothing installed. That
is what lets CI hold the line without a font on the box.

`python3 scripts/cards.py` renders whatever is stale. `--all` redraws
every card, for when the design changes.
"""
import hashlib
import importlib.util
import io
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llms  # noqa: E402  (path set above; there is no package here)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "cards"
GLASS_DIR = ROOT / "assets" / "glasses"

# A 1200 by 630 card drawn at 2x and brought down, so the line art and
# the italic stay crisp when a phone scales the preview again.
W, H, S = 1200, 630, 2

# The dark theme's tokens, as make-og.py already writes them. A card is
# not a stylesheet, so these are the one place a colour is spelled out
# for it; keep them the same as app.css.
GROUND = (0x12, 0x12, 0x11)
BONE = (0xFB, 0xF8, 0xF1)
MUTED = (0xAD, 0xA7, 0x9C)

FONTS = {
    "lato-italic": (
        "Lato-Italic.ttf",
        "https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Italic.ttf",
    ),
    "dm-mono": (
        "DMMono-Medium.ttf",
        "https://raw.githubusercontent.com/googlefonts/dm-mono/main/exports/DMMono-Medium.ttf",
    ),
}

CHUNK = "fewbottles"

# What the drawing itself is worth, hashed into every card beside the
# drink it draws. Bump it by hand when the picture changes: the layout
# here, the type, the colours above, or the faces in FONTS and in
# make-og.py. Leave it alone for a comment, a docstring or a refactor,
# because the script is not what a card is drawn from, and hashing the
# script stales every card on the shelf over a typo in this sentence.
DRAW = 1


def og_module():
    """make-og.py has the raster pipeline; a hyphen keeps it off import."""
    spec = importlib.util.spec_from_file_location("make_og", ROOT / "scripts" / "make-og.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.FONTS.update(FONTS)
    return mod


def garnish_art(rest):
    """Same first pass as app.js garnishArt: which drawing a token gets."""
    if not rest:
        return ""
    if rest == "Lw":
        return "wheel"
    if rest in ("c", "O") or (rest[0] == "c" and not rest.startswith("cin")):
        return "pick"
    if rest in ("l", "L", "o", "fo"):
        return "twist"
    return ""


GLASS_BASE = {"c": "nick-nora", "r": "rocks", "R": "rocks-cube",
              "h": "highball", "H": "highball-ice"}


def pick_glass(serve):
    base = GLASS_BASE.get(serve[:1])
    if not base:
        return None
    extra = garnish_art(serve[1:])
    return f"{base}-{extra}" if extra else base


def lines_for(drink, by_id):
    return [llms.pour_text(part, by_id) for part in drink["build"]]


def serve_for(drink, notation):
    codes = llms.garnish_codes(notation)
    return f"{drink['method'].capitalize()}, {llms.serve_line(drink, notation, codes).lower()}"


def spec_for(drink, by_id, notation):
    """What a card is drawn from. Hash this and the card is dated."""
    art = pick_glass(drink["serve"])
    svg = (GLASS_DIR / f"{art}.svg").read_text() if art else ""
    return {
        "name": drink["name"],
        "code": drink["code"],
        "lines": lines_for(drink, by_id),
        "serve": serve_for(drink, notation),
        "art": art,
        "svg": svg,
        "draw": DRAW,
        "fonts": sorted(FONTS.items()),
    }


def digest(spec):
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]


def stamped(path):
    """The hash a card was rendered from, read off its tEXt chunk."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return None
    pos = 8
    while pos + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"tEXt" and body.startswith(CHUNK.encode() + b"\0"):
            return body[len(CHUNK) + 1:].decode()
        pos += 12 + length
    return None


def wanted():
    """{id: (spec, hash)} for every drink on the menu."""
    menu = llms.load("cocktails.json")
    bar = llms.load("bar.json")
    notation = llms.load("notation.json")
    by_id = {i["id"]: i for i in bar["ingredients"]}
    out = {}
    for d in menu["cocktails"]:
        spec = spec_for(d, by_id, notation)
        out[d["id"]] = (spec, digest(spec))
    return out


def on_disk():
    return {p.stem: p for p in OUT.glob("*.png")}


def check_cards(want, have):
    """Stale, missing or orphaned cards, as messages. Empty means clean."""
    errs = []
    for did, (_, want_hash) in sorted(want.items()):
        got = stamped(have[did]) if did in have else None
        if got is None:
            errs.append(f"assets/cards/{did}.png is missing")
        elif got != want_hash:
            errs.append(f"assets/cards/{did}.png is stale")
    for did in sorted(set(have) - set(want)):
        errs.append(f"assets/cards/{did}.png is for a drink no longer on the menu")
    return errs


def tracked_fit(draw, text, path, px, max_w, tracking):
    """The largest size at or under px that fits the name on one line."""
    from PIL import ImageFont
    while px > 24 * S:
        face = ImageFont.truetype(str(path), px)
        width = sum(draw.textlength(ch, font=face) for ch in text) + tracking * px * (len(text) - 1)
        if width <= max_w:
            return face
        px -= 2 * S
    return ImageFont.truetype(str(path), px)


def draw_glass(og, img, art, box):
    """The glass on a shared foot line at the right edge of the card."""
    from PIL import Image
    x0, y0, x1, y1 = box
    g = og.raster_glass(og.find_rsvg(), art, 900)
    scale = min((y1 - y0) / g.size[1], (x1 - x0) / g.size[0])
    g = g.resize((round(g.size[0] * scale), round(g.size[1] * scale)), Image.Resampling.LANCZOS)
    img.paste(g, (x0 + (x1 - x0 - g.size[0]) // 2, y1 - g.size[1]), g)


def draw_card(og, paths, spec):
    """The card at 2x, as an RGB image."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (W * S, H * S), GROUND)
    draw = ImageDraw.Draw(img)
    pad = 64 * S
    wm = og.font(paths["montserrat-800"], 22 * S)
    og.tracked(draw, (pad, pad), "fewbottles.com", wm, MUTED, 0.04 * 22 * S)

    glass_w = 300 * S
    text_w = W * S - 2 * pad - (glass_w + 40 * S if spec["art"] else 0)
    if spec["art"]:
        draw_glass(og, img, spec["art"], (W * S - pad - glass_w, pad, W * S - pad, H * S - pad))

    y = pad + 46 * S
    name = spec["name"].upper()
    face = tracked_fit(draw, name, paths["montserrat-800"], 64 * S, text_w, 0.08)
    og.tracked(draw, (pad, y), name, face, BONE, 0.08 * face.size)
    y += face.size + 14 * S
    draw.rectangle((pad, y, pad + text_w, y + 6 * S), fill=BONE)
    y += 6 * S + 26 * S

    code_f = og.font(paths["dm-mono"], 30 * S)
    serve_f = og.font(paths["lato-italic"], 30 * S)
    floor = H * S - pad - code_f.size - 10 * S - serve_f.size - 18 * S
    n, px = len(spec["lines"]), 40 * S
    while px > 22 * S and y + n * px * 1.3 > floor:
        px -= 2 * S
    line_f = og.font(paths["lato-italic"], int(px))
    for line in spec["lines"]:
        draw.text((pad, y), line, font=line_f, fill=BONE)
        y += int(px * 1.3)

    draw.text((pad, floor + 8 * S), spec["serve"], font=serve_f, fill=MUTED)
    draw.text((pad, H * S - pad - code_f.size), spec["code"], font=code_f, fill=BONE)
    return img


def save(img, path, stamp):
    """Down to 1200 by 630, a palette so 174 of them stay small, stamped."""
    from PIL import Image
    from PIL.PngImagePlugin import PngInfo
    small = img.resize((W, H), Image.Resampling.LANCZOS).quantize(colors=32)
    info = PngInfo()
    info.add_text(CHUNK, stamp)
    buf = io.BytesIO()
    small.save(buf, "PNG", optimize=True, pnginfo=info)
    path.write_bytes(buf.getvalue())


def render(want, have, redo_all):
    og = og_module()
    if not og.find_rsvg():
        print("  cards   rsvg-convert not found: brew install librsvg", file=sys.stderr)
        return 1
    paths = og.fetch_fonts()
    OUT.mkdir(parents=True, exist_ok=True)
    for did in set(have) - set(want):
        have[did].unlink()
        print(f"  cards   removed assets/cards/{did}.png")
    drawn = 0
    for did, (spec, stamp) in want.items():
        path = OUT / f"{did}.png"
        if not redo_all and stamped(path) == stamp:
            continue
        save(draw_card(og, paths, spec), path, stamp)
        drawn += 1
    total = sum(p.stat().st_size for p in OUT.glob("*.png"))
    print(f"  cards   drew {drawn} card(s); {len(want)} on disk, {total // 1024} KB")
    return 0


def main(argv):
    want, have = wanted(), on_disk()
    if "--check" in argv:
        errs = check_cards(want, have)
        for e in errs[:8]:
            print(f"  CARDS   {e}: run make cards")
        if len(errs) > 8:
            print(f"  CARDS   and {len(errs) - 8} more")
        if errs:
            return 1
        print(f"  cards   {len(want)} share card(s) current")
        return 0
    return render(want, have, "--all" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
