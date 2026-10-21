#!/usr/bin/env python3
# 时间尺 (time-logger)
# Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Verify a release tag and assemble the read-only legacy Pages artifact (D34).

Only committed files are copied; runtime bytes are never transformed. Developer
hidden files are excluded, and former Jekyll document URLs get small link pages.
No dependencies outside the Python standard library and Git; no network access.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
# Compare whole runtime directories, not another copy of the SW asset manifest:
# additions/deletions and files not yet listed in FILES must also block publishing.
RUNTIME_PATHS = (
    "index.html", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg", "src", "icons"
)
TAG_PATTERN = re.compile(r"v[0-9]+(?:\.[0-9]+\.[0-9]+)?")
# These two source documents had no .html counterparts in the old Jekyll output.
NO_LEGACY_HTML = {"README.md", "CONTRIBUTING.md"}
DOC_BASE = "https://github.com/wowayou/time-logger/blob/main/"


def is_hidden_path(path: PurePosixPath) -> bool:
    """Use the same hidden-component policy for archive and runtime validation."""
    return any(part.startswith(".") for part in path.parts)


def git(root: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, timeout=30, check=False
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout


def verify_release(root: Path, release_tag: str) -> tuple[str, str]:
    """Reject missing/wrong tags and same-version but unreleased runtime changes."""
    if not TAG_PATTERN.fullmatch(release_tag):
        raise ValueError("release tag must be vN or vN.N.N")
    release = git(root, "rev-parse", "--verify", f"refs/tags/{release_tag}^{{commit}}")
    source = git(root, "rev-parse", "HEAD^{commit}")
    source_sha, release_sha = source.decode().strip(), release.decode().strip()
    manifest = json.loads(git(root, "show", f"{source_sha}:manifest.webmanifest"))
    if manifest.get("version") != release_tag[1:]:
        raise ValueError(f"tag {release_tag} does not match manifest version {manifest.get('version')}")
    changes = git(root, "diff", "--name-only", "-z", release_sha, source_sha, "--", *RUNTIME_PATHS)
    if changes:
        names = changes.decode("utf-8").strip("\0").split("\0")
        raise ValueError("runtime differs from release tag: " + ", ".join(names))
    return source_sha, release_sha


def compatibility_page(source: str) -> bytes:
    target = html.escape(DOC_BASE + quote(source, safe="/"), quote=True)
    title = html.escape(source)
    return (
        '<!doctype html>\n<html lang="zh"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'<title>{title} — 文档已迁至 GitHub</title>\n'
        f'<link rel="canonical" href="{target}">\n'
        f'<meta http-equiv="refresh" content="0; url={target}">\n'
        '</head><body><p>此旧站只保留只读应用；文档请查看 '
        f'<a href="{target}">{title}</a>。</p></body></html>\n'
    ).encode("utf-8")


def assemble(root: Path, out: Path, release_tag: str) -> tuple[int, int]:
    """Validate before writing. Refuse non-empty outputs rather than delete files."""
    root, out = root.resolve(), out.resolve()
    if out == root or root in out.parents:
        raise ValueError("output must be outside the source repository")
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise ValueError("output must be absent or an empty directory")
    source, release = verify_release(root, release_tag)
    archive = git(root, "archive", "--format=tar", source)
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
        for entry in tree:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError(f"unsafe archive path: {entry.name}")
            if is_hidden_path(path):
                continue
            if entry.isdir():
                continue
            if not entry.isfile():
                raise ValueError(f"non-regular tracked file: {entry.name}")
            with tree.extractfile(entry) as data:
                files[path.as_posix()] = data.read()
    for required in ("index.html", "sw.js", "manifest.webmanifest"):
        if required not in files:
            raise ValueError(f"missing runtime file: {required}")
    # git archive honors export-ignore/export-subst; a matching source tree does
    # not guarantee that the artifact contains every original runtime byte.
    runtime_names = git(root, "ls-tree", "-r", "--name-only", "-z", source, "--", *RUNTIME_PATHS)
    for name in runtime_names.decode("utf-8").split("\0")[:-1]:
        if is_hidden_path(PurePosixPath(name)):
            continue
        if name not in files:
            raise ValueError(f"missing runtime file: {name}")
        if files[name] != git(root, "show", f"{source}:{name}"):
            raise ValueError(f"archived runtime differs from Git content: {name}")

    pages = {}
    for source_path in files:
        if source_path.endswith(".md") and source_path not in NO_LEGACY_HTML:
            dest = str(PurePosixPath(source_path).with_suffix(".html"))
            if dest not in files:
                pages[dest] = compatibility_page(source_path)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in (files | pages).items():
        dest = out / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    print(f"build_legacy_site: {source[:12]} runtime matches {release_tag} ({release[:12]})")
    print(f"build_legacy_site: {len(files)} committed files + {len(pages)} doc links -> {out}")
    return len(files), len(pages)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-tag", required=True, help="existing vN or vN.N.N tag")
    parser.add_argument("--out", required=True, help="empty output directory outside the source repo")
    args = parser.parse_args()
    try:
        assemble(ROOT, Path(args.out), args.release_tag)
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f"build_legacy_site: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
