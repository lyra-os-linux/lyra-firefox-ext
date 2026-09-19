#!/usr/bin/env bash
# Prepara as fontes do OBS: tarball determinístico da revisão (código-fonte
# correspondente, GPL) + o XPI assinado gerado por scripts/sign.sh na MESMA
# revisão. O build RPM não compila nada: instala o XPI assinado.
#
# Uso: packaging/obs/make-sources.sh [REVISÃO]   (padrão: HEAD)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="${OUT_DIR:-$repo_root/packaging/obs/out}"
cd "$repo_root"

rev="$(git rev-parse --verify "${1:-HEAD}^{commit}")"
version="$(git show "$rev:static/manifest.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["version"])')"
id="$(git show "$rev:static/manifest.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["browser_specific_settings"]["gecko"]["id"])')"
name="lyra-firefox-ext-$version"
xpi="$out_dir/$id-$version.xpi"
receipt="$out_dir/$id-$version.provenance.json"
[[ -f "$xpi" ]] || { echo "erro: $xpi ausente; rode scripts/sign.sh nesta revisão" >&2; exit 2; }
[[ -f "$receipt" ]] || { echo "erro: comprovante de assinatura ausente: $receipt" >&2; exit 2; }

export SOURCE_DATE_EPOCH="$(git log -1 --format=%ct "$rev")"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/$name"
git archive --format=tar "$rev" | tar -xf - -C "$work/$name"
echo "$rev" > "$work/$name/.source-revision"
python3 "$work/$name/scripts/verify-xpi.py" verify --source "$work/$name" \
    --xpi "$xpi" --receipt "$receipt"
tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
    --pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime \
    -C "$work" -cf - "$name" | zstd -q -19 -T0 --no-progress -o "$out_dir/$name.tar.zst" -f

git show "$rev:packaging/obs/lyra-firefox-ext.spec" > "$out_dir/lyra-firefox-ext.spec"
git show "$rev:packaging/obs/lyra-firefox-ext.changes" > "$out_dir/lyra-firefox-ext.changes"
( cd "$out_dir" && sha256sum "$name.tar.zst" "$(basename "$xpi")" "$(basename "$receipt")" > SHA256SUMS )
echo "fontes em $out_dir:"; ls -l "$out_dir"
