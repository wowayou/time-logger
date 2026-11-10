"""Deployment assembly must reject destructive destinations before touching files."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('build_site', Path(__file__).resolve().parents[1] / 'scripts/build_site.py')
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


class BuildSiteSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'source'
        self.root.mkdir()
        (self.root / 'site').mkdir()
        (self.root / 'site/index.html').write_text('homepage')
        (self.root / 'index.html').write_text('app')
        (self.root / 'manifest.webmanifest').write_text(json.dumps({'version': '1.0.0'}))
        (self.root / 'sw.js').write_text("const FILES = ['./', './index.html', './sw.js', './manifest.webmanifest'];")
        (self.root / 'demo.png').write_bytes(b'demo')
        self.out = self.base / 'mirror'
        for name, value in [('ROOT', self.root), ('SITE_DIR', self.root / 'site'), ('REQUIRED_DEMO_ASSETS', ['demo.png'])]:
            p = patch.object(build, name, value)
            p.start()
            self.addCleanup(p.stop)

    def run_build(self, *extra):
        with patch.object(sys, 'argv', ['build_site.py', '--out', str(self.out), *extra]), contextlib.redirect_stdout(io.StringIO()):
            return build.main()

    def snapshot(self):
        return {str(p.relative_to(self.out)): p.read_bytes() for p in self.out.rglob('*') if p.is_file()}

    def test_reject_source_ancestors_and_descendants_including_symlink(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        for out in [self.root, self.root / 'generated', self.base, Path('/'), alias, alias / 'nested']:
            with self.subTest(out=out), self.assertRaises(SystemExit):
                build.check_out_dir(out)
        self.assertEqual((self.root / 'index.html').read_text(), 'app')

    def test_unknown_destination_is_not_cleaned(self):
        self.out.mkdir()
        (self.out / 'notes.txt').write_text('valuable')
        with self.assertRaises(SystemExit):
            self.run_build()
        self.assertEqual((self.out / 'notes.txt').read_text(), 'valuable')

    def test_unmarked_html_directory_is_not_cleaned(self):
        self.out.mkdir()
        (self.out / 'index.html').write_text('another project')
        with self.assertRaises(SystemExit):
            self.run_build()
        self.assertEqual((self.out / 'index.html').read_text(), 'another project')

    def test_repeat_assembly_preserves_git_and_readme(self):
        self.out.mkdir()
        (self.out / '.git').mkdir()
        (self.out / '.git/HEAD').write_text('keep')
        (self.out / 'README.md').write_text('keep')
        self.run_build()
        first = self.snapshot()
        self.run_build()
        self.assertEqual(self.snapshot(), first)
        self.assertEqual((self.out / '.git/HEAD').read_text(), 'keep')
        self.assertEqual((self.out / 'README.md').read_text(), 'keep')
        self.run_build('--no-cname')
        self.assertFalse((self.out / 'CNAME').exists())
        self.run_build('--no-cname')

    def test_missing_demo_preserves_previous_output(self):
        self.run_build()
        before = self.snapshot()
        (self.root / 'demo.png').unlink()
        with self.assertRaises(SystemExit):
            self.run_build()
        self.assertEqual(self.snapshot(), before)

    def test_unsafe_runtime_paths_rejected_before_cleanup(self):
        self.run_build()
        before = self.snapshot()
        for entry in ['./../outside.txt', './/etc/passwd', './src/../../outside', './.git/config', './src/./app.js']:
            with self.subTest(entry=entry):
                (self.root / 'sw.js').write_text(f"const FILES = ['./index.html', './sw.js', '{entry}'];")
                with self.assertRaises(SystemExit):
                    self.run_build()
                self.assertEqual(self.snapshot(), before)

    def test_source_and_output_symlinks_do_not_touch_targets(self):
        self.run_build()
        before = self.snapshot()
        alias = self.base / 'mirror-alias'
        alias.symlink_to(self.out, target_is_directory=True)
        with self.assertRaises(SystemExit):
            build.check_out_dir(alias)
        self.assertEqual(self.snapshot(), before)
        outside = self.base / 'outside.txt'
        outside.write_text('secret')
        (self.root / 'index.html').unlink()
        (self.root / 'index.html').symlink_to(outside)
        with self.assertRaises(SystemExit):
            self.run_build()
        self.assertEqual(self.snapshot(), before)
        (self.root / 'index.html').unlink()
        (self.root / 'index.html').write_text('app')
        (self.out / 'index.html').unlink()
        (self.out / 'index.html').symlink_to(outside)
        with self.assertRaises(SystemExit):
            self.run_build()
        self.assertEqual(outside.read_text(), 'secret')


if __name__ == '__main__':
    unittest.main()
