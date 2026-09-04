#!/usr/bin/env python3
"""Render assets/og.png from the glass drawings the menu already uses.

The card is a specimen plate of the serve-token art — Nick & Nora and
rocks, empty and garnished — on the dark ground, with the wordmark so
a share still says where it came from. rasters via rsvg-convert; type
via Pillow. Fonts cache locally; the PNG is committed.
"""
from __future__ import annotations

import io
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
GLASS_DIR = ROOT / "assets" / "glasses"
OUT = ROOT / "assets" / "og.png"
CACHE = ROOT / "scripts" / ".font-cache"

# 2× a 1200×630 card so the line art stays sharp when a phone scales it.
W, H, S = 1200 * 2, 630 * 2, 2

GROUND = (0x12, 0x12, 0x11)
BONE = (0xFB, 0xF8, 0xF1)
MUTED = (0xAD, 0xA7, 0x9C)
BONE_HEX = "#FBF8F1"

# The garnish matrix the decoder already knows. Same filenames as
# assets/glasses/. Three rows of four so the plate stays even.
SET = (
    ("nick-nora", "nick-nora-twist", "nick-nora-pick", "nick-nora-wheel"),
    ("rocks", "rocks-twist", "rocks-pick", "rocks-wheel"),
    ("rocks-cube", "rocks-cube-twist", "rocks-cube-pick", "rocks-cube-wheel"),
)

FONTS = {
    "montserrat-800": (
        "Montserrat-ExtraBold.ttf",
        "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-ExtraBold.ttf",
    ),
    "montserrat-600": (
        "Montserrat-SemiBold.ttf",
        "https://raw.githubusercontent.com/JulietaUla/Montserrat/master/fonts/ttf/Montserrat-SemiBold.ttf",
    ),
}

RSVG_CANDIDATES = (
    "rsvg-convert",
    "/opt/homebrew/bin/rsvg-convert",
    "/usr/local/bin/rsvg-convert",
    "/usr/bin/rsvg-convert",
)


def find_rsvg():
    for c in RSVG_CANDIDATES:
        if Path(c).is_file():
            return c
        found = shutil.which(c)
        if found:
            return found
    return None


def fetch_fonts():
    CACHE.mkdir(parents=True, exist_ok=True)
    paths = {}
    for key, (name, url) in FONTS.items():
        dest = CACHE / name
        if not dest.exists() or dest.stat().st_size < 1000:
            print(f"  og      fetching {name}")
            subprocess.run(
                ["curl", "-fsSL", "--retry", "3", "-o", str(dest), url],
                check=True,
                timeout=30,
            )
        paths[key] = dest
    return paths


def font(path, px):
    return ImageFont.truetype(str(path), px)


def tracked(draw, xy, text, face, fill, tracking):
    x, y = xy
    for i, ch in enumerate(text):
        draw.text((x, y), ch, font=face, fill=fill)
        x += draw.textlength(ch, font=face)
        if i < len(text) - 1:
            x += tracking
    return x


def mark(draw, x, y, size):
    """The topbar coupe: bone square, dark glass. Same path as the SVG."""
    draw.rounded_rectangle((x, y, x + size, y + size), radius=round(size * 0.05), fill=BONE)
    scale = size / 40
    pts = [
        (13, 11), (27, 11), (21.6, 19.4), (21.6, 26.8), (25.7, 26.8),
        (25.7, 28.7), (14.3, 28.7), (14.3, 26.8), (18.4, 26.8), (18.4, 19.4),
    ]
    draw.polygon([(x + px * scale, y + py * scale) for px, py in pts], fill=GROUND)


def raster_glass(rsvg, name, height):
    """Bone line art on a transparent ground, cropped to the ink."""
    src = GLASS_DIR / (name + ".svg")
    svg = src.read_text().replace('color="#111110"', f'color="{BONE_HEX}"')
    proc = subprocess.run(
        [rsvg, "-h", str(height), "-b", "none"],
        input=svg.encode(),
        capture_output=True,
        check=True,
    )
    im = Image.open(io.BytesIO(proc.stdout)).convert("RGBA")
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def main():
    rsvg = find_rsvg()
    if not rsvg:
        print("  og      rsvg-convert not found — brew install librsvg", file=sys.stderr)
        return 1
    try:
        paths = fetch_fonts()
    except Exception as e:
        print(f"  og      could not fetch fonts: {e}", file=sys.stderr)
        return 1

    img = Image.new("RGB", (W, H), GROUND)
    draw = ImageDraw.Draw(img)

    pad_x = 64 * S
    pad_y = 44 * S
    name_face = font(paths["montserrat-800"], 36 * S)
    home_face = font(paths["montserrat-600"], 12 * S)

    mark_size = 36 * S
    mark(draw, pad_x, pad_y, mark_size)
    name_x = pad_x + mark_size + 14 * S
    name_y = pad_y + (mark_size - 36 * S) / 2 - 2 * S
    tracked(draw, (name_x, name_y), "drink", name_face, BONE, 0.07 * 36 * S)

    rule_y = pad_y + mark_size + 16 * S
    draw.rectangle((pad_x, rule_y, pad_x + 72 * S, rule_y + 5 * S), fill=BONE)

    foot_y = H - 40 * S - 12 * S
    tracked(draw, (pad_x, foot_y), "SHOEPHONE", home_face, MUTED, 0.13 * 12 * S)

    # Specimen plate. Raster large, crop to the ink, then sit every glass
    # in a row on a shared foot line so a twist does not lift the tumbler.
    grid_top = rule_y + 5 * S + 18 * S
    grid_bot = foot_y - 22 * S
    row_gap = 22 * S
    n_rows = len(SET)
    # Render from the 270-tall viewBox; trim drops the empty air above
    # a rocks glass, so the three rows can share the height fairly.
    raw = [[raster_glass(rsvg, n, 900) for n in names] for names in SET]
    max_h = [max(g.size[1] for g in row) for row in raw]
    scale = (grid_bot - grid_top - row_gap * (n_rows - 1)) / sum(max_h)

    y = grid_top
    for row, rh in zip(raw, max_h):
        fitted = [
            g.resize((round(g.size[0] * scale), round(g.size[1] * scale)), Image.Resampling.LANCZOS)
            for g in row
        ]
        row_h = round(rh * scale)
        gap = 36 * S
        row_w = sum(g.size[0] for g in fitted) + gap * (len(fitted) - 1)
        x = (W - row_w) // 2
        for g in fitted:
            img.paste(g, (x, y + row_h - g.size[1]), g)
            x += g.size[0] + gap
        y += row_h + row_gap

    img.save(OUT, "PNG", optimize=True)
    print(f"  og      {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {W}×{H})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
