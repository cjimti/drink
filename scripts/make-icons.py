#!/usr/bin/env python3
"""Render the 180px home-screen PNG from assets/icon.svg.

iOS ignores an SVG apple-touch-icon, so the one raster we need is drawn
here rather than kept as a binary nobody can diff. No dependencies — the
mark is three rectangles and a glass, which is exactly what a hand-rolled
PNG encoder can manage.

The social card is a different job: it has to set type. scripts/make-og.py
photographs the HTML card for that.
"""
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIZE = 180
BG = (0x12, 0x12, 0x11)
FG = (0xFB, 0xF8, 0xF1)


def blank():
    return [[BG] * SIZE for _ in range(SIZE)]


def rect(px, x0, y0, x1, y1, colour):
    for y in range(max(0, y0), min(SIZE, y1)):
        for x in range(max(0, x0), min(SIZE, x1)):
            px[y][x] = colour


def frame(px, x0, y0, x1, y1, w, colour):
    rect(px, x0, y0, x1, y0 + w, colour)
    rect(px, x0, y1 - w, x1, y1, colour)
    rect(px, x0, y0, x0 + w, y1, colour)
    rect(px, x1 - w, y0, x1, y1, colour)


def glass(px, colour):
    """A coupe: a tapering bowl, a stem, a foot. Same silhouette as the SVG."""
    top_l, top_r, top_y = 56, 124, 48
    apex_y = 90
    for y in range(top_y, apex_y):
        t = (y - top_y) / (apex_y - top_y)
        l = round(top_l + (90 - top_l) * t)
        r = round(top_r - (top_r - 90) * t)
        rect(px, l, y, r, y + 1, colour)
    rect(px, 85, apex_y, 95, 128, colour)   # stem
    rect(px, 70, 128, 110, 137, colour)     # foot


def png(px, path):
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in row) for row in px)

    def chunk(tag, body):
        c = tag + body
        return struct.pack(">I", len(body)) + c + struct.pack(">I", zlib.crc32(c))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    px = blank()
    frame(px, 14, 14, 166, 166, 5, FG)
    glass(px, FG)
    out = ROOT / "assets" / "icon-180.png"
    png(px, out)
    print(f"  icons   {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
