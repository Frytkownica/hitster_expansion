#!/usr/bin/env python3
"""Create 770x770 QR images from a UTF-8 text file.

Install:
    python -m pip install "qrcode[pil]" pillow

Examples:
    python hitster_qr_batch.py payloads.txt
    python hitster_qr_batch.py values.txt --prefix "hitsterexp:"
    python hitster_qr_batch.py payloads.txt --style standard
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
import qrcode
from qrcode.constants import ERROR_CORRECT_M

OUTPUT_SIZE = 770
PANEL_SIZE = 320
CENTER = OUTPUT_SIZE // 2
COLOR_1 = "white"
COLOR_2 = "black"
COLOR_3 = (22, 22, 22)
PREFIX = "hitsterexp:"

# Outside to inside, matching the supplied reference.
RING_COLORS = (
    (234, 38, 145),
    (58, 201, 244),
    (244, 224, 25),
    (224, 43, 151),
    (134, 79, 169),
    (235, 94, 52),
    (50, 201, 241),
    (241, 221, 24),
)

# Staggered broken arc sections, like the source artwork. Values may exceed 360.
RING_ARCS = (
    ((260, 570),),  # gap at upper-left
    ((100, 405),),   # gap at lower-right
    ((205, 520),),  # gap at lower-left
    ((32, 327),),  # gap at left/upper-left
    ((200, 525),),   # gap at lower-right
    ((20, 330),),  # gap at upper-right
    ((300, 600),),  # gap at lower-left
    ((180, 455),),  # gap at upper-left
)


def safe_name(text: str, index: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")[:55] or "qr"
    return f"{index:03d}_{slug}.png"


def normalize_payload(row: str) -> str:
    return row if row.startswith(PREFIX) else PREFIX + row


def gradient_background() -> Image.Image:
    """Subtle dark-grey-at-top to near-black-at-bottom gradient."""
    image = Image.new("RGB", (OUTPUT_SIZE, OUTPUT_SIZE))
    px = image.load()
    for y in range(OUTPUT_SIZE):
        t = y / (OUTPUT_SIZE - 1)
        base = round(30 * (1.0 - t) + 13 * t)
        for x in range(OUTPUT_SIZE):
            edge = abs(x - CENTER) / CENTER
            shade = max(0, base - round(4 * edge * edge))
            px[x, y] = (shade, shade + 2, shade + 2)
    return image


def draw_rings(image: Image.Image) -> None:
    """Draw eight thin broken rings with a restrained neon glow."""
    scale = 10
    shadow_scale = 1.015
    work_size = OUTPUT_SIZE * scale
    glow = Image.new("RGBA", (work_size, work_size), (0, 0, 0, 0))
    core = Image.new("RGBA", (work_size, work_size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cd = ImageDraw.Draw(core)

    radii = (354, 331, 308, 285, 262, 239, 216, 193)

    for radius, color, sections in zip(radii, RING_COLORS, RING_ARCS):
        box_1 = tuple(v * scale for v in (
            CENTER - radius, CENTER - radius,
            CENTER + radius, CENTER + radius,
        ))
        box_2 = tuple(v * scale for v in (
            CENTER - radius* shadow_scale, CENTER - radius* shadow_scale,
            CENTER + radius* shadow_scale, CENTER + radius* shadow_scale,
        ))
        for raw_start, raw_end in sections:
            start, end = raw_start % 360, raw_end % 360
            if start < end:
                spans = ((start, end),)
            else:
                spans = ((start, 360), (0, end))
            for a0, a1 in spans:
                gd.arc(box_2, a0, a1, fill=(*color, 72), width=15 * scale)
                cd.arc(box_1, a0, a1, fill=(*color, 255), width=6 * scale)

    glow_small = glow.filter(ImageFilter.GaussianBlur(4 * scale)).resize(image.size, Image.Resampling.LANCZOS)
    core_small = core.resize(image.size, Image.Resampling.LANCZOS)
    image.paste(glow_small, mask=glow_small)
    image.paste(core_small, mask=core_small)


def qr_matrix(payload: str) -> list[list[bool]]:
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=1, border=0)
    qr.add_data(payload)
    qr.make(fit=True)
    return qr.get_matrix()


def finder_cells(n: int) -> set[tuple[int, int]]:
    cells: set[tuple[int, int]] = set()
    for row, col in ((0, 0), (0, n - 7), (n - 7, 0)):
        for r in range(row, row + 7):
            for c in range(col, col + 7):
                cells.add((r, c))
    return cells


def connected_sides(matrix: list[list[bool]], r: int, c: int) -> list[str]:
    n = len(matrix)
    found = []
    for dr, dc, side in (
        (-1, 0, "top"), (1, 0, "bottom"),
        (0, -1, "left"), (0, 1, "right"),
    ):
        rr, cc = r + dr, c + dc
        if 0 <= rr < n and 0 <= cc < n and matrix[rr][cc]:
            found.append(side)
    return found


def cut_module_points(x0: int, y0: int, size: int, connection: str) -> list[tuple[int, int]]:
    """Bevel the exposed side opposite a module's only connection."""
    x1, y1 = x0 + size, y0 + size
    cut = max(2, round(size * 0.48))
    if connection == "right":
        return [(x0 + cut, y0), (x1, y0), (x1, y1), (x0, y1)]
    if connection == "left":
        return [(x0, y0), (x1 - cut, y0), (x1, y1), (x0, y1)]
    if connection == "bottom":
        return [(x0, y0 + cut), (x1, y0), (x1, y1), (x0, y1)]
    return [(x0, y0), (x1, y0), (x1, y1 - cut), (x0, y1)]



def draw_standard_finder(draw: ImageDraw.ImageDraw, x: int, y: int, module: int, rounded: bool) -> None:
    radius = max(3, module // 2) if rounded else 0
    draw.rounded_rectangle((x, y, x + 7 * module - 1, y + 7 * module - 1), radius=radius, fill=COLOR_1)
    draw.rectangle((x + module, y + module, x + 6 * module - 1, y + 6 * module - 1), fill=COLOR_2)
    draw.rectangle((x + 2 * module, y + 2 * module, x + 5 * module - 1, y + 5 * module - 1), fill=COLOR_1)


def draw_qr_panel(image: Image.Image, payload: str) -> None:
    matrix = qr_matrix(payload)
    n = len(matrix)
    quiet_modules = 1
    module = PANEL_SIZE / (n + (quiet_modules * 2))
    panel_left = (OUTPUT_SIZE - PANEL_SIZE) // 2
    panel_top = panel_left
    draw = ImageDraw.Draw(image)
    draw.rectangle(
        (panel_left, panel_top, panel_left + PANEL_SIZE - 1, panel_top + PANEL_SIZE - 1),
        fill=COLOR_3,
    )
    draw.rectangle(
        (panel_left + round(module,0), panel_top + round(module,0) , panel_left + PANEL_SIZE - round(module,0) -2, panel_top + PANEL_SIZE - round(module,0) -2),
        fill=COLOR_2,
    )
    origin_x = panel_left + quiet_modules * module
    origin_y = panel_top + quiet_modules * module
    reserved = finder_cells(n)

    for r, row in enumerate(matrix):
        for c, dark in enumerate(row):
            if not dark or (r, c) in reserved:
                continue
            x = origin_x + c * module
            y = origin_y + r * module
            draw.rectangle((x, y, x + module - 1, y + module - 1), fill=COLOR_1)

    for fr, fc in ((0, 0), (0, n - 7), (n - 7, 0)):
        x, y = origin_x + fc * module, origin_y + fr * module
        draw_standard_finder(draw, x, y, module, rounded=False)


def make_qr(payload: str, out_path: Path) -> None:
    image = gradient_background()
    draw_rings(image)
    draw_qr_panel(image, payload)
    image.save(out_path, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="UTF-8 text file; one QR payload per line")
    parser.add_argument("--out", type=Path, default=Path("qr_output"), help="output directory")
    args = parser.parse_args()

    rows = [line.strip() for line in args.input.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if not rows:
        raise SystemExit("Input file has no non-empty rows.")

    args.out.mkdir(parents=True, exist_ok=True)
    for index, row in enumerate(rows, 1):
        payload = normalize_payload(row)
        make_qr(payload, args.out / safe_name(payload, index))
    print(f"Created {len(rows)} QR code(s) in {args.out.resolve()}")


if __name__ == "__main__":
    main()
