"""扫描 doro_dz/ 里的 GIF：统计信息 + 感知哈希，找出重复 / 近似重复的动画。

输出 tools/library_scan.json 与 _library_scan.txt（供人工挑拣用）。
用法: python tools/scan_library.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "doro_dz"
OUT_JSON = ROOT / "tools" / "library_scan.json"
OUT_TXT = ROOT / "_library_scan.txt"


def dhash(frame: Image.Image, size: int = 16) -> int:
    """差值哈希：对灰度缩略图做水平梯度，得到 size*(size-1) 位。"""
    img = frame.convert("L").resize((size + 1, size), Image.LANCZOS)
    px = list(img.getdata())
    bits = 0
    for row in range(size):
        base = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | (1 if px[base + col] > px[base + col + 1] else 0)
    return bits


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def scan() -> list[dict]:
    items = []
    for path in sorted(SRC.glob("*.gif")):
        try:
            im = Image.open(path)
            frames = getattr(im, "n_frames", 1)
            total = 0
            hashes = []
            for idx in sorted({0, max(0, frames // 3), max(0, frames // 2), max(0, (frames * 2) // 3)}):
                im.seek(idx)
                total += int(im.info.get("duration") or 0)
                hashes.append(dhash(im))
            items.append(
                {
                    "file": path.name,
                    "w": im.size[0],
                    "h": im.size[1],
                    "frames": frames,
                    "durationMs": total,
                    "hash": hashes[2] if len(hashes) > 2 else hashes[0],
                    "hashes": hashes,
                }
            )
        except Exception as exc:  # noqa: BLE001
            items.append({"file": path.name, "error": str(exc)})
    return items


def cluster(items: list[dict], threshold: int = 6) -> list[list[dict]]:
    """按多帧哈希做近似去重：任一采样帧特别像就归为一组。"""
    groups: list[list[dict]] = []
    reps: list[dict] = []
    for item in items:
        if "error" in item:
            continue
        best = None
        for idx, rep in enumerate(reps):
            dist = min(hamming(a, b) for a in item["hashes"] for b in rep["hashes"])
            if dist <= threshold and (best is None or dist < best[0]):
                best = (dist, idx)
        if best is None:
            groups.append([item])
            reps.append(item)
        else:
            groups[best[1]].append(item)
    return groups


def main() -> None:
    items = scan()
    groups = cluster(items)
    groups.sort(key=lambda g: len(g), reverse=True)
    errors = [i for i in items if "error" in i]

    report = []
    for idx, group in enumerate(groups, 1):
        rep = group[0]
        report.append(
            {
                "id": idx,
                "file": rep["file"],
                "size": [rep["w"], rep["h"]],
                "frames": rep["frames"],
                "durationMs": rep["durationMs"],
                "aliases": [g["file"] for g in group[1:]],
            }
        )

    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        f"total={len(items)} unique={len(groups)} duplicates={len(items) - len(groups)} errors={len(errors)}",
        "",
    ]
    for entry in report:
        lines.append(
            f"{entry['id']:3d} {entry['file']} {entry['size'][0]}x{entry['size'][1]} "
            f"{entry['frames']}f {entry['durationMs']}ms aliases={len(entry['aliases'])}"
        )
    if errors:
        lines.append("")
        lines.append("errors:")
        for err in errors:
            lines.append(f"  {err['file']}: {err['error']}")
    OUT_TXT.write_text("\n".join(lines), encoding="utf-8")
    print(lines[0])


if __name__ == "__main__":
    main()
