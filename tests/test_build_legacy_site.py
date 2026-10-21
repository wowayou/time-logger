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
        self.write("index.html", '<html>unchanged runtime<script type="module" src="src/app.js"></script><!-- $Format:%H$ --></html>\n')
        self.write("styles.css", "body { color: black; }\n")
        self.write("sw.js", "const CACHE = 'timelog-v1.6.1';\n")
        self.write("icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n')
        self.write("src/app.js", "export const value = 1; // $Format:%H$\n")
        self.write("src/locales/en.js", "export const locale = 'en';\n")
        self.write("icons/icon.png", b"synthetic image $Format:%H$\0\xff")
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

    def assert_runtime_bytes(self, source):
        paths = (
            "index.html", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg",
            "src/app.js", "src/locales/en.js", "icons/icon.png",
        )
        for path in paths:
            with self.subTest(runtime=path):
                self.assertEqual((self.out / path).read_bytes(), self.git("show", f"{source}:{path}"))

    def test_annotated_release_and_runtime_bytes(self):
        source, release = verify_release(self.root, "v1.6.1")
        self.assertEqual(source, release)
        self.build()
        self.assert_runtime_bytes(source)

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

    def test_directory_gitattributes_committed_with_release_are_allowed(self):
        paths = ("src/.gitattributes", "src/locales/.gitattributes", "icons/.gitattributes")
        for index, path in enumerate(paths, start=2):
            with self.subTest(path=path):
                # Each release contains only this case's directory metadata.
                for previous in paths:
                    (self.root / previous).unlink(missing_ok=True)
                self.out = Path(self.temp.name) / f"metadata-output-{index}"
                tag = f"v1.6.{index}"
                self.write(path, "* text=auto\n")
                self.write("manifest.webmanifest", json.dumps({"version": tag[1:]}))
                self.commit()
                self.git("tag", "-a", tag, "-m", "release with directory metadata")
                source, release = verify_release(self.root, tag)
                self.assertEqual(source, release)
                self.build(tag)
                self.assert_runtime_bytes(source)
                self.assertFalse((self.out / path).exists())

    def test_hidden_runtime_path_components_are_excluded(self):
        paths = ("src/.hidden/helper.js", "src/locales/.metadata.js", "icons/.hidden/icon.png")
        for path in paths:
            self.write(path, "tracked metadata, not an artifact runtime file\n")
        self.write("manifest.webmanifest", '{"version":"1.6.2"}')
        self.commit()
        self.git("tag", "-a", "v1.6.2", "-m", "release with hidden metadata")
        source, release = verify_release(self.root, "v1.6.2")
        self.assertEqual(source, release)
        self.build("v1.6.2")
        self.assert_runtime_bytes(source)
        for path in ("src/.hidden", "src/locales/.metadata.js", "icons/.hidden"):
            with self.subTest(path=path):
                self.assertFalse((self.out / path).exists())

    def test_unreleased_hidden_runtime_metadata_is_still_rejected(self):
        self.write("src/.gitattributes", "* text=auto\n")
        self.commit()
        with self.assertRaisesRegex(ValueError, r"runtime differs from release tag: src/\.gitattributes"):
            self.build()
        self.assertFalse(self.out.exists())

    def test_directory_export_attributes_are_rejected_before_writing(self):
        paths = ("src/.gitattributes", "src/locales/.gitattributes", "icons/.gitattributes")
        cases = (
            ("src/.gitattributes", "export-ignore", "missing runtime file: src/app.js"),
            ("src/locales/.gitattributes", "export-ignore", "missing runtime file: src/locales/en.js"),
            ("icons/.gitattributes", "export-ignore", "missing runtime file: icons/icon.png"),
            ("src/.gitattributes", "export-subst", "archived runtime differs from Git content: src/app.js"),
            ("icons/.gitattributes", "export-subst", "archived runtime differs from Git content: icons/icon.png"),
        )
        for index, (path, attribute, error) in enumerate(cases, start=2):
            with self.subTest(path=path, attribute=attribute):
                for previous in paths:
                    (self.root / previous).unlink(missing_ok=True)
                self.out = Path(self.temp.name) / f"directory-attributes-output-{index}"
                if attribute == "export-subst":
                    self.out.mkdir()
                tag = f"v1.6.{index}"
                self.write(path, f"* {attribute}\n")
                self.write("manifest.webmanifest", json.dumps({"version": tag[1:]}))
                self.commit()
                self.git("tag", "-a", tag, "-m", "release with directory export rules")
                source, release = verify_release(self.root, tag)
                self.assertEqual(source, release)
                with self.assertRaises(ValueError) as raised:
                    self.build(tag)
                self.assertEqual(str(raised.exception), error)
                if attribute == "export-subst":
                    self.assertEqual(list(self.out.iterdir()), [])
                else:
                    self.assertFalse(self.out.exists())

    def test_export_ignore_runtime_is_rejected_before_writing(self):
        paths = (
            "index.html", "styles.css", "sw.js", "manifest.webmanifest", "icon.svg",
            "src/app.js", "src/locales/en.js", "icons/icon.png", "src", "src/locales", "icons",
        )
        directory_files = {"src": "src/app.js", "src/locales": "src/locales/en.js", "icons": "icons/icon.png"}
        for index, path in enumerate(paths):
            with self.subTest(path=path):
                self.out = Path(self.temp.name) / f"ignored-output-{index}"
                self.write(".gitattributes", f"{path} export-ignore\n")
                self.commit()
                source, release = verify_release(self.root, "v1.6.1")
                self.assertNotEqual(source, release)  # Only archive rules changed after the tag.
                with self.assertRaisesRegex(ValueError, "missing runtime file") as raised:
                    self.build()
                self.assertEqual(str(raised.exception), f"missing runtime file: {directory_files.get(path, path)}")
                self.assertFalse(self.out.exists())

    def test_export_subst_runtime_is_rejected_before_writing(self):
        # Real Git substitution must be caught in both text and binary blobs.
        for index, path in enumerate(("index.html", "src/app.js", "icons/icon.png")):
            with self.subTest(path=path):
                self.out = Path(self.temp.name) / f"substituted-output-{index}"
                self.out.mkdir()
                self.assertIn(b"$Format:%H$", self.git("show", f"HEAD:{path}"))
                self.write(".gitattributes", f"{path} export-subst\n")
                self.commit()
                source, release = verify_release(self.root, "v1.6.1")
                self.assertNotEqual(source, release)
                with self.assertRaisesRegex(ValueError, "archived runtime differs") as raised:
                    self.build()
                self.assertEqual(str(raised.exception), f"archived runtime differs from Git content: {path}")
                self.assertEqual(list(self.out.iterdir()), [])

    def test_export_attributes_that_preserve_runtime_are_allowed(self):
        self.write("STATUS.md", "# Status $Format:%H$\n")
        self.write(".gitattributes", "docs/CHANGELOG.md export-ignore\nSTATUS.md export-subst\nsrc/locales/en.js export-subst\n")
        self.commit()
        source, _ = verify_release(self.root, "v1.6.1")
        self.build()
        self.assertEqual((self.out / "src/locales/en.js").read_bytes(), self.git("show", f"{source}:src/locales/en.js"))
        self.assertEqual((self.out / "STATUS.md").read_text(), f"# Status {source}\n")
        self.assertTrue((self.out / "STATUS.html").is_file())
        self.assertFalse((self.out / "docs/CHANGELOG.md").exists())
        self.assertFalse((self.out / "docs/CHANGELOG.html").exists())
        self.assertFalse((self.out / ".gitattributes").exists())

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
