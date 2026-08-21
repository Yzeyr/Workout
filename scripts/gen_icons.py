"""Generate app icons (barbell mark) as raw PNGs, no external deps.

Run: python3 scripts/gen_icons.py
Writes icon-192.png, icon-512.png, apple-touch-icon.png (180x180) into the repo root.
"""
import struct
import zlib
import os

INK = (0x16, 0x1C, 0x22)
PLASTER = (0xE8, 0xE4, 0xDC)
OXIDE = (0xB5, 0x43, 0x2B)


def make_png(path, size):
    w = h = size
    px = [[INK for _ in range(w)] for _ in range(h)]

    # Barbell: a horizontal bar with a plate block near each end.
    bar_h = max(2, round(size * 0.045))
    bar_y0 = h // 2 - bar_h // 2
    bar_y1 = bar_y0 + bar_h
    bar_x0 = round(w * 0.14)
    bar_x1 = round(w * 0.86)
    for y in range(bar_y0, bar_y1):
        for x in range(bar_x0, bar_x1):
            px[y][x] = PLASTER

    plate_w = round(size * 0.09)
    plate_h = round(size * 0.46)
    plate_y0 = h // 2 - plate_h // 2
    plate_y1 = plate_y0 + plate_h
    for x0 in (round(w * 0.14), round(w * 0.86) - plate_w):
        for y in range(plate_y0, plate_y1):
            for x in range(x0, x0 + plate_w):
                if 0 <= x < w and 0 <= y < h:
                    px[y][x] = OXIDE

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # no filter
        for x in range(w):
            r, g, b = px[y][x]
            raw += bytes((r, g, b, 255))

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    make_png(os.path.join(root, "icon-192.png"), 192)
    make_png(os.path.join(root, "icon-512.png"), 512)
    make_png(os.path.join(root, "apple-touch-icon.png"), 180)
    print("icons written")
