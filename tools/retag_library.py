"""对动作库做二次分类修订：只改 label / category / group / blocked，不动文件。

用法: python tools/retag_library.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "tools" / "action-library.json"
ACTIONS = ROOT / "assets" / "actions.json"

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

# 二次核对后的修订
RETAG = {
    "slide_lying": {"category": "idle"},  # 实际是趴着滑，不是走路
    "work_drum": {"category": "music"},  # 打鼓属于玩乐 / 音乐
    "bathtub": {"category": "scene"},  # 实拍猫 + 贴纸，属于小剧场
    "eat_pumpkin": {"label": "抱橘子"},  # 实际是橙子
    "sleep_together": {"category": "scene"},  # 双角色同框
}

# 不参与随机表演的内容（动作库仍可见）
BLOCKED = {
    "play_knife",
    "play_gun",
    "play_gun2",
    "play_gun3",
    "play_sword",
    "dress_swimsuit",
    "special_black",
    "night_gun",
}


def main() -> None:
    library = json.loads(LIBRARY.read_text(encoding="utf-8"))
    actions = json.loads(ACTIONS.read_text(encoding="utf-8"))
    by_name = {item["name"]: item for item in library}
    by_name_actions = {item["name"]: item for item in actions}

    changed = 0
    for name, patch in RETAG.items():
        item = by_name.get(name)
        if not item:
            print(f"! 动作库里没有 {name}")
            continue
        if "category" in patch:
            item["category"] = patch["category"]
            item["group"] = GROUP[patch["category"]]
        if "label" in patch:
            item["label"] = patch["label"]
        changed += 1
        target = by_name_actions.get(name)
        if target:
            if "category" in patch:
                target["category"] = patch["category"]
                target["group"] = GROUP[patch["category"]]
            if "label" in patch:
                target["label"] = patch["label"]

    for item in library:
        item["blocked"] = item["name"] in BLOCKED
    for item in actions:
        item["blocked"] = item["name"] in BLOCKED

    LIBRARY.write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
    ACTIONS.write_text(json.dumps(actions, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"修订 {changed} 个动作，标记 {len(BLOCKED)} 个为不随机")


if __name__ == "__main__":
    main()
