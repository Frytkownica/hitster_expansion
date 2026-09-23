#!/usr/bin/env python3
"""Create 770x770 Hitster front cards from a UTF-8 text file."""
from __future__ import annotations

import argparse
import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 770
COLOR = (22, 22, 22)
FONT_SIZE = 250
MASK_SIZE = 256
PAPER_ALPHA = 0.75

RANGE_1_MIN = 240
RANGE_2_MIN = 50
RANGE_3_MIN = 120

RANGE_1_MAX = 255
RANGE_2_MAX = 100
RANGE_3_MAX = 200

PALETTES_LIGHT = {
    "1": ((RANGE_2_MIN, RANGE_2_MAX), (RANGE_1_MIN, RANGE_1_MAX), (RANGE_2_MIN, RANGE_2_MAX)),  # green: R, G, B ranges
    "2": ((RANGE_2_MIN, RANGE_2_MAX), (RANGE_2_MIN, RANGE_2_MAX), (RANGE_1_MIN, RANGE_1_MAX)),  # blue: R, G, B ranges
    "3": ((RANGE_1_MIN, RANGE_1_MAX), (RANGE_2_MIN, RANGE_2_MAX), (RANGE_2_MIN, RANGE_2_MAX)),  # red: R, G, B ranges
}

PALETTES_DARK = {
    "1": ((RANGE_3_MIN, RANGE_3_MAX), (RANGE_1_MIN, RANGE_1_MAX), (RANGE_3_MIN, RANGE_3_MAX)),  # green: R, G, B ranges
    "2": ((RANGE_3_MIN, RANGE_3_MAX), (RANGE_3_MIN, RANGE_3_MAX), (RANGE_1_MIN, RANGE_1_MAX)),  # blue: R, G, B ranges
    "3": ((RANGE_1_MIN, RANGE_1_MAX), (RANGE_3_MIN, RANGE_3_MAX), (RANGE_3_MIN, RANGE_3_MAX)),  # red: R, G, B ranges
}

def safe_name(text: str, index: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")[:55] or "front"
    return f"{index:03d}_{slug}.png"


def find_font() -> Path:
    here = Path(__file__).resolve().parent
    font_dirs = (
        here,
        Path("C:/Windows/Fonts"),
        Path.home() / "AppData/Local/Microsoft/Windows/Fonts",
    )
    candidates = [p for d in font_dirs for p in d.glob("*Moveo*SemiCond*Bold*.?tf")]
    candidates += [p for d in font_dirs for p in d.glob("*Moveo*Bold*.?tf")]
    if candidates:
        return candidates[0]
    raise SystemExit("Moveo Sans SemiCond W00 Bold font not found. Put the .ttf/.otf file next to this script.")


def random_color(ranges: tuple[tuple[int, int], tuple[int, int], tuple[int, int]]) -> tuple[int, int, int]:
    return tuple(random.randint(lo, hi) for lo, hi in ranges)


def gradient(light: tuple[int, int, int], dark: tuple[int, int, int]) -> Image.Image:
    angle = math.radians( random.choice([30, 0, -30]))
    dx = math.sin(angle)
    dy = math.cos(angle) * random.choice((-1, 1))
    edge = MASK_SIZE - 1
    corners = (0, edge * dx, edge * dy, edge * (dx + dy))
    low, high = min(corners), max(corners)
    mask = Image.new("L", (MASK_SIZE, MASK_SIZE))
    mask.putdata([
        round(255 * ((x * dx + y * dy - low) / (high - low)))
        for y in range(MASK_SIZE)
        for x in range(MASK_SIZE)
    ])
    mask = mask.resize((SIZE, SIZE), Image.Resampling.BICUBIC)
    return Image.composite(
        Image.new("RGB", (SIZE, SIZE), dark),
        Image.new("RGB", (SIZE, SIZE), light),
        mask,
    )


def paper_base() -> Image.Image:
    path = Path(__file__).resolve().parent / "paper.png"
    if not path.exists():
        raise SystemExit("paper.png not found next to this script.")
    image = Image.open(path).convert("RGB")
    scale = max(SIZE / image.width, SIZE / image.height)
    image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (image.width - SIZE) // 2
    top = (image.height - SIZE) // 2
    return image.crop((left, top, left + SIZE, top + SIZE))


def random_gradient(suffix: str) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    light_ranges = PALETTES_LIGHT.get(suffix)
    dark_ranges = PALETTES_DARK.get(suffix)
    if light_ranges is None or dark_ranges is None:
        raise ValueError(f"Unsupported suffix _{suffix}; expected _1, _2, or _3")
    return random_color(light_ranges), random_color(dark_ranges)


def draw_year(image: Image.Image, year: str, font: ImageFont.FreeTypeFont) -> None:
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((0, 0), year, font=font)
    x = (SIZE - (box[2] - box[0])) / 2 - box[0]
    y = (SIZE - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), year, fill=COLOR, font=font)


def make_front(row: str, font: ImageFont.FreeTypeFont, base: Image.Image, out_path: Path) -> None:
    year, suffix = row.rsplit("_", 1)
    image = Image.blend(base, gradient(*random_gradient(suffix)), PAPER_ALPHA)
    draw_year(image, year, font)
    image.save(out_path, format="PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, nargs="?", default=Path("qr_inputs.txt"), help="UTF-8 text file; one date_suffixed card per line")
    parser.add_argument("--out", type=Path, default=Path("front_output"))
    args = parser.parse_args()

    rows = [line.strip() for line in args.input.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if not rows:
        raise SystemExit("Input file has no non-empty rows.")

    args.out.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype(str(find_font()), FONT_SIZE)
    base = paper_base()
    for index, row in enumerate(rows, 1):
        make_front(row, font, base, args.out / safe_name(row, index))
    print(f"Created {len(rows)} front card(s) in {args.out.resolve()}")


if __name__ == "__main__":
    main()
