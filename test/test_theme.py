"""Standalone theme: readable palettes, no executable privileges, payload integrity."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'theme/static'
MANIFEST = json.loads((SOURCE / 'manifest.json').read_text())
spec = importlib.util.spec_from_file_location('theme_verify', ROOT / 'theme/scripts/verify.py')
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def luminance(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    return sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))


class ThemeTests(unittest.TestCase):
    def test_static_and_localized(self):
        self.assertEqual(MANIFEST['default_locale'], 'en_US')
        self.assertEqual(MANIFEST['browser_specific_settings']['gecko']['id'], 'theme@lyraos.com.br')
        self.assertFalse({'permissions', 'background', 'content_scripts', 'theme_experiment', 'host_permissions'} & MANIFEST.keys())
        self.assertTrue(all(p.suffix == '.json' for p in SOURCE.rglob('*') if p.is_file()))
        for locale in ('en_US', 'pt_BR', 'es_ES'):
            messages = json.loads((SOURCE / '_locales' / locale / 'messages.json').read_text())
            for field in ('name', 'description'):
                self.assertTrue(messages[MANIFEST[field][6:-2]]['message'])

    def test_distribution_uses_target_browser_directory(self):
        spec = (ROOT / 'theme/packaging/lyra-firefox-theme.spec').read_text()
        self.assertIn('%global firefox_dist /usr/lib64/firefox/distribution', spec)
        self.assertNotIn('%{_libdir}', spec)
        self.assertIn('extensions/theme@lyraos.com.br.xpi', spec)
        self.assertNotIn('force_installed', spec)

    def test_text_and_focus_contrast(self):
        pairs = [('tab_text', 'tab_selected'), ('tab_background_text', 'frame'),
                 ('toolbar_text', 'toolbar'), ('toolbar_field_text', 'toolbar_field'),
                 ('toolbar_field_text_focus', 'toolbar_field_focus'),
                 ('toolbar_field_highlight_text', 'toolbar_field_highlight'),
                 ('popup_text', 'popup'), ('popup_highlight_text', 'popup_highlight'),
                 ('sidebar_text', 'sidebar'), ('sidebar_highlight_text', 'sidebar_highlight'),
                 ('ntp_text', 'ntp_background')]
        for mode in ('theme', 'dark_theme'):
            c = MANIFEST[mode]['colors']
            for foreground, background in pairs + [('toolbar_field_border_focus', 'toolbar_field_focus')]:
                a, b = sorted((luminance(c[foreground]), luminance(c[background])))
                self.assertGreaterEqual((b + .05) / (a + .05), 3 if foreground.endswith('border_focus') else 4.5, (mode, foreground, background))

    def test_signed_payload_rejects_tampering_and_extra_files(self):
        # Signature marker is a fixture, not a cryptographic signature check.
        with tempfile.TemporaryDirectory() as tmp:
            xpi = Path(tmp) / 'theme.xpi'
            files = verify.payload(SOURCE)
            for mutation in ('none', 'modified', 'extra', 'unsigned'):
                with zipfile.ZipFile(xpi, 'w') as z:
                    for name, data in files.items():
                        if mutation == 'modified' and name == 'manifest.json':
                            m = json.loads(data); m['version'] = '999'; data = json.dumps(m)
                        z.writestr(name, data)
                    if mutation == 'extra': z.writestr('background.js', 'bad')
                    if mutation != 'unsigned': z.writestr('META-INF/cose.sig', 'fixture')
                if mutation == 'none': self.assertIn('xpi_sha256', verify.verify(SOURCE, xpi))
                else:
                    with self.assertRaises(ValueError): verify.verify(SOURCE, xpi)
