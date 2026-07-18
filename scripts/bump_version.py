#!/usr/bin/env python3
"""One-shot version-ceremony bump for Time Logger.

Rewrites the six version anchors atomically (all validated before any write):

  1. sw.js                     const CACHE = 'timelog-vN';
  2. manifest.webmanifest      "version": "N",
  3. src/ui.js                 export const APP_VERSION = 'N';
  4. scripts/project_audit.py  EXPECTED_VERSION = "N"
  5. CLAUDE.md                 当前版本：`timelog-vN` / manifest `version: "N"`。
  6. README.md                 > Release: vN

Usage:
  python3 scripts/bump_version.py 67          # bump to explicit version
  python3 scripts/bump_version.py --next      # current + 1
  python3 scripts/bump_version.py 67 --dry-run

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
ANCHORS: dict[str, list[str]] = {
    "sw.js": [r"const CACHE = 'timelog-v(\d+)';"],
    "manifest.webmanifest": [r'"version": "(\d+)",'],
    "src/ui.js": [r"export const APP_VERSION = '(\d+)';"],
    "scripts/project_audit.py": [r'EXPECTED_VERSION = "(\d+)"'],
    "CLAUDE.md": [r"当前版本：`timelog-v(\d+)` / manifest `version: \"(\d+)\"`。"],
    "README.md": [r"> Release: v(\d+)"],
}


def fail(msg: str) -> "int":
    print(f"bump_version: {msg}", file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    args = [a for a in argv if a != "--dry-run"]
    dry_run = "--dry-run" in argv
    if len(args) != 1:
        return fail("usage: bump_version.py <N|--next> [--dry-run]")

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

    if args[0] == "--next":
        target = str(int(current) + 1)
    elif re.fullmatch(r"\d+", args[0]):
        target = args[0]
    else:
        return fail(f"target must be a number or --next, got {args[0]!r}")
    if int(target) <= int(current):
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
