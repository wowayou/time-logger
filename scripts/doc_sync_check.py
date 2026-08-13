#!/usr/bin/env python3
# 时间尺 (time-logger)
# Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
# SPDX-License-Identifier: AGPL-3.0-or-later
r"""改动与文档的同步闸（开发期工具，不进运行时、不进 SW 缓存）。

（docstring 是 raw 字符串：正文里引用了 `\b` / `\s` 等正则片段，普通字符串下
Python 3.12+ 会对每个未知转义发 SyntaxWarning——而本脚本由 PreToolUse hook 在
**每条含 git 的命令**上运行，那就是每次都往 stderr 吐一行噪音。更要紧的是这类
转义终将变成 SyntaxError：那时脚本无法解析、非零退出，而 PreToolUse 的非阻断
错误等于放行——闸会**静默失效**，且失效方向恰好是「什么都不拦」。）

**为什么闸在提交前与推送前**（时机分析，别挪）：

- 每次 Edit/Write 之后就提醒 → 太早也太吵。一次改动往往横跨多个文件，中途的形态
  不是最终形态；那时催写文档的结果是写三遍推翻两遍。
- 会话结束时提醒 → 太晚，什么都补不了。
- **`git commit` 之前** → 提交是持久化单元，本仓库的版本仪式本来就按提交结算。
  改动已定形、还没进历史，是唯一「知道最终形态又来得及补」的时刻。
- **`git push` 之前** → 第二道网，专抓「提交时忘了、后来也没补」，赶在它变成公开
  事实之前。

**必须踩过才知道的坑**（前两条自己踩的，第三、四条对照 eigentime 那篇
《coding agent hooks》补的）：

1. **不能只看暂存区。** PreToolUse 在**整条命令执行前**触发，而 `git add -A &&
   git commit` 是一条命令——那一刻还没 add，`git diff --cached` 永远是空，闸永远
   放行（2026-08-10 实测坐实）。所以改动集取 `git status --porcelain -z` 的**全量
   工作区**（暂存 + 未暂存 + 未跟踪），那正是 `add -A` 会扫进去的东西。
   代价是「改了但这次不打算提交」会误报——逃生开关就是给这种情况的。
2. **不能用 hook 的 `if:` 字段过滤。** 它是权限规则的前缀语法，`Bash(git commit*)`
   匹配不到 `git add -A && git commit ...`，也匹配不到 `cd x && git commit`。
   改成 matcher 只写 `Bash`，进脚本里正则判定。
3. **正则必须锚定命令位置，不能是「串里出现过」。** `\bgit\s+commit\b` 会把
   `echo "记得 git commit 一下"` 也拦下（实测 DENY）——见字就拦的闸会被立刻关掉。
   合法起点只有行首/`;`/`&`/`|`/换行，允许夹 `VAR=value` 前缀；`git` 与子命令之间
   还要放行带值的全局选项（`git -C <path> commit`，只写 `(?:-\S+\s+)*` 会漏）。
4. **`matcher: "Bash"` 会在每条命令上开销一次进程**（那篇列为反模式）。实测本脚本
   53ms/次。粗筛移到 hook 命令里的 bash `case` 内建——命令里连 `git` 都没有就
   根本不启动 python，实测降到 12ms。粗筛刻意做得**宽**：它只可能多调一次、不可能
   漏调，所以判据仍然只有脚本里那一份，不产生第二处会漂移的规则。

判据全部来自 CLAUDE.md 已有的红线，不新增规矩：

1. **拦**：改动集里有运行时文件，却没有 `CLAUDE.md`。运行时一改就要走版本仪式
   （CHANGELOG 行 + 当前版本行），二者必然同批。
2. **提醒**：动了运行时或对外文案，却没动 `docs/HANDOFF.md`。
3. **提醒**：动了对外文案，而 README 的 `Updated:` 还停在今天之前。

**逃生开关**：命令前缀 `SKIP_DOC_CHECK=1`（本仓用 `git commit -F -`，提交信息压根
不出现在 hook 能看到的命令字符串里，所以逃生开关不能是消息里的标记）。`--amend`
与 `--no-verify` 同样豁免。

**任何异常一律 exit 0 放行**——一个因为 git 抽风就卡住提交的闸比没有更糟。

**两个诚实的限制**：

1. 它只查「有没有碰文档」，查不了「写得对不对」。防的是彻底忘记，不是敷衍。
2. **它看到的是命令执行**前**的状态**——所以「在同一条 Bash 命令里先改文档、再
   提交」时，那些改动对它不可见，会误报。这是 PreToolUse 的时序本性，脚本层面
   修不了（2026-08-10 首次真实触发就撞上：同一条命令里先用 python 改了
   `docs/HANDOFF.md` 再 commit，闸仍提醒 HANDOFF 没改）。**用法上避开**：文档
   编辑与 `git commit` 分成两次调用——这本来也是更好的习惯，提交前那一眼
   `git status` 才有意义。
"""

from __future__ import annotations

import datetime
import json
import os
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

# 正则必须锚定**命令位置**，不能是「字符串里出现过」。`\bgit\s+commit\b` 会把
# `echo "记得 git commit 一下"` 也拦下（2026-08-10 实测 DENY）——一个见字就拦的闸
# 会被立刻关掉。合法起点只有：字符串开头、`;`/`&`/`|`/换行之后，允许中间夹
# `VAR=value` 形式的环境变量前缀（`SKIP_DOC_CHECK=1 git commit` 正是这一形态）。
# 残留的模糊：heredoc 正文里**独占一行**的 `git commit` 仍会命中——不写 shell
# 解析器就分不开，交给逃生开关兜底。
_CMD_START = r"(?:^|[;&|]|\n)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*"
# `git` 与子命令之间可以夹全局选项，且选项可能自带一个值（`git -C <path> commit`、
# `git -c user.name=x commit`）——只写 `(?:-\S+\s+)*` 会漏掉带值的那种（实测放行）。
_GIT_OPTS = r"(?:-\S+\s+(?:[^-\s]\S*\s+)?)*"
GIT_COMMIT_RE = re.compile(_CMD_START + r"git\s+" + _GIT_OPTS + r"commit\b")
GIT_PUSH_RE = re.compile(_CMD_START + r"git\s+" + _GIT_OPTS + r"push\b")


def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=ROOT, text=True,
                         capture_output=True, check=False, timeout=10)
    return out.stdout if out.returncode == 0 else ""


def working_tree_paths() -> set[str]:
    """全量改动集：暂存 + 未暂存 + 未跟踪，正是 `git add -A` 会扫进去的那些。

    用 `-z` 而不是默认格式：默认会把非 ASCII 路径加引号并转义（本仓有
    `使用与理念.md`），`-z` 给的是原样字节。重命名条目后面跟一个额外的来源路径
    字段，要一并消费掉。
    """
    raw = git("status", "--porcelain", "-z")
    fields = [f for f in raw.split("\0") if f]
    paths: set[str] = set()
    index = 0
    while index < len(fields):
        entry = fields[index]
        index += 1
        if len(entry) < 4:
            continue
        status, path = entry[:2], entry[3:]
        paths.add(path)
        if status[0] in ("R", "C") or status[1] in ("R", "C"):
            if index < len(fields):
                paths.add(fields[index])
                index += 1
    return paths


def unpushed_paths() -> set[str]:
    upstream = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").strip()
    if not upstream:
        return set()
    return {line for line in git("diff", "--name-only", f"{upstream}..HEAD").splitlines() if line}


def classify(paths: set[str]) -> tuple[bool, bool]:
    runtime = any(p.startswith(RUNTIME_PREFIXES) or p in RUNTIME_FILES for p in paths)
    public = any(p.startswith(PUBLIC_COPY_PREFIXES) or p in PUBLIC_COPY_FILES for p in paths)
    return runtime, public


def readme_updated_is_today() -> bool:
    match = re.search(r"^> Updated:\s*(\d{4}-\d{2}-\d{2})",
                      (ROOT / "README.md").read_text(encoding="utf-8"), re.MULTILINE)
    return not match or match.group(1) == datetime.date.today().isoformat()


def emit(deny_reason: str = "", notes: list[str] | None = None) -> None:
    out: dict = {"hookEventName": "PreToolUse"}
    if deny_reason:
        out["permissionDecision"] = "deny"
        out["permissionDecisionReason"] = deny_reason
    elif notes:
        out["additionalContext"] = "\n".join(notes)
    else:
        return
    print(json.dumps({"hookSpecificOutput": out}, ensure_ascii=False))


def run() -> None:
    event = json.load(sys.stdin)
    command = str((event.get("tool_input") or {}).get("command") or "")
    if "git" not in command:
        return
    # 逃生开关必须在**命令字符串**里能看见：本仓用 `git commit -F -`，提交信息
    # 进不了 hook 的视野，所以不能拿 message 里的标记当开关。
    if "SKIP_DOC_CHECK=1" in command or "--no-verify" in command or "--amend" in command:
        return

    committing = bool(GIT_COMMIT_RE.search(command))
    pushing = bool(GIT_PUSH_RE.search(command))
    if not committing and not pushing:
        return

    paths = working_tree_paths() if committing else unpushed_paths()
    scope = "这次提交" if committing else "待推送的提交"
    if not paths:
        return

    runtime, public = classify(paths)
    if runtime and "CLAUDE.md" not in paths:
        emit(deny_reason=(
            f"{scope}动了运行时文件，但 CLAUDE.md 不在改动里。\n"
            "本仓库的版本仪式要求运行时改动同批更新 CLAUDE.md（CHANGELOG 行 + 当前版本行，"
            "六锚点用 `python3 scripts/bump_version.py <N>` 联动）。\n"
            "补完文档再提交；确有理由跳过就在命令前加 `SKIP_DOC_CHECK=1`，并把理由写进提交信息。"
        ))
        return

    notes: list[str] = []
    if (runtime or public) and "docs/HANDOFF.md" not in paths:
        notes.append("提醒：动了运行时/对外文案，但 docs/HANDOFF.md 没跟着改——接手须知会立刻过期。")
    if public and not readme_updated_is_today():
        notes.append("提醒：动了对外文案，但 README 的 `Updated:` 还停在今天之前。")
    emit(notes=notes)


def main() -> int:
    try:
        run()
    except Exception:  # noqa: BLE001 —— 见文件头：闸坏了必须放行，不能卡住提交
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
