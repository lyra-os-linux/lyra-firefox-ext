#!/usr/bin/env bash
# Assina a extensão pelo AMO (canal "unlisted", self-distribution) a partir de
# uma revisão Git limpa e confere que o XPI assinado contém exatamente os
# arquivos do build local (fora META-INF, acrescentado pela Mozilla).
#
# Credenciais da API do AMO (https://addons.mozilla.org/developers/addon/api/key/)
# vêm de um arquivo local, nunca da linha de comando nem do repositório:
#   ${AMO_CREDENTIALS:-~/.config/lyra/amo.env}  com
#   AMO_JWT_ISSUER=user:...
#   AMO_JWT_SECRET=...
# (chmod 600). O AMO não aceita reenviar uma versão já assinada: cada
# assinatura exige nova "version" em static/manifest.json e package.json.
#
# Resultado: packaging/obs/out/lyra-downloads@lyraos.com.br-<versão>.xpi
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

creds="${AMO_CREDENTIALS:-$HOME/.config/lyra/amo.env}"
[[ -r "$creds" ]] || { echo "erro: credenciais do AMO ausentes em $creds" >&2; exit 2; }
if [[ -n "$(git status --porcelain)" ]]; then
    echo "erro: árvore com alterações; assine a partir de um commit limpo" >&2
    exit 2
fi

id="$(python3 -c 'import json;print(json.load(open("static/manifest.json"))["browser_specific_settings"]["gecko"]["id"])')"
version="$(python3 -c 'import json;print(json.load(open("static/manifest.json"))["version"])')"
pkg_version="$(python3 -c 'import json;print(json.load(open("package.json"))["version"])')"
[[ "$version" == "$pkg_version" ]] || { echo "erro: manifest $version != package.json $pkg_version" >&2; exit 2; }

npm ci
npm test
npm run lint

set -a; . "$creds"; set +a
[[ -n "${AMO_JWT_ISSUER:-}" && -n "${AMO_JWT_SECRET:-}" ]] || { echo "erro: AMO_JWT_ISSUER/AMO_JWT_SECRET vazios" >&2; exit 2; }
rm -rf artifacts
WEB_EXT_API_KEY="$AMO_JWT_ISSUER" WEB_EXT_API_SECRET="$AMO_JWT_SECRET" \
    npx web-ext sign --channel=unlisted --source-dir dist --artifacts-dir artifacts
unset AMO_JWT_ISSUER AMO_JWT_SECRET

shopt -s nullglob
signed=(artifacts/*.xpi)
[[ ${#signed[@]} -eq 1 ]] || { echo "erro: esperado 1 XPI assinado, achei ${#signed[@]}" >&2; exit 2; }

check="$(mktemp -d)"; trap 'rm -rf "$check"' EXIT
unzip -q "${signed[0]}" -d "$check"
[[ -f "$check/META-INF/mozilla.rsa" || -f "$check/META-INF/cose.sig" ]] || { echo "erro: XPI sem assinatura Mozilla" >&2; exit 2; }
rm -rf "$check/META-INF"
# O AMO reformata o manifest.json (mesmo conteúdo JSON); o web-ext deixa
# .amo-upload-uuid em dist, fora do XPI. Todo o resto deve ser idêntico.
diff -r --exclude=manifest.json --exclude=.amo-upload-uuid dist "$check" \
    || { echo "erro: conteúdo assinado difere do build local" >&2; exit 2; }
python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' \
    dist/manifest.json "$check/manifest.json" \
    || { echo "erro: manifest.json assinado difere do build local" >&2; exit 2; }

out="packaging/obs/out"; mkdir -p "$out"
cp "${signed[0]}" "$out/$id-$version.xpi"
( cd "$out" && sha256sum "$id-$version.xpi" )
echo "revisão: $(git rev-parse HEAD)"
