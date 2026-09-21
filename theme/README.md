# Lyra OS Firefox theme

A standalone static theme, version 0.1.0, ID `theme@lyraos.com.br`.
Light and dark palettes follow the system using Firefox's supported `theme`
and `dark_theme` manifest keys. Requires Firefox 140 or later. The Downloads
extension keeps its existing ID, version and permissions.

The palette reuses Lyra Desktop's slate backgrounds, blue focus accent and cyan
dark accent (`lyraos-desktop-theme/src/grub/background.svg` and `select.svg`).
Light surfaces are adapted for readable contrast. No external images, fonts,
scripts, permissions, CSS experiments or network requests are included.
Original theme metadata/palette integration is GPL-3.0-or-later (repository LICENSE).
English is the fallback; Portuguese (Brazil) and Spanish (Spain) are included.

## Build and distribution

Run `python3 -m unittest discover -s test -p 'test_theme.py'` and
`web-ext lint --source-dir theme/static --self-hosted`.
Commit a clean source revision, then run `theme/scripts/sign.sh` with the same
private AMO credential file documented for the Downloads extension. It signs
only this theme through Mozilla's unlisted channel. Never disable Firefox's
signature enforcement. Each signed update needs a new theme version, independent
of package.json and the Downloads manifest.

The verifier compares every signed payload file against the source, rejecting
extra or modified files. Signature-file presence is not a cryptographic check:
the target Firefox must accept the signed XPI before publication.
`theme/packaging/lyra-firefox-theme.spec` packages the XPI unchanged in
`/usr/share/lyra-firefox-theme/theme@lyraos.com.br.xpi`.

The image should include this RPM and merge this entry into its existing
`ExtensionSettings` policy (never replace the Downloads policy):

```json
"theme@lyraos.com.br": {
  "installation_mode": "normal_installed",
  "install_url": "file:///usr/share/lyra-firefox-theme/theme@lyraos.com.br.xpi"
}
```

Use normal installation, never `force_installed`, activeThemeID locks, user.js,
or profile copying. Existing theme choices must survive installation and
updates. The user can select Lyra OS in Add-ons and themes, choose a different
theme or remove it. Validate these behaviors with the signed package and image
policy before merging the recipe. Removal/reinstallation semantics remain subject
to Firefox's normal-installed policy; do not promise permanent suppression
across a changed policy/version without testing it.

## Validation and release gates

A temporary profile on Firefox ESR 140.13.0 accepted the unsigned theme through
the temporary developer installation API, changed browser chrome colors between
light/dark, and allowed switching to a built-in theme and removal. This test does
not qualify signing, upgrade/policy behavior, the image or an existing real profile.
Unit tests check text contrast >= 4.5:1, focus >= 3:1, locales and payload integrity.

Before release: validate the signed XPI, policy installation in new/existing
profiles, update, disable/remove and restart, keyboard focus, 100%/200% scaling,
menus and Downloads coexistence. Obtain visual approval of both variants.
After the Alpha 8 audit, qualify the exact ISO and record its checksum; keep
issue #1 open until those criteria pass. Revert by removing the theme policy
and package from the image and selecting Firefox's default theme; preserve
profiles, browsing data and the Downloads extension.

References:
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/dark_theme
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
