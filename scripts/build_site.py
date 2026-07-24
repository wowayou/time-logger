#!/usr/bin/env python3
# 时间尺 (time-logger)
# Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Assemble the time.eigentime.org deployment mirror (D12).

确定性组装，不是构建：不压缩、不转换、不改写任何字节。

- 运行时清单**直接解析 `sw.js` 的 FILES 数组**（单一真源，不另维护拷贝清单），
  逐文件复制到 `<out>/app/`；
- `site/` 产品主页源码复制到 `<out>/`（根目录）；
- 主页截图复用 `project_audit.py` 的 `REQUIRED_DEMO_ASSETS`（同一份 README 已用的
  固定 demo PNG，单一真源）复制到 `<out>/assets/`；`site/` 目录本身不持有 PNG；
- 写 `<out>/CNAME`（time.eigentime.org）与 `<out>/.nojekyll`。

输出目录必须显式指定且**不得位于本仓库内**——本仓库红线不新增产物目录。
典型用法（部署镜像检出在旁边时）：

    python3 scripts/build_site.py --out ../time-logger-site

脚本会先清空输出目录中由它管理的路径（app/、根级主页文件、CNAME、.nojekyll），
保留 .git 与 README.md，保证重复运行结果一致。
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from project_audit import REQUIRED_DEMO_ASSETS  # noqa: E402  单一真源，避免与 audit 白名单漂移

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
CUSTOM_DOMAIN = "time.eigentime.org"
# 部署镜像里不归本脚本管理、清理时必须保留的路径。
PRESERVED = {".git", "README.md"}


def parse_sw_files() -> list[str]:
    """Parse the FILES array out of sw.js (single source of truth)."""
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    match = re.search(r"const\s+FILES\s*=\s*\[(?P<body>.*?)\]", sw, re.DOTALL)
    if not match:
        raise SystemExit("build_site: cannot find FILES array in sw.js")
    entries = re.findall(r"['\"]([^'\"]+)['\"]", match.group("body"))
    files: list[str] = []
    for entry in entries:
        if entry == "./":
            continue  # 目录入口由 index.html 提供
        if not entry.startswith("./"):
            raise SystemExit(f"build_site: unexpected non-relative FILES entry: {entry}")
        files.append(entry[2:])
    if "index.html" not in files or "sw.js" not in files:
        raise SystemExit("build_site: FILES parse looks wrong (missing index.html/sw.js)")
    return files


def check_out_dir(out: Path) -> None:
    resolved = out.resolve()
    if resolved == ROOT.resolve() or ROOT.resolve() in resolved.parents:
        raise SystemExit("build_site: --out must be outside this repository (no artifact dirs in repo)")


def clean_managed(out: Path) -> None:
    if not out.exists():
        out.mkdir(parents=True)
        return
    for child in out.iterdir():
        if child.name in PRESERVED:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def copy_file(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def main() -> int:
    parser = argparse.ArgumentParser(description="Assemble the time.eigentime.org deployment mirror")
    parser.add_argument("--out", required=True, help="output directory (must be outside this repo)")
    parser.add_argument(
        "--no-cname",
        action="store_true",
        help="omit the CNAME file (pre-launch verification only: a CNAME in the published "
        "branch makes GitHub Pages bind the custom domain immediately)",
    )
    args = parser.parse_args()

    out = Path(args.out)
    check_out_dir(out)

    runtime_files = parse_sw_files()
    missing = [rel for rel in runtime_files if not (ROOT / rel).exists()]
    if missing:
        raise SystemExit("build_site: sw.js FILES references missing files: " + ", ".join(missing))
    if not SITE_DIR.is_dir() or not (SITE_DIR / "index.html").exists():
        raise SystemExit("build_site: site/index.html (product homepage) is missing")

    clean_managed(out)

    for rel in runtime_files:
        copy_file(ROOT / rel, out / "app" / rel)
    site_files = [p for p in sorted(SITE_DIR.rglob("*")) if p.is_file()]
    for path in site_files:
        copy_file(path, out / path.relative_to(SITE_DIR))
    # SPEC-005：主页截图只能引用 docs/assets/ 白名单里的固定 demo PNG（同一批 README
    # 已在用的图），复制而不是让 site/ 目录本身持有 PNG——.gitignore 的白名单机制不变。
    demo_assets = [ROOT / rel for rel in REQUIRED_DEMO_ASSETS]
    missing_demo = [str(p) for p in demo_assets if not p.exists()]
    if missing_demo:
        raise SystemExit("build_site: missing required demo asset(s): " + ", ".join(missing_demo))
    for path in demo_assets:
        copy_file(path, out / "assets" / path.name)
    if args.no_cname:
        cname_note = "omitted (--no-cname, pre-launch verification)"
    else:
        (out / "CNAME").write_text(CUSTOM_DOMAIN + "\n", encoding="utf-8")
        cname_note = CUSTOM_DOMAIN
    (out / ".nojekyll").write_text("", encoding="utf-8")

    print(f"build_site: {len(runtime_files)} runtime files -> {out / 'app'}")
    print(f"build_site: {len(site_files)} homepage files -> {out}")
    print(f"build_site: {len(demo_assets)} demo assets -> {out / 'assets'}")
    print(f"build_site: CNAME={cname_note}, .nojekyll written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
