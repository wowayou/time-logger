# 时间尺 (time-logger)
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Release guard / artifact regressions. Uses isolated Git repos, never network."""
from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_legacy_site import assemble, compatibility_page, verify_release  # noqa: E402


class LegacySiteTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="legacy-site-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.out = Path(self.temp.name) / "output"
        self.root.mkdir()
        self.git("init", "-q", "--initial-branch=main")
        self.git("config", "user.name", "Isolated test")
        self.git("config", "user.email", "test@example.invalid")
        self.write("manifest.webmanifest", '{"version":"1.6.1"}')
        self.write("index.html", "<html>unchanged runtime</html>\n")
        self.write("sw.js", "const CACHE = 'timelog-v1.6.1';\n")
        self.write("src/app.js", "export const value = 1;\n")
        self.write("icons/icon.png", b"synthetic image")
        self.write("README.md", "# README\n")
        self.write("CONTRIBUTING.md", "# Contributing\n")
        self.write("STATUS.md", "# Status\n")
        self.write("docs/CHANGELOG.md", "# History\n")
        self.write("使用与理念.md", "# 使用与理念\n")
        self.write(".gitignore", "untracked-private/\n")
        self.write(".claude/settings.json", "{}")
        self.write(".github/workflows/publish.yml", "name: fixture")
        self.write("docs/.hidden/note.md", "not for the legacy artifact")
        self.commit()
        self.git("tag", "-a", "v1.6.1", "-m", "test release")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE)

    def write(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))

    def commit(self):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "fixture")

    def build(self, tag="v1.6.1"):
        with contextlib.redirect_stdout(io.StringIO()):
            return assemble(self.root, self.out, tag)

    def test_annotated_release_and_runtime_bytes(self):
        source, release = verify_release(self.root, "v1.6.1")
        self.assertEqual(source, release)
        self.build()
        for name in ("index.html", "sw.js", "manifest.webmanifest", "src/app.js", "icons/icon.png"):
            self.assertEqual((self.out / name).read_bytes(), (self.root / name).read_bytes())

    def test_docs_only_commit_can_publish_with_existing_release(self):
        self.write("STATUS.md", "# Updated docs, same runtime\n")
        self.commit()
        source, release = verify_release(self.root, "v1.6.1")
        self.assertNotEqual(source, release)
        self.build()
        self.assertEqual((self.out / "STATUS.md").read_text(), "# Updated docs, same runtime\n")

    def test_missing_or_malformed_tag_is_rejected(self):
        for tag in ("", "main", "HEAD", "v1.6", "v1.6.1-rc.1", "v1.6.1;echo bad", "../v1.6.1", "v9.9.9"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.build(tag)
        self.assertFalse(self.out.exists())

    def test_wrong_manifest_version_is_rejected(self):
        self.git("tag", "v1.6.2")
        with self.assertRaisesRegex(ValueError, "does not match manifest version"):
            self.build("v1.6.2")
        self.assertFalse(self.out.exists())

    def test_changed_runtime_with_same_version_is_rejected(self):
        self.write("src/app.js", "export const value = 2;\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "runtime differs.*src/app.js"):
            self.build()
        self.assertFalse(self.out.exists())

    def test_added_runtime_outside_sw_manifest_is_rejected(self):
        self.write("src/not-yet-cached.js", "export const unreleased = true;\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, "runtime differs.*src/not-yet-cached.js"):
            self.build()

    def test_deleted_runtime_is_rejected(self):
        (self.root / "src/app.js").unlink()
        self.commit()
        with self.assertRaisesRegex(ValueError, "runtime differs.*src/app.js"):
            self.build()

    def test_changed_icon_is_rejected(self):
        self.write("icons/icon.png", b"changed synthetic image")
        self.commit()
        with self.assertRaisesRegex(ValueError, "runtime differs.*icons/icon.png"):
            self.build()

    def test_hidden_and_untracked_files_never_enter_artifact(self):
        self.write("untracked-private/notes.txt", "local only")
        self.write("untracked.txt", "also local only")
        self.build()
        for path in (".git", ".gitignore", ".claude", ".github", "docs/.hidden", "untracked-private", "untracked.txt"):
            with self.subTest(path=path):
                self.assertFalse((self.out / path).exists())

    def test_dirty_runtime_is_not_published(self):
        original = (self.root / "src/app.js").read_bytes()
        self.write("src/app.js", "uncommitted code must not ship")
        self.build()
        self.assertEqual((self.out / "src/app.js").read_bytes(), original)

    def test_old_document_urls_get_scriptless_links(self):
        self.build()
        for path, source in (("STATUS.html", "STATUS.md"), ("docs/CHANGELOG.html", "docs/CHANGELOG.md"), ("使用与理念.html", "使用与理念.md")):
            with self.subTest(path=path):
                page = (self.out / path).read_text()
                self.assertIn('http-equiv="refresh"', page)
                self.assertIn('rel="canonical"', page)
                self.assertNotIn("<script", page)
                self.assertEqual((self.out / source).read_bytes(), (self.root / source).read_bytes())
        self.assertFalse((self.out / "README.html").exists())
        self.assertFalse((self.out / "CONTRIBUTING.html").exists())

    def test_compatibility_page_escapes_filename_and_url(self):
        page = compatibility_page('docs/a "<&.md').decode()
        self.assertIn('a &quot;&lt;&amp;.md', page)
        self.assertIn('a%20%22%3C%26.md', page)
        self.assertNotIn('<script', page)

    def test_existing_html_is_preserved(self):
        self.write("docs/CHANGELOG.html", "existing tracked HTML")
        self.commit()
        self.build()
        self.assertEqual((self.out / "docs/CHANGELOG.html").read_text(), "existing tracked HTML")

    def test_output_inside_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            assemble(self.root, self.root / "_site", "v1.6.1")
        self.assertFalse((self.root / "_site").exists())

    def test_nonempty_output_is_not_deleted(self):
        self.out.mkdir()
        keep = self.out / "keep.txt"
        keep.write_text("do not delete")
        with self.assertRaisesRegex(ValueError, "empty"):
            self.build()
        self.assertEqual(keep.read_text(), "do not delete")

    def test_symlink_is_rejected_before_output_is_written(self):
        (self.root / "outside-link").symlink_to("/etc/passwd")
        self.commit()
        with self.assertRaisesRegex(ValueError, "non-regular tracked file"):
            self.build()
        self.assertFalse(self.out.exists())

    def test_legacy_integer_tag_is_supported(self):
        self.write("manifest.webmanifest", json.dumps({"version": "93"}))
        self.commit()
        self.git("tag", "v93")
        self.build("v93")
        self.assertEqual(json.loads((self.out / "manifest.webmanifest").read_text())["version"], "93")

    def test_missing_runtime_entry_fails_before_writing(self):
        (self.root / "index.html").unlink()
        self.write("manifest.webmanifest", '{"version":"1.6.2"}')
        self.commit()
        self.git("tag", "v1.6.2")
        with self.assertRaisesRegex(ValueError, "missing runtime file: index.html"):
            self.build("v1.6.2")
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
