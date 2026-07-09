#!/usr/bin/env python3
"""Project red-line audit for Time Logger."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "46"
EXPECTED_TOOLTIP_DELAY = "800ms"
REQUIRED_RUNTIME_ASSETS = [
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "sw.js",
    "src/app.js",
    "src/entry_model.js",
    "src/io_actions.js",
    "src/sheet_controller.js",
    "src/time.js",
    "src/storage.js",
    "src/stats.js",
    "src/pickers.js",
    "src/ui.js",
    "icon.svg",
]
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
    "npm run test:ui",
    "git diff --check",
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

    for src in ["./" + src for src in [*REQUIRED_RUNTIME_ASSETS, *REQUIRED_ICON_SIZES]]:
        if src not in sw:
            fail(errors, f"sw.js FILES must cache runtime asset {src}")


def audit_app_version_string(errors: list[str]) -> None:
    # 更多 sheet 底部展示的版本号（真机核对用）必须与 CACHE/manifest 同步。
    ui = read_text("src/ui.js")
    match = re.search(r"const\s+APP_VERSION\s*=\s*['\"](\d+)['\"]", ui)
    if not match:
        fail(errors, "src/ui.js must declare APP_VERSION = 'N'")
    elif match.group(1) != EXPECTED_VERSION:
        fail(errors, f"src/ui.js APP_VERSION must be {EXPECTED_VERSION!r}")


def audit_demo_assets(errors: list[str]) -> None:
    gitignore = read_text(".gitignore")
    if "!docs/assets/*.png" not in gitignore:
        fail(errors, ".gitignore must whitelist fixed README demo PNGs in docs/assets")

    readme = read_text("README.md")
    assets_dir = ROOT / "docs" / "assets"
    actual_pngs = sorted(path.relative_to(ROOT).as_posix() for path in assets_dir.glob("*.png")) if assets_dir.exists() else []
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
    if "subprocess.run" not in text or '"node"' not in text or "--input-type=module" not in text:
        fail(errors, "confirm_logic_smoke.py must execute real ES modules through node")
    if "from './src/stats.js'" not in text:
        fail(errors, "confirm_logic_smoke.py must import the real stats module")


def audit_npm_metadata(errors: list[str]) -> None:
    try:
        package = json.loads(read_text("package.json"))
    except FileNotFoundError:
        fail(errors, "package.json is missing for development UI smoke")
        return
    except json.JSONDecodeError as exc:
        fail(errors, f"package.json is not valid JSON: {exc}")
        return

    if package.get("private") is not True:
        fail(errors, "package.json must keep private: true")
    if package.get("type") != "module":
        fail(errors, "package.json must declare type: module for native ES module tooling")
    if package.get("dependencies"):
        fail(errors, "package.json must not declare runtime dependencies")
    scripts = package.get("scripts") if isinstance(package.get("scripts"), dict) else {}
    if scripts.get("test:ui") != "playwright test":
        fail(errors, "package.json must keep test:ui = playwright test")
    dev_deps = package.get("devDependencies") if isinstance(package.get("devDependencies"), dict) else {}
    if "@playwright/test" not in dev_deps:
        fail(errors, "package.json must keep @playwright/test as a dev dependency for UI smoke")
    if not (ROOT / "package-lock.json").exists():
        fail(errors, "package-lock.json must be committed when development npm dependencies exist")

    gitignore = read_text(".gitignore")
    for ignored in ("node_modules/", "test-results/", "playwright-report/"):
        if ignored not in gitignore:
            fail(errors, f".gitignore must ignore generated development artifact: {ignored}")


def audit_runtime_imports(errors: list[str]) -> None:
    import_re = re.compile(r"(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]+?\s+from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]")
    for rel in (
        "src/app.js",
        "src/entry_model.js",
        "src/io_actions.js",
        "src/sheet_controller.js",
        "src/time.js",
        "src/storage.js",
        "src/stats.js",
        "src/pickers.js",
        "src/ui.js",
    ):
        text = read_text(rel)
        for match in import_re.finditer(text):
            spec = match.group(1)
            if not spec.startswith(("./", "../")):
                fail(errors, f"{rel} must not import runtime npm/bare module: {spec}")


def button_attrs(tag: str) -> str:
    return tag.split(">", 1)[0]


def audit_index(errors: list[str]) -> None:
    html = read_text("index.html")
    css = read_text("styles.css")
    app = read_text("src/app.js")
    entry_model = read_text("src/entry_model.js")
    io_actions = read_text("src/io_actions.js")
    sheet_controller = read_text("src/sheet_controller.js")
    ui = read_text("src/ui.js")
    pickers = read_text("src/pickers.js")
    runtime = "\n".join([html, css, app, entry_model, io_actions, sheet_controller, ui, pickers])

    if "title=" in runtime:
        fail(errors, "runtime files must not use native title= tooltips")
    if '<link rel="stylesheet" href="styles.css">' not in html:
        fail(errors, "index.html must load styles.css")
    if '<script type="module" src="src/app.js"></script>' not in html:
        fail(errors, "index.html must use src/app.js as the native module entry")
    if "<style>" in html:
        fail(errors, "index.html must not contain inline style blocks")
    for match in re.finditer(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", html, re.DOTALL):
        attrs = match.group("attrs")
        body = match.group("body").strip()
        if 'type="module"' in attrs and 'src="src/app.js"' in attrs and not body:
            continue
        if "timelog.theme" in body and "document.documentElement.setAttribute" in body:
            continue
        if "timelog.v1" in body and "data-boot" in body:
            continue
        fail(errors, "index.html may only contain the app module script and the early theme script")

    if not re.search(r"button\[data-tip\]:hover::after,\s*\n\s*button\[data-tip\]:hover::before\s*\{[^}]*transition-delay:\s*" + re.escape(EXPECTED_TOOLTIP_DELAY), css, re.DOTALL):
        fail(errors, f"desktop hover tooltip must use a {EXPECTED_TOOLTIP_DELAY} show delay")
    if not re.search(r"button\[data-tip\]:focus-visible::after,\s*\n\s*button\[data-tip\]:focus-visible::before\s*\{[^}]*transition-delay:\s*0s", css, re.DOTALL):
        fail(errors, "keyboard focus-visible tooltip must show without delay")
    if "window.__timelogTest" not in app or "window.__TIMELOG_TEST__" not in app:
        fail(errors, "src/app.js must expose test API only behind window.__TIMELOG_TEST__")
    if not re.search(r"if\s*\(\s*window\.__TIMELOG_TEST__\s*\)\s*\{\s*exposeTestApi\(\);", app):
        fail(errors, "src/app.js test API must be guarded by window.__TIMELOG_TEST__")
    if "iconSvg('x')" in runtime or re.search(r"^\s*x\s*:", ui, re.MULTILINE):
        fail(errors, "runtime files must not define or use the x icon")
    if re.search(r'data-action="start-edit"[^>]*>\s*改\s*</button>', runtime):
        fail(errors, "timeline edit action must be icon-only, not text 改")
    if re.search(r'data-action="delete-entry"[^>]*>\s*(?:✕|×|x)\s*</button>', runtime, re.IGNORECASE):
        fail(errors, "delete action must not use x/×/✕")
    if re.search(r'data-action="cancel-edit"[^>]*>\s*(?:✕|×|x)\s*</button>', runtime, re.IGNORECASE):
        fail(errors, "cancel edit action must not use x/×/✕")

    for match in re.finditer(r"<button\b[^>]*\bicon-btn\b[^>]*>", runtime):
        attrs = button_attrs(match.group(0))
        if "aria-label=" not in attrs:
            fail(errors, f"icon button is missing aria-label near byte {match.start()}")
        if "data-tip=" not in attrs:
            fail(errors, f"icon button is missing data-tip near byte {match.start()}")

    for tip in ("编辑计划", "删除计划", "标记为已发生"):
        if f'data-tip="{tip}"' not in runtime and f"'{tip}'" not in runtime:
            fail(errors, f"icon action tooltip is missing or not short: {tip}")

    if ".inp" not in css or "font-size: 16px" not in css:
        fail(errors, "text inputs must keep a 16px font-size floor for mobile")
    open_form = re.search(r"function\s+openForm\(\)\s*\{(?P<body>.*?)\n\s*\}", runtime, re.DOTALL)
    if open_form and "openFormSheet({ mode: 'new' })" not in open_form.group("body"):
        fail(errors, "opening the add form must use the unified form sheet")
    # v34: footer retired — low-frequency actions live in the header ··· more sheet.
    if 'class="footer"' in html or re.search(r"\n\s*\.footer\s*\{", css):
        fail(errors, "footer is retired in v34; do not reintroduce a sticky footer")
    if 'data-action="open-more"' not in html:
        fail(errors, "header must expose the ··· more-sheet entry (open-more)")
    if not re.search(r"\.view-tabs\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)", css, re.DOTALL):
        fail(errors, "view tabs must use a stable four-column grid")
    if "container-type: inline-size" not in css or "@container (max-width: 390px)" not in css:
        fail(errors, "header/footer responsive behavior must be protected by container queries")
    if "@media (min-width: 720px) and (pointer:" in css:
        fail(errors, "form sheet layout must be width-driven, not pointer-driven")
    picker = re.search(r"function\s+useCompactTimePicker\(\)\s*\{(?P<body>.*?)\n\s*\}", pickers, re.DOTALL)
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
        "模块边界",
        "提交与推送前红线",
        "禁止新增 `dependencies`",
        "运行时文件禁止从 npm 包导入代码",
        "package-lock.json",
        "禁止 `title=`",
        f"tooltip hover 延迟 {EXPECTED_TOOLTIP_DELAY}",
        "删除/取消禁用 x",
        "输入字号不低于 16px",
        "运行时资产必须进 SW 缓存",
        "必须创建或更新同版本 GitHub Release",
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
    audit_app_version_string(errors)
    audit_demo_assets(errors)
    audit_smoke_scripts(errors)
    audit_npm_metadata(errors)
    audit_runtime_imports(errors)
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
