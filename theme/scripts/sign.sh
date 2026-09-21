#!/usr/bin/env bash
# Sign only the standalone static theme; never rebuild/re-sign Downloads here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit changes before signing.' >&2; exit 2; }
revision="$(git rev-parse HEAD)"
creds="${AMO_CREDENTIALS:-$HOME/.config/lyra/amo.env}"
[[ -r "$creds" ]] || { echo 'AMO credentials unavailable.' >&2; exit 2; }
version="$(python3 -c 'import json;print(json.load(open("theme/static/manifest.json"))["version"])')"
out="theme/out/$version"
[[ ! -e "$out" ]] || { echo 'Output already exists; do not overwrite a signed release.' >&2; exit 2; }
mkdir -p "$out"
cp -a theme/static "$out/source"
web_ext="${WEB_EXT_BIN:-./node_modules/.bin/web-ext}"
"$web_ext" lint --source-dir theme/static --self-hosted
set -a; . "$creds"; set +a
WEB_EXT_API_KEY="$AMO_JWT_ISSUER" WEB_EXT_API_SECRET="$AMO_JWT_SECRET" \
    "$web_ext" sign --channel unlisted --source-dir "$out/source" --artifacts-dir "$out"
unset AMO_JWT_ISSUER AMO_JWT_SECRET
shopt -s nullglob
signed=("$out"/*.xpi)
[[ ${#signed[@]} -eq 1 ]] || { echo 'Expected one signed XPI.' >&2; exit 2; }
[[ "$(git rev-parse HEAD)" == "$revision" && -z "$(git status --porcelain)" ]]
python3 theme/scripts/verify.py --source theme/static --xpi "${signed[0]}" > "$out/payload.json"
printf '%s\n' "$revision" > "$out/source-revision"
cp "${signed[0]}" "$out/theme@lyraos.com.br-$version.xpi"
echo "Signed theme $version from $revision"
