"""按 library_names.py 重命名源 GIF，并生成动作库清单 tools/action-library.json。

用法:
    python tools/build_library.py          # 正式重命名
    python tools/build_library.py --dry    # 只检查，不改文件
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from library_names import NAMES

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "doro_dz"
SCAN = ROOT / "tools" / "library_scan.json"
OUT = ROOT / "tools" / "action-library.json"

GROUP = {
    "idle": "日常",
    "walk": "日常",
    "run": "日常",
    "happy": "情绪",
    "love": "情绪",
    "sad": "情绪",
    "angry": "情绪",
    "eat": "吃睡",
    "sleep": "吃睡",
    "bath": "吃睡",
    "toilet": "吃睡",
    "play": "玩乐",
    "dance": "玩乐",
    "music": "玩乐",
    "swim": "玩乐",
    "work": "打工",
    "dress": "换装",
    "scene": "小剧场",
    "vehicle": "小剧场",
    "meme": "表情包",
    "special": "表情包",
}


def main() -> int:
    dry = "--dry" in sys.argv
    items = json.loads(SCAN.read_text(encoding="utf-8"))
    ids = {item["id"] for item in items}

    missing = sorted(ids - set(NAMES))
    extra = sorted(set(NAMES) - ids)
    if missing or extra:
        print(f"命名表不完整：缺 {missing}，多 {extra}")
        return 1

    slugs = [NAMES[i][0] for i in ids]
    dup_slugs = {s for s in slugs if slugs.count(s) > 1}
    if dup_slugs:
        print(f"英文短名重复：{sorted(dup_slugs)}")
        return 1

    library = []
    renames = []
    for item in items:
        slug, label, category = NAMES[item["id"]]
        group = GROUP.get(category)
        if not group:
            print(f"未知分类 {category}（id={item['id']}）")
            return 1
        new_name = f"{slug}.gif"
        renames.append((item["file"], new_name))
        aliases = []
        for idx, alias in enumerate(item.get("aliases", []), 1):
            alias_new = f"{slug}__dup{idx}.gif"
            renames.append((alias, alias_new))
            aliases.append(alias_new)
        library.append(
            {
                "id": item["id"],
                "name": slug,
                "label": label,
                "category": category,
                "group": group,
                "source": new_name,
                "aliases": aliases,
                "width": item["size"][0],
                "height": item["size"][1],
                "frames": item["frames"],
            }
        )

    if dry:
        print(f"检查通过：{len(library)} 个动作，{len(renames)} 个文件待重命名")
        for old, new in renames[:5]:
            print(f"  {old} -> {new}")
        return 0

    for old, new in renames:
        src = SRC / old
        dst = SRC / new
        if not src.exists():
            print(f"源文件不存在：{old}")
            return 1
        if dst.exists():
            print(f"目标已存在，跳过：{new}")
            continue
        shutil.move(str(src), str(dst))

    library.sort(key=lambda x: (list(GROUP.values()).index(x["group"]), x["id"]))
    OUT.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已重命名 {len(renames)} 个文件，动作库 {len(library)} 条 -> {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
