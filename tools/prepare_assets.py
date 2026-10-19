"""把动作库里的 GIF 处理成桌面宠物可用的资源。

读取 tools/action-library.json（由 tools/build_library.py 生成），对每个动作：
1. 缩放到最长边 MAX_DIM，控制体积；
2. 从画布四边做洪水填充，抠掉与边缘连通的白色背景（保留 doro 身体的白）；
3. 按所有帧的并集裁边，让不同动作里的 doro 看起来一样大；
4. 输出带透明通道的动画 WebP 到 assets/pet/，并汇总成 assets/actions.json。

用法:
    python tools/prepare_assets.py [--limit N] [--only name1,name2]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "doro_dz"
OUT_DIR = ROOT / "assets" / "pet"
ICON_DIR = ROOT / "assets" / "icons"
LIBRARY = ROOT / "tools" / "action-library.json"

KEY_COLOR = (255, 0, 255)
BG_TOLERANCE = 42
MAX_DIM = 300
PADDING = 4


def strip_background(frame: Image.Image) -> Image.Image:
    frame = frame.convert("RGBA")
    w, h = frame.size
    scale = min(1.0, MAX_DIM / max(w, h))
    if scale < 1:
        frame = frame.resize((max(2, round(w * scale)), max(2, round(h * scale))), Image.LANCZOS)

    w, h = frame.size
    rgb = Image.new("RGB", frame.size, KEY_COLOR)
    rgb.paste(frame, mask=frame.split()[3])

    # 只从四角和四边中点起填：ImageDraw.floodfill 每调用一次都会扫全图，
    # 边缘撒太多种子会让 300 个动作的转换慢到不可接受。
    seeds = {
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w // 2, 0),
        (w // 2, h - 1),
        (0, h // 2),
        (w - 1, h // 2),
    }
    for pt in seeds:
        r, g, b = rgb.getpixel(pt)
        if min(r, g, b) >= 150:
            ImageDraw.floodfill(rgb, pt, KEY_COLOR, thresh=BG_TOLERANCE)

    arr = np.asarray(rgb, dtype=np.uint8)
    is_key = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255)
    alpha = Image.fromarray(np.where(is_key, 0, 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.5))
    out = frame.copy()
    out.putalpha(alpha)
    return out


def load_frames(path: Path) -> tuple[list[Image.Image], list[int]]:
    im = Image.open(path)
    frames: list[Image.Image] = []
    durations: list[int] = []
    try:
        while True:
            durations.append(max(int(im.info.get("duration") or 30), 20))
            frames.append(strip_background(im))
            im.seek(im.tell() + 1)
    except EOFError:
        pass
    return frames, durations


def crop_to_content(frames: list[Image.Image], padding: int = PADDING) -> list[Image.Image]:
    if not frames:
        return frames
    union = None
    for frame in frames:
        box = frame.getchannel("A").getbbox()
        if box is None:
            continue
        union = box if union is None else (
            min(union[0], box[0]),
            min(union[1], box[1]),
            max(union[2], box[2]),
            max(union[3], box[3]),
        )
    if union is None:
        return frames
    w, h = frames[0].size
    left = max(0, union[0] - padding)
    top = max(0, union[1] - padding)
    right = min(w, union[2] + padding)
    bottom = min(h, union[3] + padding)
    if right - left < 2 or bottom - top < 2:
        return frames
    return [frame.crop((left, top, right, bottom)) for frame in frames]


def save_webp(frames: list[Image.Image], durations: list[int], dest: Path) -> bool:
    try:
        frames[0].save(
            dest,
            "WEBP",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            quality=70,
            alpha_quality=90,
            method=4,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"  ! WebP 写入失败: {exc}")
        return False


def main() -> int:
    args = sys.argv[1:]
    only = None
    limit = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])

    library = json.loads(LIBRARY.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ICON_DIR.mkdir(parents=True, exist_ok=True)

    manifest = []
    idle_frames = None
    processed = 0
    for item in library:
        if only and item["name"] not in only:
            continue
        if limit is not None and processed >= limit:
            break
        src = SRC_DIR / item["source"]
        if not src.exists():
            print(f"! 缺少源文件: {src.name}")
            continue
        processed += 1
        print(f"[{processed}/{len(library)}] {item['name']} ({item['label']})", flush=True)
        frames, durations = load_frames(src)
        frames = crop_to_content(frames)
        dest = OUT_DIR / f"{item['name']}.webp"
        if not save_webp(frames, durations, dest):
            frames[0].save(dest.with_suffix(".png"), "PNG")
            dest = dest.with_suffix(".png")
        if item["name"] == "idle_stand" and frames:
            idle_frames = frames[0].copy()
        manifest.append(
            {
                "name": item["name"],
                "label": item["label"],
                "category": item["category"],
                "group": item["group"],
                "blocked": bool(item.get("blocked")),
                "file": f"pet/{dest.name}",
                "size": list(frames[0].size),
                "frames": len(frames),
                "durationMs": sum(durations),
            }
        )

    if only or limit:
        print("局部模式：不写 actions.json / 托盘图标")
        return 0

    manifest.sort(key=lambda x: (x["group"], x["name"]))
    (ROOT / "assets" / "actions.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"动作清单: {len(manifest)} 个 -> assets/actions.json")

    if idle_frames is None:
        idle_frames = Image.open(OUT_DIR / f"{manifest[0]['name']}.webp").convert("RGBA")
    icon_src = idle_frames.copy()
    icon_src.thumbnail((256, 256))
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.paste(icon_src, ((256 - icon_src.width) // 2, (256 - icon_src.height) // 2))
    canvas.save(ICON_DIR / "tray.png", "PNG")
    canvas.save(
        ICON_DIR / "tray.ico",
        "ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("托盘图标 -> assets/icons/tray.png / tray.ico")
    return 0


if __name__ == "__main__":
    sys.exit(main())
