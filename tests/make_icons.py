"""Generate extension icons (rounded indigo tile, white speaker, two slider bars) without third-party deps."""
import math
import struct
import sys
import zlib
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else 'extension/icons')
BG_TOP, BG_BOT = (99, 91, 255), (67, 56, 202)
WHITE = (255, 255, 255)


def inside_rounded(x, y, r):
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_poly(x, y, pts):
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


SPEAKER = [(0.20, 0.40), (0.33, 0.40), (0.50, 0.25), (0.50, 0.75), (0.33, 0.60), (0.20, 0.60)]


def in_arc(x, y, radius, width):
    d = math.hypot(x - 0.50, y - 0.50)
    ang = math.degrees(math.atan2(y - 0.50, x - 0.50))
    return abs(d - radius) <= width / 2 and -50 <= ang <= 50 and x > 0.5


def sample(x, y):
    if not inside_rounded(x, y, 0.22):
        return None
    if in_poly(x, y, SPEAKER) or in_arc(x, y, 0.15, 0.065) or in_arc(x, y, 0.27, 0.065):
        return WHITE
    k = y
    return tuple(round(BG_TOP[i] * (1 - k) + BG_BOT[i] * k) for i in range(3))


def render(size, ss=4, pad=0):
    """pad = transparent margin in px per side (Web Store: 128 px icon → 96 px artwork + 16 px padding)."""
    art = size - 2 * pad
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    u = (px - pad + (sx + 0.5) / ss) / art
                    v = (py - pad + (sy + 0.5) / ss) / art
                    c = sample(u, v) if 0 <= u <= 1 and 0 <= v <= 1 else None
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = ss * ss
            a = acc[3] // n
            if a:
                cov = acc[3] / 255
                row += bytes([round(acc[0] / cov), round(acc[1] / cov), round(acc[2] / cov), a])
            else:
                row += b'\0\0\0\0'
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


OUT.mkdir(parents=True, exist_ok=True)
for s in (16, 32, 48, 128):
    (OUT / f'icon{s}.png').write_bytes(render(s, pad=16 if s == 128 else 0))
    print('wrote', OUT / f'icon{s}.png')
