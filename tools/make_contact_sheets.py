"""把去重后的动作缩略图拼成编号联系表，方便人工挑选 / 命名。

用法: python tools/make_contact_sheets.py [每张数量]
输出: _sheets/sheet_XX.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "doro_dz"
OUT = ROOT / "_sheets"
LIBRARY = ROOT / "tools" / "action-library.json"

COLS, ROWS = 6, 5
TILE = 170
CAPTION = 20


def main() -> None:
    per_sheet = int(sys.argv[1]) if len(sys.argv) > 1 else COLS * ROWS
    items = json.loads(LIBRARY.read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    for chunk_index in range(0, len(items), per_sheet):
        chunk = items[chunk_index : chunk_index + per_sheet]
        rows = (len(chunk) + COLS - 1) // COLS
        sheet = Image.new("RGB", (COLS * TILE, rows * (TILE + CAPTION)), (245, 243, 246))
        draw = ImageDraw.Draw(sheet)
        for i, item in enumerate(chunk):
            try:
                im = Image.open(SRC / item["source"])
                im.seek(getattr(im, "n_frames", 1) // 2)
                frame = im.convert("RGBA")
            except Exception:  # noqa: BLE001
                continue
            bg = Image.new("RGB", frame.size, (255, 255, 255))
            bg.paste(frame, mask=frame.split()[3])
            bg.thumbnail((TILE - 8, TILE - 8), Image.LANCZOS)
            x = (i % COLS) * TILE + (TILE - bg.width) // 2
            y = (i // COLS) * (TILE + CAPTION) + (TILE - bg.height) // 2
            sheet.paste(bg, (x, y))
            draw.text(
                ((i % COLS) * TILE + 5, (i // COLS) * (TILE + CAPTION) + TILE + 3),
                f"#{item['id']} {item['name']} | {item['label']} | {item['category']}",
                fill=(90, 70, 90),
            )
        path = OUT / f"sheet_{chunk_index // per_sheet + 1:02d}.png"
        sheet.save(path)
        print(path.name, len(chunk), sheet.size)


if __name__ == "__main__":
    main()
