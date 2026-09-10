#!/usr/bin/env python3
"""Turn the generated tool plates into ink on nothing.

The plates in assets/tools come out of the generator as white line art on
the dark ground, with a contact-sheet letter in the bottom right corner.
Served as they are they would be a black rectangle on the light theme and
on paper, and the letter is a label from a sheet nobody sees.

So: paint the corner out, read the drawing as an alpha channel, and write
a bone-coloured ink with that alpha. The ground is then whatever the page
is, the light theme inverts the ink with one filter, and the file drops
to a third of the size. Half resolution is still two device pixels per
CSS pixel at the width the Info tab draws them.

Idempotent: a plate that is already ink on nothing is read back through
its alpha and comes out the same. Pillow, as for make-og.py.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "assets" / "tools"

# The generator's frame and the box its letter sits in, in source pixels.
# The box is wider and taller than any letter so far; every plate's
# drawing stops well short of it.
SRC_W, SRC_H = 832, 1248
LETTER_BOX = (660, 1080, SRC_W, SRC_H)
OUT_W, OUT_H = 624, 936

# The ground is 18, not 0; everything at or under this is nothing.
FLOOR = 22
INK = 0xFB, 0xF8, 0xF1


def alpha_of(im):
    """The drawing as coverage, off the alpha if it already has one."""
    if "A" in im.getbands():
        return im.getchannel("A")
    lum = im.convert("L")
    return lum.point(lambda p: 0 if p <= FLOOR
                     else min(255, (p - FLOOR) * 255 // (255 - FLOOR)))


def clear_corner(alpha):
    """Paint the letter's box out, scaled to whatever size this is."""
    sx, sy = alpha.width / SRC_W, alpha.height / SRC_H
    x0, y0 = int(LETTER_BOX[0] * sx), int(LETTER_BOX[1] * sy)
    alpha.paste(0, (x0, y0, alpha.width, alpha.height))


def convert(path):
    im = Image.open(path)
    alpha = alpha_of(im)
    clear_corner(alpha)
    if alpha.size != (OUT_W, OUT_H):
        alpha = alpha.resize((OUT_W, OUT_H), Image.LANCZOS)
    out = Image.new("RGBA", alpha.size, INK + (0,))
    out.putalpha(alpha)
    out.save(path, optimize=True)
    return path.stat().st_size


def main():
    plates = sorted(DIR.glob("*.png"))
    if not plates:
        raise SystemExit(f"  TOOLS  nothing in {DIR.relative_to(ROOT)}")
    total = 0
    for p in plates:
        size = convert(p)
        total += size
        print(f"  tools   {p.relative_to(ROOT)}  {size // 1024} KB")
    print(f"  tools   {len(plates)} plate(s), {total // 1024} KB")


if __name__ == "__main__":
    main()
