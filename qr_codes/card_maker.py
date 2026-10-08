from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageOps


PAGE_MM = {
    "A1": (594, 841),
    "A2": (420, 594),
    "A3": (297, 420),
    "A4": (210, 297),
    "A5": (148, 210),
}
PAGE_CHOICES = (*PAGE_MM, "P", "PICTURE")
IMAGE_EXTS = {".png", ".jpg", ".jpeg"}
PDF_DPI = 300
SIZE_TOLERANCE_MM = 0.25


def mm_to_px(mm: float) -> int:
    return round(mm / 25.4 * PDF_DPI)


def image_mm(image: Image.Image, dpi: float) -> tuple[float, float]:
    return image.width / dpi * 25.4, image.height / dpi * 25.4


def ask_choice(prompt: str, choices: Iterable[str]) -> str:
    choices = tuple(choices)
    while True:
        value = input(prompt).strip().upper()
        if value in choices:
            return value
        print(f"Choose one of: {', '.join(choices)}")


def ask_float(prompt: str, low: float, high: float) -> float:
    while True:
        try:
            value = float(input(prompt).replace(",", "."))
        except ValueError:
            print(f"Enter a number from {low:g} to {high:g}.")
            continue
        if low <= value <= high:
            return value
        print(f"Enter a number from {low:g} to {high:g}.")


def find_folder(names: tuple[str, ...]) -> Path:
    found = [Path(name) for name in names if Path(name).is_dir()]
    if len(found) == 1:
        return found[0]
    if not found:
        raise SystemExit(f"Missing folder: create one of {', '.join(names)}")
    raise SystemExit(f"Only keep one of these folders: {', '.join(map(str, found))}")


def image_files(folder: Path) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for path in folder.iterdir():
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            if path.stem in files:
                raise SystemExit(f"Duplicate image name in {folder}: {path.stem}")
            files[path.stem] = path
    return files


def best_layout(page_mm: tuple[int, int], card_mm: tuple[float, float], min_gap_mm: float, min_scale: float) -> tuple[float, int, int]:
    best = (0, 0.0, 0, 0)
    for step in range(1000, round(min_scale * 1000) - 1, -1):
        scale = step / 1000
        card_w = card_mm[0] * scale
        card_h = card_mm[1] * scale
        cols = max(int((page_mm[0] + min_gap_mm) // (card_w + min_gap_mm)), 0)
        rows = max(int((page_mm[1] + min_gap_mm) // (card_h + min_gap_mm)), 0)
        count = cols * rows
        if (count, scale) > best[:2]:
            best = (count, scale, cols, rows)
    if best[0] == 0:
        raise SystemExit("No cards fit on the page at the requested minimum scale.")
    return best[1], best[2], best[3]


def paste_centered(page: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    x, y, w, h = box
    image.thumbnail((w, h), Image.Resampling.LANCZOS)
    page.paste(image, (x + (w - image.width) // 2, y + (h - image.height) // 2))


def axis_positions(page_px: int, card_px: int, count: int, min_gap_px: int) -> list[int]:
    if count == 1:
        return [(page_px - card_px) // 2]
    free = page_px - card_px * count
    gap = free / (count + 1)
    if gap >= min_gap_px:
        return [round(gap + i * (card_px + gap)) for i in range(count)]
    block = card_px * count + min_gap_px * (count - 1)
    start = (page_px - block) / 2
    return [round(start + i * (card_px + min_gap_px)) for i in range(count)]


def make_sheet(paths: list[Path], page_px: tuple[int, int], card_px: tuple[int, int], min_gap_px: int, cols: int, rows: int, back: bool) -> Image.Image:
    page = Image.new("RGB", page_px, "white")
    x_positions = axis_positions(page_px[0], card_px[0], cols, min_gap_px)
    y_positions = axis_positions(page_px[1], card_px[1], rows, min_gap_px)
    for index, path in enumerate(paths):
        row, col = divmod(index, cols)
        if back:
            col = cols - 1 - col
        with Image.open(path) as image:
            paste_centered(page, ImageOps.exif_transpose(image).convert("RGB"), (x_positions[col], y_positions[row], *card_px))
    return page


def build_pdf(fronts: list[Path], backs: list[Path], page_mm: tuple[int, int], card_mm: tuple[float, float], min_gap_mm: float, min_scale: float) -> Path:
    scale, cols, rows = best_layout(page_mm, card_mm, min_gap_mm, min_scale)
    per_page = cols * rows
    page_px = tuple(map(mm_to_px, page_mm))
    card_px = (mm_to_px(card_mm[0] * scale), mm_to_px(card_mm[1] * scale))
    min_gap_px = mm_to_px(min_gap_mm)
    pages: list[Image.Image] = []

    for start in range(0, len(fronts), per_page):
        front_batch = fronts[start : start + per_page]
        back_batch = backs[start : start + per_page]
        pages.append(make_sheet(front_batch, page_px, card_px, min_gap_px, cols, rows, back=False))
        pages.append(make_sheet(back_batch, page_px, card_px, min_gap_px, cols, rows, back=True))

    out = Path("cards.pdf")
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=PDF_DPI)
    print(f"Saved {out} ({len(fronts)} cards, {len(pages)} pages, {cols}x{rows}, {scale:.1%} scale)")
    return out


def build_picture_pdf(fronts: list[Path], backs: list[Path]) -> Path:
    pages: list[Image.Image] = []
    for front, back in zip(fronts, backs):
        for path in (front, back):
            with Image.open(path) as image:
                pages.append(ImageOps.exif_transpose(image).convert("RGB"))

    out = Path("cards.pdf")
    pages[0].save(out, "PDF", save_all=True, append_images=pages[1:], resolution=PDF_DPI)
    print(f"Saved {out} ({len(fronts)} cards, {len(pages)} pages, picture-size pages)")
    return out


def validate_pairs(fronts: list[Path], backs: list[Path], dpi: float, same_front_size: bool = True) -> tuple[float, float]:
    first_size: tuple[float, float] | None = None
    for front, back in zip(fronts, backs):
        with Image.open(front) as front_image, Image.open(back) as back_image:
            front_mm = image_mm(front_image, dpi)
            back_mm = image_mm(back_image, dpi)
        mismatch = max(abs(front_mm[0] - back_mm[0]), abs(front_mm[1] - back_mm[1]))
        if mismatch > SIZE_TOLERANCE_MM:
            raise SystemExit(f"Size mismatch over {SIZE_TOLERANCE_MM:g} mm: {front.name} vs {back.name} ({mismatch:.2f} mm)")
        if first_size is None:
            first_size = front_mm
        elif same_front_size and max(abs(first_size[0] - front_mm[0]), abs(first_size[1] - front_mm[1])) > SIZE_TOLERANCE_MM:
            raise SystemExit(f"Front cards are not the same size: {front.name}")
    if first_size is None:
        raise SystemExit("No matching image pairs found.")
    return first_size


def run() -> None:
    page_name = ask_choice("Page format (A1, A2, A3, A4, A5, P/Picture): ", PAGE_CHOICES)
    if page_name == "PICTURE":
        page_name = "P"
    image_dpi = ask_float("Image DPI: ", 1, 2400)
    if page_name != "P":
        min_gap_mm = ask_float("Minimum distance between cards in mm (0-5): ", 0, 5)
        min_scale = ask_float("Minimum card scale in percent (75-100): ", 75, 100) / 100

    front_folder = find_folder(("fronts", "front"))
    back_folder = find_folder(("backs", "back"))
    front_by_name = image_files(front_folder)
    back_by_name = image_files(back_folder)
    names = sorted(front_by_name.keys() & back_by_name.keys())
    missing_fronts = sorted(back_by_name.keys() - front_by_name.keys())
    missing_backs = sorted(front_by_name.keys() - back_by_name.keys())

    print(f"Found {len(names)} matching name pairs.")
    if missing_fronts:
        print(f"Backs without fronts: {', '.join(missing_fronts)}")
    if missing_backs:
        print(f"Fronts without backs: {', '.join(missing_backs)}")
    if ask_choice("Continue? [Y/N]: ", ("Y", "N")) != "Y":
        return

    fronts = [front_by_name[name] for name in names]
    backs = [back_by_name[name] for name in names]
    card_mm = validate_pairs(fronts, backs, image_dpi, same_front_size=page_name != "P")
    if page_name == "P":
        build_picture_pdf(fronts, backs)
    else:
        build_pdf(fronts, backs, PAGE_MM[page_name], card_mm, min_gap_mm, min_scale)


def self_test() -> None:
    assert image_mm(Image.new("RGB", (300, 600)), 300) == (25.4, 50.8)
    assert "P" in PAGE_CHOICES and "PICTURE" in PAGE_CHOICES
    assert best_layout((210, 297), (63, 88), 0, 0.75) == (0.833, 4, 4)
    assert best_layout((210, 297), (63, 88), 5, 0.75) == (0.773, 4, 4)
    assert best_layout((210, 297), (70, 99), 5, 1.0) == (1.0, 2, 2)
    assert axis_positions(100, 20, 3, 5) == [10, 40, 70]
    print("self-test ok")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        run()
