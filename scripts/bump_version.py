#!/usr/bin/env python3
"""One-shot version-ceremony bump for Time Logger.

Rewrites the six version anchors atomically (all validated before any write):

  1. sw.js                     const CACHE = 'timelog-vN.N.N';
  2. manifest.webmanifest      "version": "N.N.N",
  3. src/ui.js                 export const APP_VERSION = 'N.N.N';
  4. scripts/project_audit.py  EXPECTED_VERSION = "N.N.N"
  5. CLAUDE.md                 当前版本：`timelog-vN.N.N` / manifest `version: "N.N.N"`。
  6. README.md                 > Release: vN.N.N

版本自 v1.0.0 起是三段式 `MAJOR.MINOR.PATCH`（此前是单整数 v1–v93）。

**不由本脚本处理的第七个锚点**：`project_audit.py` 还断言 CLAUDE.md 含
`| vN.N.N |` 这行 CHANGELOG 行。它是内容判断（要写这一版做了什么），所以留给
手工——但它同样是硬判据，漏了 audit 会红。

Usage:
  python3 scripts/bump_version.py 1.0.1       # bump to explicit version
  python3 scripts/bump_version.py --patch     # 1.0.0 -> 1.0.1
  python3 scripts/bump_version.py --minor     # 1.0.1 -> 1.1.0
  python3 scripts/bump_version.py --major     # 1.1.0 -> 2.0.0
  python3 scripts/bump_version.py 1.0.1 --dry-run

The script refuses to touch anything if the anchors disagree with each other,
match zero times, or match more than once — a v59-class drift must be fixed by
hand first so the ceremony never papers over an inconsistent tree.

NOT handled here (content decisions, do them by hand after the bump):
  - CLAUDE.md CHANGELOG row for the new version
  - sw.js FILES list when runtime assets were added/removed
  - docs wording; then run scripts/project_audit.py before committing
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# path -> list of regexes; every regex must match exactly once and every
# captured group must equal the current version before any file is written.
V = r"\d+\.\d+\.\d+"
ANCHORS: dict[str, list[str]] = {
    "sw.js": [rf"const CACHE = 'timelog-v({V})';"],
    "manifest.webmanifest": [rf'"version": "({V})",'],
    "src/ui.js": [rf"export const APP_VERSION = '({V})';"],
    "scripts/project_audit.py": [rf'EXPECTED_VERSION = "({V})"'],
    "CLAUDE.md": [rf"当前版本：`timelog-v({V})` / manifest `version: \"({V})\"`。"],
    "README.md": [rf"> Release: v({V})"],
}


def fail(msg: str) -> "int":
    print(f"bump_version: {msg}", file=sys.stderr)
    return 1


def parse(version: str) -> tuple[int, int, int]:
    major, minor, patch = version.split(".")
    return int(major), int(minor), int(patch)


def main(argv: list[str]) -> int:
    args = [a for a in argv if a != "--dry-run"]
    dry_run = "--dry-run" in argv
    if len(args) != 1:
        return fail("usage: bump_version.py <N.N.N|--patch|--minor|--major> [--dry-run]")

    texts: dict[str, str] = {}
    versions: set[str] = set()
    for rel, patterns in ANCHORS.items():
        path = ROOT / rel
        if not path.is_file():
            return fail(f"missing file: {rel}")
        text = path.read_text(encoding="utf-8")
        texts[rel] = text
        for pattern in patterns:
            matches = re.findall(pattern, text)
            if len(matches) != 1:
                return fail(
                    f"{rel}: pattern {pattern!r} matched {len(matches)} times "
                    "(expected exactly 1) — fix the drift by hand first"
                )
            found = matches[0] if isinstance(matches[0], tuple) else (matches[0],)
            versions.update(found)

    if len(versions) != 1:
        return fail(f"anchors disagree: found versions {sorted(versions)} — fix by hand first")
    current = versions.pop()

    major, minor, patch = parse(current)
    if args[0] == "--patch":
        target = f"{major}.{minor}.{patch + 1}"
    elif args[0] == "--minor":
        target = f"{major}.{minor + 1}.0"
    elif args[0] == "--major":
        target = f"{major + 1}.0.0"
    elif re.fullmatch(V, args[0]):
        target = args[0]
    else:
        return fail(
            f"target must be N.N.N or --patch/--minor/--major, got {args[0]!r}"
        )
    # 按元组比大小，不按整数：`int("1.0.1")` 会抛 ValueError，而按字符串比会让
    # 1.0.10 排在 1.0.9 之前。
    if parse(target) <= parse(current):
        return fail(f"target v{target} must be greater than current v{current}")

    for rel, patterns in ANCHORS.items():
        updated = texts[rel]
        for pattern in patterns:
            updated = re.sub(
                pattern,
                lambda m: m.group(0).replace(current, target),
                updated,
                count=1,
            )
        if dry_run:
            print(f"would update {rel}")
        else:
            (ROOT / rel).write_text(updated, encoding="utf-8")
            print(f"updated {rel}")

    print(f"{'DRY RUN: ' if dry_run else ''}v{current} -> v{target}")
    print("manual follow-ups: CLAUDE.md CHANGELOG row; sw.js FILES if assets changed;")
    print("then run: python3 scripts/project_audit.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
