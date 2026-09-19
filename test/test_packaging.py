import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_xpi", ROOT / "scripts/verify-xpi.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        (self.root / "src").mkdir()
        (self.root / "static").mkdir()
        manifest = {"version": "0.1.1", "browser_specific_settings": {"gecko": {"id": "test@example.invalid"}}}
        for directory in [self.root / "static", self.dist]:
            (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
        (self.root / "src/background.ts").write_text("console.log('original');")
        (self.dist / "background.js").write_text("console.log('original');")
        (self.root / "package.json").write_text(json.dumps({"version": "0.1.1"}))
        (self.root / "package-lock.json").write_text("{}")
        (self.root / "tsconfig.json").write_text("{}")
        self.xpi = self.root / "signed-fixture.xpi"
        self.revision = "a" * 40
        self.make_xpi()
        self.receipt = verifier.record(self.root, self.xpi, self.dist, self.revision)

    def make_xpi(self, code="console.log('original');", extra=False):
        # Fake signature files for integrity tests only; never distributed.
        with zipfile.ZipFile(self.xpi, "w") as z:
            z.writestr("META-INF/mozilla.rsa", b"test fixture, not a Mozilla signature")
            z.writestr("manifest.json", json.dumps(json.loads((self.dist / "manifest.json").read_text())))
            z.writestr("background.js", code)
            if extra:
                z.writestr("unexpected.js", "console.log('extra');")

    def verify(self):
        verifier.verify(self.root, self.xpi, self.receipt, self.revision)

    def test_accepts_complete_build_with_reformatted_manifest(self):
        self.verify()

    def test_changed_source_same_version_and_manifest_is_rejected(self):
        (self.root / "src/background.ts").write_text("console.log('fix');")
        with self.assertRaisesRegex(ValueError, "fontes diferem"):
            self.verify()

    def test_changed_lockfile_is_rejected(self):
        (self.root / "package-lock.json").write_text('{"changed":true}')
        with self.assertRaisesRegex(ValueError, "fontes diferem"):
            self.verify()

    def test_wrong_revision_is_rejected(self):
        self.revision = "b" * 40
        with self.assertRaisesRegex(ValueError, "outra revisão"):
            self.verify()

    def test_changed_xpi_is_rejected(self):
        self.make_xpi("console.log('different');")
        with self.assertRaisesRegex(ValueError, "hash do XPI"):
            self.verify()

    def test_payload_mismatch_is_rejected_even_if_file_hash_matches(self):
        self.make_xpi(extra=True)
        self.receipt["xpi_sha256"] = verifier.digest(self.xpi.read_bytes())
        with self.assertRaisesRegex(ValueError, "conteúdo do XPI"):
            self.verify()

    def test_signing_rejects_missing_or_extra_built_files(self):
        (self.dist / "extra.js").write_text("extra")
        with self.assertRaisesRegex(ValueError, "build local"):
            verifier.record(self.root, self.xpi, self.dist, self.revision)

    def test_make_sources_checks_receipt_before_creating_archive(self):
        shutil.copytree(ROOT / "scripts", self.root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "packaging/obs", self.root / "packaging/obs", ignore=shutil.ignore_patterns("out"))
        def git(*args):
            return subprocess.check_output(["git", "-C", str(self.root), *args], stderr=subprocess.DEVNULL, text=True).strip()
        git("init", "-q")
        git("add", "src", "static", "scripts", "packaging", "package.json", "package-lock.json", "tsconfig.json")
        git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        revision = git("rev-parse", "HEAD")
        receipt = verifier.record(self.root, self.xpi, self.dist, revision)
        out = self.root / "packaging/obs/out"
        out.mkdir()
        shutil.copyfile(self.xpi, out / "test@example.invalid-0.1.1.xpi")
        (out / "test@example.invalid-0.1.1.provenance.json").write_text(json.dumps(receipt))
        run = lambda: subprocess.run(["bash", "packaging/obs/make-sources.sh", "HEAD"], cwd=self.root, capture_output=True, text=True)
        good = run()
        self.assertEqual(good.returncode, 0, good.stderr)
        archive = out / "lyra-firefox-ext-0.1.1.tar.zst"
        old_archive = archive.read_bytes()
        (self.root / "src/background.ts").write_text("console.log('new fix, old signed artifact');")
        git("add", "src/background.ts")
        git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "changed code")
        bad = run()
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("outra revisão", bad.stderr)
        self.assertEqual(archive.read_bytes(), old_archive)


if __name__ == "__main__":
    unittest.main()
