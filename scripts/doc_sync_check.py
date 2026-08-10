#!/usr/bin/env python3
# 时间尺 (time-logger)
# Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
# SPDX-License-Identifier: AGPL-3.0-or-later
"""改动与文档的同步闸（开发期工具，不进运行时、不进 SW 缓存）。

**为什么闸在提交/推送这两个时刻**（时机分析，别挪）：

- 每次 Edit/Write 之后就提醒 → 太早也太吵。一次改动往往横跨多个文件，中途的形态
  不是最终形态，那时写文档只会写错再改。
- 会话结束时提醒 → 太晚。那时改动已经进了历史，补文档要另开一个提交。
- **`git commit` 之前** → 改动已定形、还没进历史，是唯一既知道最终形态、又来得及
  把文档一起 stage 的时刻。本仓库的版本仪式本来就是「按提交」结算的。
- **`git push` 之前** → 第二道网。专抓「提交时忘了、后来也没补」的那一类，赶在
  它变成公开事实之前。

判据全部来自 CLAUDE.md 已有的红线，不新增规矩：

1. **拦**：暂存区里有运行时文件，却没有 `CLAUDE.md`。运行时一改就要走版本仪式
   （CHANGELOG 行 + 当前版本行），二者必然同批。
2. **提醒**：动了运行时或对外文案，却没动 `docs/HANDOFF.md`（接手须知会立刻过期）。
3. **提醒**：动了对外文案，而 README 的 `Updated:` 还停在今天之前。

只有第 1 条会拦下动作；其余是提醒，不打断。要强行提交，命令里带上
`--no-verify`（本闸会识别它并放行，理由自己写进提交信息）。
"""

from __future__ import annotations

import datetime
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# 运行时资产：改这些就必须走版本仪式（CLAUDE.md「当前版本」章节）。
RUNTIME_PREFIXES = ("src/", "icons/")
RUNTIME_FILES = {"index.html", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg"}
# 对外可见的文案面：改这些就该同步 README 的 Updated: 与交接文档。
PUBLIC_COPY_PREFIXES = ("site/", "src/locales/", "docs/promo/")
PUBLIC_COPY_FILES = {"README.md", "使用与理念.md", "CONTRIBUTING.md"}


def git(*args: str) -> list[str]:
    try:
        out = subprocess.run(["git", *args], cwd=ROOT, text=True,
                             capture_output=True, check=False)
    except OSError:
        return []
    if out.returncode != 0:
        return []
    return [line for line in out.stdout.splitlines() if line.strip()]


def classify(paths: list[str]) -> tuple[bool, bool]:
    runtime = any(p.startswith(RUNTIME_PREFIXES) or p in RUNTIME_FILES for p in paths)
    public = any(p.startswith(PUBLIC_COPY_PREFIXES) or p in PUBLIC_COPY_FILES for p in paths)
    return runtime, public


def readme_updated_is_today() -> bool:
    try:
        text = (ROOT / "README.md").read_text(encoding="utf-8")
    except OSError:
        return True
    match = re.search(r"^> Updated:\s*(\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
    if not match:
        return True
    return match.group(1) == datetime.date.today().isoformat()


def emit(deny_reason: str = "", notes: list[str] | None = None) -> None:
    payload: dict = {"hookSpecificOutput": {"hookEventName": "PreToolUse"}}
    if deny_reason:
        payload["hookSpecificOutput"]["permissionDecision"] = "deny"
        payload["hookSpecificOutput"]["permissionDecisionReason"] = deny_reason
    elif notes:
        payload["hookSpecificOutput"]["additionalContext"] = "\n".join(notes)
    else:
        return
    print(json.dumps(payload, ensure_ascii=False))


def main() -> int:
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0
    command = str((event.get("tool_input") or {}).get("command") or "")
    if "git " not in command or "--no-verify" in command:
        return 0

    committing = bool(re.search(r"\bgit\b(?!\s+(log|show|diff))[^|;&]*\bcommit\b", command))
    pushing = bool(re.search(r"\bgit\b[^|;&]*\bpush\b", command))
    if not committing and not pushing:
        return 0

    if committing:
        paths = git("diff", "--cached", "--name-only")
        scope = "这次提交"
    else:
        upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
        paths = git("diff", "--name-only", f"{upstream[0]}..HEAD") if upstream else []
        scope = "待推送的提交"
    if not paths:
        return 0

    runtime, public = classify(paths)
    notes: list[str] = []

    if runtime and "CLAUDE.md" not in paths:
        emit(deny_reason=(
            f"{scope}动了运行时文件，但 CLAUDE.md 不在其中。\n"
            "本仓库的版本仪式要求运行时改动同批更新 CLAUDE.md（CHANGELOG 行 + 当前版本行，"
            "六锚点用 `python3 scripts/bump_version.py <N>` 联动）。\n"
            "补完文档再提交；确有理由跳过就在命令里加 --no-verify，并把理由写进提交信息。"
        ))
        return 0

    if (runtime or public) and "docs/HANDOFF.md" not in paths:
        notes.append("提醒：动了运行时/对外文案，但 docs/HANDOFF.md 没跟着改——接手须知会立刻过期。")
    if public and not readme_updated_is_today():
        notes.append("提醒：动了对外文案，但 README 的 `Updated:` 还停在今天之前。")

    emit(notes=notes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
