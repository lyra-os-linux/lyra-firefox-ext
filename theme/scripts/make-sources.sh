#!/usr/bin/env bash
# Prepare OBS sources from the immutable revision recorded during signing.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
version="$(python3 -c 'import json;print(json.load(open("theme/static/manifest.json"))["version"])')"
out="theme/out/$version"
signing_revision="$(cat "$out/source-revision")"
revision="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]]
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
xpi="$out/theme@lyraos.com.br-$version.xpi"
python3 theme/scripts/verify.py --source theme/static --xpi "$xpi"
out="$out/obs-$revision"
[[ ! -e "$out" ]]
mkdir -p "$out"
cp "$xpi" "$out/"
printf '%s\n' "$signing_revision" > "$out/signing-revision"
printf '%s\n' "$revision" > "$out/packaging-revision"
# Package exactly the source tree used to sign, including its verifier/license.
git archive --format=tar --prefix="lyra-firefox-theme-$version/" \
    --output="$out/source.tar" "$revision"
zstd -q "$out/source.tar" -o "$out/lyra-firefox-theme-$version.tar.zst"
git show "$revision:theme/packaging/lyra-firefox-theme.spec" > "$out/lyra-firefox-theme.spec"
git show "$revision:theme/packaging/lyra-firefox-theme.changes" > "$out/lyra-firefox-theme.changes"
( cd "$out" && sha256sum "lyra-firefox-theme-$version.tar.zst" \
    "theme@lyraos.com.br-$version.xpi" lyra-firefox-theme.spec lyra-firefox-theme.changes > SHA256SUMS )
