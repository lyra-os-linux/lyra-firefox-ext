# Lyra OS Firefox theme

A standalone static theme, version 0.2.0, ID `theme@lyraos.com.br`.
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

The image includes this x86_64 integration RPM (the XPI itself is portable). The RPM exposes the signed XPI through Firefox's
`distribution/extensions/theme@lyraos.com.br.xpi` directory, as a symlink to the
unchanged XPI in `/usr/share/lyra-firefox-theme`. Firefox offers the theme under
Add-ons and themes without selecting it. New profiles retain Firefox's default;
existing profiles retain their selected theme. No extra policy is needed.

Do not use `ExtensionSettings.normal_installed` for this theme: a real signed-XPI
test on ESR 140.13 showed that policy activates the theme over existing user
choices. The Downloads extension retains its separate, existing policy.
Do not lock activeThemeID, edit user.js or copy user profiles.

The signed distribution mechanism passed new/existing-profile installation,
selection, restart, switching away, removal and restart without resurrection.
A new RPM replaces the bundled XPI; Firefox controls distribution add-on updates
and preserves user-disabled state. Version-to-version upgrade must also be
qualified when a successor theme version is introduced.

## Validation and release gates

A temporary profile on Firefox ESR 140.13.0 accepted the unsigned theme through
the temporary developer installation API, changed browser chrome colors between
light/dark, and allowed switching to a built-in theme and removal. This test does
not qualify signing, upgrade/policy behavior, the image or an existing real profile.
Unit tests check text contrast >= 4.5:1, focus >= 3:1, locales and payload integrity.

The maintainer approved both palettes on 21/09/2026. Mozilla signed 0.1.0;
Firefox verified signedState=2. Signed distribution-profile evidence is in
`evidence/distribution-20260921.json`. Before candidate release: keyboard focus,
100%/200% scaling, menus and version upgrades as applicable. Downloads handoff,
final-file preservation, event-page suspension and lost-reply recovery passed
with the signed theme active (`evidence/downloads-20260921.json`).
After the Alpha 8 audit, qualify the exact ISO and record its checksum; keep
issue #1 open until those criteria pass. Revert by removing the theme package from the image and selecting Firefox's default theme; preserve
profiles, browsing data and the Downloads extension.

References:
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/theme
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/dark_theme
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/

## Published package — 21 September 2026

OBS request 1379465 promoted source digest
`5c631127f463c5a6b9b09538a110bc65` after all staging gates passed. Release gates
also passed. Public `lyra-firefox-theme-0.1.0-lp161.1.1.x86_64.rpm` has SHA-256
`465810460a44cc48305ff1355d19f531dc8bca45e2f60509095b52f2f746f002`.
Its signature is valid and its XPI matches the browser-tested Mozilla artifact.
See [publication evidence](evidence/publication-20260921.json). No ISO was generated.

## Odyssey header — 0.2.0

The maintainer approved a discreet space motif (stars, planets, constellations)
on 21 September 2026. Both modes use the same bundled transparent illustration,
centered vertically and aligned right without tiling; toolbar colors stay opaque.
The artwork was generated with the built-in imagegen tool for this project;
see `evidence/odyssey-art-20260921.json` for provenance. No runtime generation,
network access or additional permissions are introduced.

Palette contrast tests measure solid color pairs. Artwork behind inactive tabs
also requires visual review; light/dark previews on Firefox 140.13 were approved.
Mozilla signed 0.2.0. Firefox 140.13 verified signedState=2 and explicit XPI
updates preserved both the active Lyra theme and another selected theme.
Removed themes were not restored; new profiles kept the default theme.
See `evidence/odyssey-upgrade-20260921.json`.

Replacing only the distribution RPM does not immediately update an existing
profile on the same Firefox version: Firefox skips already processed distribution
add-ons until an application upgrade. To test the update immediately, open
about:addons, choose Install Add-on From File, and select
`/usr/share/lyra-firefox-theme/theme@lyraos.com.br.xpi`.
Do not modify user profiles or force theme selection to bypass this behavior.
Release publication and exact-ISO qualification are separate gates.
