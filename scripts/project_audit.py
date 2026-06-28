#!/usr/bin/env python3
"""Project red-line audit for Time Logger."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "8"
REQUIRED_ICON_SIZES = {
    "icons/icon-192.png": (192, 192),
    "icons/icon-512.png": (512, 512),
    "icons/maskable-192.png": (192, 192),
    "icons/maskable-512.png": (512, 512),
    "icons/apple-touch-icon.png": (180, 180),
}


def read_text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        header = f.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("not a PNG file")
    return struct.unpack(">II", header[16:24])


def audit_manifest(errors: list[str]) -> None:
    try:
        manifest = json.loads(read_text("manifest.webmanifest"))
    except json.JSONDecodeError as exc:
        fail(errors, f"manifest.webmanifest is not valid JSON: {exc}")
        return

    if manifest.get("version") != EXPECTED_VERSION:
        fail(errors, f"manifest.webmanifest version must be {EXPECTED_VERSION!r}")

    icons = manifest.get("icons")
    if not isinstance(icons, list):
        fail(errors, "manifest.webmanifest must contain an icons array")
        return

    by_src = {icon.get("src"): icon for icon in icons if isinstance(icon, dict)}
    for src, expected_size in REQUIRED_ICON_SIZES.items():
        path = ROOT / src
        if not path.exists():
            fail(errors, f"required icon is missing: {src}")
            continue
        try:
            actual_size = png_size(path)
        except ValueError as exc:
            fail(errors, f"{src} is invalid: {exc}")
            continue
        if actual_size != expected_size:
            fail(errors, f"{src} must be {expected_size[0]}x{expected_size[1]}, got {actual_size[0]}x{actual_size[1]}")

    for src in ("icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png"):
        if src not in by_src:
            fail(errors, f"manifest.webmanifest is missing icon entry: {src}")

    for src in ("icons/maskable-192.png", "icons/maskable-512.png"):
        purpose = str(by_src.get(src, {}).get("purpose", ""))
        if "maskable" not in purpose.split():
            fail(errors, f"{src} manifest purpose must include maskable")


def audit_service_worker(errors: list[str]) -> None:
    sw = read_text("sw.js")
    match = re.search(r"const\s+CACHE\s*=\s*['\"]timelog-v(\d+)['\"]", sw)
    if not match:
        fail(errors, "sw.js must declare CACHE = 'timelog-vN'")
    elif match.group(1) != EXPECTED_VERSION:
        fail(errors, f"sw.js cache must be timelog-v{EXPECTED_VERSION}")

    for src in ["./" + src for src in REQUIRED_ICON_SIZES]:
        if src not in sw:
            fail(errors, f"sw.js FILES must cache runtime asset {src}")


def button_attrs(tag: str) -> str:
    return tag.split(">", 1)[0]


def audit_index(errors: list[str]) -> None:
    html = read_text("index.html")
    if "title=" in html:
        fail(errors, "index.html must not use native title= tooltips")
    if "iconSvg('x')" in html or re.search(r"^\s*x\s*:", html, re.MULTILINE):
        fail(errors, "index.html must not define or use the x icon")
    if re.search(r'data-action="start-edit"[^>]*>\s*改\s*</button>', html):
        fail(errors, "timeline edit action must be icon-only, not text 改")
    if re.search(r'data-action="delete-entry"[^>]*>\s*(?:✕|×|x)\s*</button>', html, re.IGNORECASE):
        fail(errors, "delete action must not use x/×/✕")
    if re.search(r'data-action="cancel-edit"[^>]*>\s*(?:✕|×|x)\s*</button>', html, re.IGNORECASE):
        fail(errors, "cancel edit action must not use x/×/✕")

    for match in re.finditer(r"<button\b[^>]*\bicon-btn\b[^>]*>", html):
        attrs = button_attrs(match.group(0))
        if "aria-label=" not in attrs:
            fail(errors, f"icon button is missing aria-label near byte {match.start()}")
        if "data-tip=" not in attrs:
            fail(errors, f"icon button is missing data-tip near byte {match.start()}")

    for tip in ("编辑记录", "删除记录", "保存修改", "取消编辑"):
        if f'data-tip="{tip}"' not in html:
            fail(errors, f"icon action tooltip is missing or not short: {tip}")

    if ".inp" not in html or "font-size: 16px" not in html:
        fail(errors, "text inputs must keep a 16px font-size floor for mobile")
    open_form = re.search(r"function\s+openForm\(\)\s*\{(?P<body>.*?)\n\s*\}", html, re.DOTALL)
    if open_form and ".focus(" in open_form.group("body"):
        fail(errors, "opening the add form must not auto-focus the text input")


def audit_docs(errors: list[str]) -> None:
    doc_names = ["README.md", "CLAUDE.md", "使用与理念.md"]
    docs = {name: read_text(name) for name in doc_names}
    combined = "\n".join(docs.values())

    for forbidden in ("威泰", "不做跨天汇总报表", "不能跨天汇总报表"):
        if forbidden in combined:
            fail(errors, f"documentation must not contain stale/private phrase: {forbidden}")

    readme = docs["README.md"]
    if "python3 scripts/project_audit.py" not in readme:
        fail(errors, "README.md must document the project audit command")

    claude = docs["CLAUDE.md"]
    required_claude_phrases = [
        "timelog-v8",
        "禁止 `title=`",
        "删除/取消禁用 x",
        "输入字号不低于 16px",
        "运行时资产必须进 SW 缓存",
        "公开仓库不得含真实记录/截图/具体个人线索",
        "| v8 |",
    ]
    for phrase in required_claude_phrases:
        if phrase not in claude:
            fail(errors, f"CLAUDE.md is missing maintenance rule/changelog phrase: {phrase}")


def main() -> int:
    errors: list[str] = []
    audit_manifest(errors)
    audit_service_worker(errors)
    audit_index(errors)
    audit_docs(errors)

    if errors:
        print("project audit failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("project audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
