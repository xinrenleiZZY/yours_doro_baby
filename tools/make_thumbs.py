"""为动作库生成静态缩略图（assets/thumbs/<name>.png），供动作库面板快速浏览。

用法: python tools/make_thumbs.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
THUMBS = ASSETS / "thumbs"
SIZE = 96


def main() -> None:
    actions = json.loads((ASSETS / "actions.json").read_text(encoding="utf-8"))
    THUMBS.mkdir(parents=True, exist_ok=True)
    count = 0
    for action in actions:
        src = ASSETS / action["file"]
        try:
            im = Image.open(src)
            im.seek(getattr(im, "n_frames", 1) // 2)
            frame = im.convert("RGBA")
            frame.thumbnail((SIZE, SIZE), Image.LANCZOS)
            canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
            canvas.paste(frame, ((SIZE - frame.width) // 2, (SIZE - frame.height) // 2))
            canvas.save(THUMBS / f"{action['name']}.png")
            count += 1
        except Exception as exc:  # noqa: BLE001
            print(f"! {action['name']}: {exc}")
    print(f"缩略图 {count} / {len(actions)}")


if __name__ == "__main__":
    main()
