# Lyra Firefox Extension

Extensão do Firefox que envia downloads ao [Lyra Downloads](https://github.com/lyra-os-linux/lyra-downloads)
pelo native messaging host `org.lyraos.downloads`.

- ID: `lyra-downloads@lyraos.com.br` (definitivo; não muda após a primeira
  assinatura da Mozilla). Precisa ser igual ao `allowed_extensions` do
  manifesto do native host, gerado pelo spec do lyra-downloads.
- Firefox mínimo: 140 (ESR do openSUSE Leap 16).
- Histórico importado de `extensions/firefox` do repositório lyra-downloads.

## Desenvolvimento

```sh
npm ci
npm test        # compila o TypeScript e testa lógica e empacotamento
npm run lint    # web-ext lint
```

Para testar sem assinatura: `about:debugging#/runtime/this-firefox` →
"Carregar extensão temporária…" → `dist/manifest.json`. O native host precisa
estar instalado (`lyra-downloads-firefox-integration`) ou registrado com
`scripts/install-native-host.sh` do lyra-downloads.

## Assinatura

O Firefox de lançamento só carrega extensões assinadas pela Mozilla. A
distribuição é **não listada** (self-distribution) pelo AMO:

```sh
scripts/sign.sh
```

O script exige árvore limpa, roda testes e lint, assina com
`web-ext sign --channel=unlisted` usando as credenciais de
`~/.config/lyra/amo.env` (`AMO_JWT_ISSUER`/`AMO_JWT_SECRET`, `chmod 600`) e
confere que o XPI assinado tem exatamente os arquivos do build local. O AMO não
reassina uma versão: cada lançamento precisa de nova `version` em
`static/manifest.json`, `package.json`, `package-lock.json` e no spec.
Os testes de empacotamento também requerem Python 3, Git, tar e zstd.

## Pacote RPM / OBS

`packaging/obs/make-sources.sh [REVISÃO]` gera em `packaging/obs/out/` o
tarball de fontes da revisão e copia spec/changes; o XPI assinado precisa ter
sido gerado antes na mesma revisão. `sign.sh` também grava
`<ID>-<versão>.provenance.json`, com a revisão Git e hashes das fontes,
dependências, scripts de build, XPI e de todos os arquivos compilados.
O gerador rejeita revisão/arquivo divergente ou comprovante ausente antes de
produzir o tarball. Mudanças após a assinatura exigem uma nova versão assinada.
O RPM `lyra-firefox-ext` (noarch) instala:

```
/usr/share/lyra-firefox-ext/lyra-downloads@lyraos.com.br.xpi
```

O `%check` confere a proveniência, o conteúdo completo do XPI, seus arquivos
de assinatura, ID, versão e manifesto. A verificação criptográfica da
assinatura Mozilla é feita pelo Firefox na instalação.

A ativação no Firefox é feita pela política do Lyra Desktop
(`/usr/lib64/firefox/distribution/policies.json`, overlay da imagem), não por
este pacote, porque o Firefox lê um único arquivo de políticas:

```json
"ExtensionSettings": {
  "lyra-downloads@lyraos.com.br": {
    "installation_mode": "normal_installed",
    "install_url": "file:///usr/share/lyra-firefox-ext/lyra-downloads@lyraos.com.br.xpi"
  }
}
```

## Recuperação de repasses

A partir de 0.1.1, o pacote exige `lyra-downloads-firefox-integration >= 0.1.1`.
Depois de uma resposta perdida, o Firefox permanece pausado até o backend
confirmar a revogação persistente da requisição e a parada da tarefa. Um
backend antigo sem essa confirmação também mantém o estado pendente.
O popup oferece **Recuperar no Firefox** para repetir a verificação. Se o Lyra
já concluiu o arquivo, a extensão apenas remove a cópia do Firefox.

Entradas e proteções contra recaptura são mantidas em `storage.session`,
restauradas ao acordar a página de fundo e consultadas antes de responder ao
popup. Isso cobre a suspensão da extensão durante a sessão do navegador;
o armazenamento da sessão é apagado ao fechar o Firefox.

## Licença

GPL-3.0-or-later.
