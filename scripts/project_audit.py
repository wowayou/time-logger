#!/usr/bin/env python3
"""Project red-line audit for Time Logger."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VERSION = "76"
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
    "icons/splash-750x1334.png": (750, 1334),
}
REQUIRED_DEMO_ASSETS = [
    "docs/assets/demo-mobile-timeline.png",
    "docs/assets/demo-mobile-edit-drawer.png",
]
# 图标原型评审渲染存档：只含合成图标，不含任何真实记录，README 不引用。
# 显式列文件名而不是 icon-proto-*.png 通配：通配会让任何叫这个前缀的新 PNG
# （包括误传的真实截图）自动过闸，显式清单保住存档又不降低护栏强度。
ALLOWED_DOC_ASSETS = [
    "docs/assets/icon-proto-gallery.png",
    "docs/assets/icon-proto-gallery2.png",
    "docs/assets/icon-proto-verify.png",
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

    required_reliability_guards = {
        "c.addAll(FILES)": "install must reject when precaching fails",
        "self.clients.claim()": "activate must wait for clients.claim()",
        "e.request.method !== 'GET'": "fetch handler must ignore non-GET requests",
        "url.origin !== self.location.origin": "fetch handler must ignore cross-origin requests",
    }
    for fragment, message in required_reliability_guards.items():
        if fragment not in sw:
            fail(errors, f"service worker reliability guard missing: {message}")


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

    allowed = {*REQUIRED_DEMO_ASSETS, *ALLOWED_DOC_ASSETS}
    unexpected = [src for src in actual_pngs if src not in allowed]
    if unexpected:
        fail(errors, "docs/assets must contain only fixed demo PNGs or archived icon-proto renders: " + ", ".join(unexpected))


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
        if "timelog.bootSnapshot.v1" in body and "boot-restored" in body:
            continue
        if "serviceWorker" in body and "register('sw.js')" in body:
            continue
        fail(errors, "index.html may only contain the app module script and approved early boot scripts")

    if not re.search(r"button\[data-tip\]:hover::after,\s*\n\s*button\[data-tip\]:hover::before\s*\{[^}]*transition-delay:\s*" + re.escape(EXPECTED_TOOLTIP_DELAY), css, re.DOTALL):
        fail(errors, f"desktop hover tooltip must use a {EXPECTED_TOOLTIP_DELAY} show delay")
    if not re.search(r"button\[data-tip\]:focus-visible::after,\s*\n\s*button\[data-tip\]:focus-visible::before\s*\{[^}]*transition-delay:\s*0s", css, re.DOTALL):
        fail(errors, "keyboard focus-visible tooltip must show without delay")
    if "window.__timelogTest" in app or "window.__TIMELOG_TEST__" in app:
        fail(errors, "src/app.js must not carry a test-only runtime branch")
    if re.search(r"\b(?:alert|confirm|prompt)\(", app + io_actions):
        fail(errors, "runtime files must not use native alert/confirm/prompt dialogs (SPEC-006)")
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

    # v48：日视图点卡编辑、触摸左滑揭示双操作轨道；计划确认与 FAB 入口仍须存在。
    if 'aria-label="标记计划为已发生"' not in runtime:
        fail(errors, "planned card must keep the confirm-as-happened action")
    if 'id="add-btn"' not in html or 'data-action="open-form"' not in html:
        fail(errors, "day-view record entry (FAB #add-btn / open-form) must exist")
    for required in ('data-action="start-edit"', 'data-action="request-delete"', 'class="swipe-actions"'):
        if required not in runtime:
            fail(errors, f"v48 swipe/edit action contract is missing: {required}")
    for required in ("planIntervalEdit", "planSegmentSplit", "planDeleteEntry"):
        if required not in runtime:
            fail(errors, f"v48 transactional interval model is missing: {required}")
    if 'id="backup-send-btn"' not in runtime or 'data-action="send-backup"' not in runtime:
        fail(errors, "share backup cell must stay unconditionally renderable")

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


WCAG_MIN_CONTRAST = 4.5
WCAG_TEXT_TOKENS = ("--text", "--muted", "--faint", "--danger")
# v76: --chrome (view-tabs unselected state / date-nav buttons' shell surface,
# SPEC "控件表面分层修正") joins the guarded surface set — it now carries real
# text (button labels), so it must clear the same 4.5:1 bar as --bg/--card/--input.
WCAG_SURFACE_TOKENS = ("--bg", "--card", "--input", "--chrome")


def _srgb_to_linear(channel: float) -> float:
    c = channel / 255.0
    if c <= 0.03928:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _relative_luminance(hex_color: str) -> float:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    rl, gl, bl = (_srgb_to_linear(v) for v in (r, g, b))
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl


def _contrast_ratio(hex_a: str, hex_b: str) -> float:
    la, lb = _relative_luminance(hex_a), _relative_luminance(hex_b)
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def _extract_theme_tokens(css: str, selector_pattern: str) -> dict[str, str]:
    """Pull hex-color custom properties out of one `html[data-theme=...]` block."""
    block_match = re.search(selector_pattern + r"\s*\{(?P<body>.*?)\n\s*\}", css, re.DOTALL)
    if not block_match:
        return {}
    body = block_match.group("body")
    tokens: dict[str, str] = {}
    for name in (*WCAG_TEXT_TOKENS, *WCAG_SURFACE_TOKENS):
        token_match = re.search(re.escape(name) + r":\s*(#[0-9a-fA-F]{6})\s*;", body)
        if token_match:
            tokens[name] = token_match.group(1)
    return tokens


def compute_theme_contrast_report(css: str) -> dict[str, dict[str, float]]:
    """Returns {theme: {"text_token vs surface_token": ratio}} for light and dark."""
    report: dict[str, dict[str, float]] = {}
    for theme, pattern in (
        ("light", r'html\[data-theme="light"\]'),
        ("dark", r'html\[data-theme="dark"\]'),
    ):
        tokens = _extract_theme_tokens(css, pattern)
        pairs: dict[str, float] = {}
        for text_token in WCAG_TEXT_TOKENS:
            if text_token not in tokens:
                continue
            for surface_token in WCAG_SURFACE_TOKENS:
                if surface_token not in tokens:
                    continue
                ratio = _contrast_ratio(tokens[text_token], tokens[surface_token])
                pairs[f"{text_token} vs {surface_token}"] = ratio
        report[theme] = pairs
    return report


def audit_wcag_contrast(errors: list[str]) -> None:
    """Permanent guard (SPEC-010, v75): text tokens (--text/--muted/--faint/--danger)
    must clear 4.5:1 contrast against every surface token (--bg/--card/--input), in
    both themes. Both themes are gated because both currently pass every pair (see
    docs/CHANGELOG.md v75 entry for the full number table, computed with the same
    stdlib WCAG relative-luminance formula used here). If a future token change
    regresses either theme below 4.5:1, this audit is meant to fail loudly — do not
    raise WCAG_MIN_CONTRAST or silently drop a pair to make it pass again; fix the
    token instead."""
    css = read_text("styles.css")
    report = compute_theme_contrast_report(css)

    for theme in ("light", "dark"):
        pairs = report.get(theme, {})
        if not pairs:
            fail(errors, f"could not parse {theme} theme tokens for WCAG contrast audit")
            continue
        for pair, ratio in pairs.items():
            if ratio < WCAG_MIN_CONTRAST:
                fail(errors, f"WCAG contrast below {WCAG_MIN_CONTRAST}:1 in {theme} theme: {pair} = {ratio:.2f}")

    # 着陆页维护着自己的一套内联令牌（site/index.html 单文件），与应用令牌无共享。
    # v75 的验收恰好抓到这个盲区：应用侧 --bg 下沉后，site 只同步了 --bg 没同步
    # --faint，13px 小字（.cta-sub/.usage-note/页脚）对比度落到 3.94。公开主页与
    # 应用同等受这条护栏约束，否则同样的漂移会在下一次改亮色时重演。
    site_tokens = _extract_theme_tokens(
        read_text("site/index.html"),
        r"@media \(prefers-color-scheme: light\)\s*\{\s*:root",
    )
    if not site_tokens:
        fail(errors, "could not parse site/index.html light tokens for WCAG contrast audit")
    for text_token in WCAG_TEXT_TOKENS:
        if text_token not in site_tokens:
            continue
        for surface_token in WCAG_SURFACE_TOKENS:
            if surface_token not in site_tokens:
                continue
            ratio = _contrast_ratio(site_tokens[text_token], site_tokens[surface_token])
            if ratio < WCAG_MIN_CONTRAST:
                fail(errors, f"WCAG contrast below {WCAG_MIN_CONTRAST}:1 in site/index.html light theme: {text_token} vs {surface_token} = {ratio:.2f}")


def audit_chrome_surface_layering(errors: list[str]) -> None:
    """Permanent guard (v76, control-surface layering fix): in the light theme,
    --chrome (the view-tabs/date-nav "shell" surface) must be strictly brighter
    than --bg (the page). That's the whole point of splitting --chrome out of
    --input — the light theme's --input (#e2e5ea) was *darker* than --bg
    (#eceef3), which made the top two control bands look heavier than the
    white content cards below them. If a future token edit lets --chrome sink
    back to --bg-or-darker, this must fail loudly rather than silently
    reintroduce the inversion. Dark theme is exempt on purpose: --chrome
    intentionally equals dark --input there (already brighter than dark --bg,
    zero visual change requested), so there's nothing new to invert."""
    css = read_text("styles.css")
    tokens = _extract_theme_tokens(css, r'html\[data-theme="light"\]')
    if "--chrome" not in tokens or "--bg" not in tokens:
        fail(errors, "could not parse light --chrome/--bg for the chrome-surface layering audit")
        return
    chrome_lum = _relative_luminance(tokens["--chrome"])
    bg_lum = _relative_luminance(tokens["--bg"])
    if chrome_lum <= bg_lum:
        fail(
            errors,
            f"light --chrome ({tokens['--chrome']}, luminance {chrome_lum:.4f}) is not brighter than "
            f"--bg ({tokens['--bg']}, luminance {bg_lum:.4f}) — control-surface layering inverted again",
        )


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
    audit_wcag_contrast(errors)
    audit_chrome_surface_layering(errors)

    if errors:
        print("project audit failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("project audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
