#!/usr/bin/env python3
"""Render the home-screen PNGs from the mark in assets/icon.svg.

iOS ignores an SVG apple-touch-icon, and Chrome will not offer to install
a site whose manifest has no 192 and no 512, so the rasters are drawn
here rather than kept as binaries nobody can diff. No dependencies: the
mark is a frame and a coupe, which is exactly what a hand-rolled PNG
encoder can manage.

Android masks an icon to whatever shape the launcher uses, and only a
circle of 80% of the width survives every one of them. A frame is the
edge of the card, and a mask draws an edge of its own, so the maskable
sheet is the coupe alone inside that circle. A rectangle with its corners
sliced off does not read as a border; it reads as a fault.

The bowl tapers, and at 512 every step of it shows, so the mark is drawn
at three times the size and averaged down.

The social card is a different job: it has to set type. scripts/make-og.py
photographs the HTML card for that.
"""
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BG = (0x12, 0x12, 0x11)
FG = (0xFB, 0xF8, 0xF1)

# The mark is drawn in the 180-unit grid of icon.svg and scaled from there,
# so the two never drift apart.
UNIT = 180
FRAME = (14, 14, 166, 166, 5)           # left, top, right, bottom, stroke
BOWL = (56, 124, 48, 90)                # rim left, rim right, rim, apex
STEM = (85, 90, 95, 128)
FOOT = (70, 128, 110, 137)
GLASS = (56, 48, 124, 137)              # the box the whole coupe sits in

# How much of a maskable sheet the coupe stands in, as a share of the
# height. At 0.6 the corners of its box land well inside the safe circle.
SAFE = 0.6
SS = 3                                  # supersample, then average down

SHEETS = (
    ("icon-180.png", 180, False),       # apple-touch-icon; iOS masks nothing
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-512-maskable.png", 512, True),
)


class Mark:
    """A square of ink coverage, drawn in the mark's own 180-unit grid."""

    def __init__(self, size, scale, ox, oy):
        self.size, self.n = size, size * SS
        self.scale, self.ox, self.oy = scale * SS, ox * SS, oy * SS
        self.ink = [bytearray(self.n) for _ in range(self.n)]

    def box(self, x0, y0, x1, y1):
        """One filled rectangle in mark units, clipped to the sheet."""
        left = max(0, round(self.ox + x0 * self.scale))
        right = min(self.n, round(self.ox + x1 * self.scale))
        top = max(0, round(self.oy + y0 * self.scale))
        bottom = min(self.n, round(self.oy + y1 * self.scale))
        for y in range(top, bottom):
            row = self.ink[y]
            for x in range(left, right):
                row[x] = 1

    def frame(self):
        """The card's edge: four bars drawn inside the box, not on it."""
        x0, y0, x1, y1, w = FRAME
        self.box(x0, y0, x1, y0 + w)
        self.box(x0, y1 - w, x1, y1)
        self.box(x0, y0, x0 + w, y1)
        self.box(x1 - w, y0, x1, y1)

    def coupe(self):
        """A tapering bowl, a stem, a foot. The silhouette of the SVG."""
        left, right, rim, apex = BOWL
        rows = max(1, round((apex - rim) * self.scale))
        step = (apex - rim) / rows
        for i in range(rows):
            t = i / rows
            y = rim + (apex - rim) * t
            self.box(left + (90 - left) * t, y, right - (right - 90) * t,
                     y + step)
        self.box(*STEM)
        self.box(*FOOT)

    def sheet(self):
        """Average each block down to one pixel of ink on the ground."""
        rows, whole = [], SS * SS
        for y in range(self.size):
            band = self.ink[y * SS:(y + 1) * SS]
            row = []
            for x in range(self.size):
                hits = sum(sum(r[x * SS:(x + 1) * SS]) for r in band)
                row.append(BG if not hits else FG if hits == whole
                           else blend(hits / whole))
            rows.append(row)
        return rows


def blend(t):
    """Ink laid over the ground at coverage t."""
    return tuple(round(b + (f - b) * t) for b, f in zip(BG, FG))


def build(size, maskable):
    """One sheet: the whole mark, or the coupe alone in the safe circle."""
    if not maskable:
        mark = Mark(size, size / UNIT, 0, 0)
        mark.frame()
        mark.coupe()
        return mark

    gx0, gy0, gx1, gy1 = GLASS
    scale = SAFE * size / (gy1 - gy0)
    mark = Mark(size, scale,
                size / 2 - (gx0 + gx1) / 2 * scale,
                size / 2 - (gy0 + gy1) / 2 * scale)
    mark.coupe()
    return mark


def png(rows, size, path):
    """A plain RGB PNG. Three chunks is the whole format we need."""
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in rows)

    def chunk(tag, body):
        c = tag + body
        return struct.pack(">I", len(body)) + c + struct.pack(">I", zlib.crc32(c))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    for name, size, maskable in SHEETS:
        out = ROOT / "assets" / name
        png(build(size, maskable).sheet(), size, out)
        print(f"  icons   {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
