#!/usr/bin/env python3
"""Project red-line audit for Time Logger."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "14"
EXPECTED_TOOLTIP_DELAY = "800ms"
REQUIRED_ICON_SIZES = {
    "icons/icon-192.png": (192, 192),
    "icons/icon-512.png": (512, 512),
    "icons/maskable-192.png": (192, 192),
    "icons/maskable-512.png": (512, 512),
    "icons/apple-touch-icon.png": (180, 180),
}
REQUIRED_DEMO_ASSETS = [
    "docs/assets/demo-mobile-timeline.png",
    "docs/assets/demo-mobile-edit-drawer.png",
]
REQUIRED_MAINTENANCE_COMMANDS = [
    "python3 scripts/project_audit.py",
    "python3 scripts/confirm_logic_smoke.py",
]


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


def audit_demo_assets(errors: list[str]) -> None:
    gitignore = read_text(".gitignore")
    if "!docs/assets/*.png" not in gitignore:
        fail(errors, ".gitignore must whitelist fixed README demo PNGs in docs/assets")

    readme = read_text("README.md")
    assets_dir = ROOT / "docs" / "assets"
    actual_pngs = sorted(str(path.relative_to(ROOT)) for path in assets_dir.glob("*.png")) if assets_dir.exists() else []
    for src in REQUIRED_DEMO_ASSETS:
        path = ROOT / src
        if not path.exists():
            fail(errors, f"required README demo asset is missing: {src}")
            continue
        try:
            width, height = png_size(path)
        except ValueError as exc:
            fail(errors, f"{src} is invalid: {exc}")
            continue
        if width < 320 or height < 500:
            fail(errors, f"{src} should be a mobile-sized PNG, got {width}x{height}")
        if src not in readme:
            fail(errors, f"README.md must reference demo asset: {src}")

    unexpected = [src for src in actual_pngs if src not in REQUIRED_DEMO_ASSETS]
    if unexpected:
        fail(errors, "docs/assets must contain only fixed demo PNGs: " + ", ".join(unexpected))


def audit_smoke_scripts(errors: list[str]) -> None:
    path = ROOT / "scripts" / "confirm_logic_smoke.py"
    if not path.exists():
        fail(errors, "scripts/confirm_logic_smoke.py is missing")
        return
    text = path.read_text(encoding="utf-8")
    if "subprocess.run" not in text or '"node"' not in text:
        fail(errors, "confirm_logic_smoke.py must execute the real inline JS through node")
    if "__TIMELOG_TEST__" not in text or "__timelogTest" not in text:
        fail(errors, "confirm_logic_smoke.py must use the guarded index.html test API")


def button_attrs(tag: str) -> str:
    return tag.split(">", 1)[0]


def audit_index(errors: list[str]) -> None:
    html = read_text("index.html")
    if "title=" in html:
        fail(errors, "index.html must not use native title= tooltips")
    if not re.search(r"button\[data-tip\]:hover::after,\s*\n\s*button\[data-tip\]:hover::before\s*\{[^}]*transition-delay:\s*" + re.escape(EXPECTED_TOOLTIP_DELAY), html, re.DOTALL):
        fail(errors, f"desktop hover tooltip must use a {EXPECTED_TOOLTIP_DELAY} show delay")
    if not re.search(r"button\[data-tip\]:focus-visible::after,\s*\n\s*button\[data-tip\]:focus-visible::before\s*\{[^}]*transition-delay:\s*0s", html, re.DOTALL):
        fail(errors, "keyboard focus-visible tooltip must show without delay")
    if "window.__timelogTest" not in html or "window.__TIMELOG_TEST__" not in html:
        fail(errors, "index.html must expose test API only behind window.__TIMELOG_TEST__")
    if not re.search(r"if\s*\(\s*window\.__TIMELOG_TEST__\s*\)\s*\{\s*exposeTestApi\(\);", html):
        fail(errors, "index.html test API must be guarded by window.__TIMELOG_TEST__")
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
    if open_form and "openFormSheet({ mode: 'new' })" not in open_form.group("body"):
        fail(errors, "opening the add form must use the unified form sheet")
    if "--footer-space" in html:
        fail(errors, "footer must stay in document flow; do not restore manual --footer-space padding")
    if not re.search(r"\.footer\s*\{[^}]*position:\s*sticky", html, re.DOTALL):
        fail(errors, "footer must use sticky positioning in document flow")
    if not re.search(r"\.view-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)", html, re.DOTALL):
        fail(errors, "view tabs must use a stable four-column grid")
    if "container-type: inline-size" not in html or "@container (max-width: 390px)" not in html:
        fail(errors, "header/footer responsive behavior must be protected by container queries")
    if "@media (min-width: 720px) and (pointer:" in html:
        fail(errors, "form sheet layout must be width-driven, not pointer-driven")
    picker = re.search(r"function\s+useCompactTimePicker\(\)\s*\{(?P<body>.*?)\n\s*\}", html, re.DOTALL)
    if not picker or "clientWidth < 720" not in picker.group("body") or "pointer" in picker.group("body"):
        fail(errors, "time picker mode must be width-driven and remount across the 720px breakpoint")


def audit_docs(errors: list[str]) -> None:
    doc_names = ["README.md", "CLAUDE.md", "使用与理念.md"]
    docs = {name: read_text(name) for name in doc_names}
    combined = "\n".join(docs.values())

    for forbidden in ("威泰", "不做跨天汇总报表", "不能跨天汇总报表"):
        if forbidden in combined:
            fail(errors, f"documentation must not contain stale/private phrase: {forbidden}")

    readme = docs["README.md"]
    for command in REQUIRED_MAINTENANCE_COMMANDS:
        if command not in readme:
            fail(errors, f"README.md must document maintenance command: {command}")

    claude = docs["CLAUDE.md"]
    required_claude_phrases = [
        f"timelog-v{EXPECTED_VERSION}",
        "禁止 `title=`",
        f"tooltip hover 延迟 {EXPECTED_TOOLTIP_DELAY}",
        "删除/取消禁用 x",
        "输入字号不低于 16px",
        "运行时资产必须进 SW 缓存",
        "公开仓库不得含真实记录/真实截图/具体个人线索",
        "README 演示图只能来自 `docs/assets/` 的固定 demo 数据 PNG",
        f"| v{EXPECTED_VERSION} |",
    ]
    for phrase in required_claude_phrases:
        if phrase not in claude:
            fail(errors, f"CLAUDE.md is missing maintenance rule/changelog phrase: {phrase}")
    for command in REQUIRED_MAINTENANCE_COMMANDS:
        if command not in claude:
            fail(errors, f"CLAUDE.md must document maintenance command: {command}")


def main() -> int:
    errors: list[str] = []
    audit_manifest(errors)
    audit_service_worker(errors)
    audit_demo_assets(errors)
    audit_smoke_scripts(errors)
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
