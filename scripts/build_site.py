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

脚本先核对全部输入与目标归属，再清空已识别镜像中的受管路径；保留 .git 与
README.md。源码祖先/后代、陌生目录及符号链接输出会被拒绝；新目标请使用空目录。
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
from project_audit import REQUIRED_DEMO_ASSETS  # noqa: E402  单一真源，避免与 audit 白名单漂移

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
CUSTOM_DOMAIN = "time.eigentime.org"
# 部署镜像里不归本脚本管理、清理时必须保留的路径。
PRESERVED = {".git", "README.md"}
# Only these top-level paths belong to this assembler. Unknown files are never
# silently removed, even if --out accidentally points at another project.
MANAGED = {"app", "assets", "index.html", "en", "privacy", "support", "CNAME", ".nojekyll"}


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
        rel = entry[2:]
        path = PurePosixPath(rel)
        if not rel or path.is_absolute() or str(path) != rel or "\\" in rel or any(part.startswith('.') for part in path.parts):
            raise SystemExit(f"build_site: unsafe FILES entry: {entry}")
        files.append(rel)
    if "index.html" not in files or "sw.js" not in files:
        raise SystemExit("build_site: FILES parse looks wrong (missing index.html/sw.js)")
    return files


def check_out_dir(out: Path) -> None:
    if out.is_symlink():
        raise SystemExit("build_site: --out must not be a symbolic link")
    resolved = out.resolve()
    source = ROOT.resolve()
    if resolved == source or source in resolved.parents or resolved in source.parents:
        raise SystemExit("build_site: --out must be outside this repository and cannot be its ancestor")
    if not out.exists():
        return
    if not out.is_dir():
        raise SystemExit("build_site: --out must be a directory")
    children = list(out.iterdir())
    unknown = [p.name for p in children if p.name not in PRESERVED | MANAGED]
    if unknown:
        raise SystemExit("build_site: refusing to remove unmanaged output paths: " + ", ".join(sorted(unknown)))
    managed = [p for p in children if p.name in MANAGED]
    if any(p.is_symlink() for p in managed):
        raise SystemExit("build_site: output paths must not be symbolic links")
    # Empty/new mirror checkouts (.git + optional README) are safe. An existing
    # output must carry our established deployment markers before cleanup.
    if managed:
        marker = out / '.nojekyll'
        manifest = out / 'app' / 'manifest.webmanifest'
        cname = out / 'CNAME'
        if not marker.is_file() or not manifest.is_file() or (cname.exists() and cname.read_text().strip() != CUSTOM_DOMAIN):
            raise SystemExit("build_site: existing output is not a time-logger deployment mirror")


def clean_managed(out: Path) -> None:
    check_out_dir(out)
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


def check_source(path: Path) -> None:
    if not path.is_file() or path.is_symlink() or ROOT.resolve() not in path.resolve().parents:
        raise SystemExit(f"build_site: missing or unsafe source file: {path.relative_to(ROOT)}")


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

    site_files = [p for p in sorted(SITE_DIR.rglob("*")) if p.is_file()]
    # SPEC-005：主页截图只能引用 docs/assets/ 白名单里的固定 demo PNG（同一批 README
    # 已在用的图），复制而不是让 site/ 目录本身持有 PNG——.gitignore 的白名单机制不变。
    demo_assets = [ROOT / rel for rel in REQUIRED_DEMO_ASSETS]
    missing_demo = [str(p) for p in demo_assets if not p.exists()]
    if missing_demo:
        raise SystemExit("build_site: missing required demo asset(s): " + ", ".join(missing_demo))
    # Preflight every source before deleting anything in the previous output.
    for path in [ROOT / rel for rel in runtime_files] + site_files + demo_assets:
        check_source(path)
    if any(p.is_symlink() for p in SITE_DIR.rglob('*')):
        raise SystemExit("build_site: site sources must not contain symbolic links")
    if any(p.relative_to(SITE_DIR).parts[0] not in MANAGED - {'app', 'assets', 'CNAME', '.nojekyll'} for p in site_files):
        raise SystemExit("build_site: site contains an unmanaged top-level path")

    clean_managed(out)

    for rel in runtime_files:
        copy_file(ROOT / rel, out / "app" / rel)
    for path in site_files:
        copy_file(path, out / path.relative_to(SITE_DIR))
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
