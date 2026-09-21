#
# spec file for package lyra-firefox-ext
#
# Copyright (c) 2026 Rodrigo Brito
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#

%global ext_id lyra-downloads@lyraos.com.br

Name:           lyra-firefox-ext
Version:        0.1.2
Release:        0
Summary:        Lyra Downloads integration extension for Firefox
License:        GPL-3.0-or-later
Group:          Productivity/Networking/Web/Browsers
URL:            https://github.com/lyra-os-linux/lyra-firefox-ext
# Código-fonte correspondente (git archive da revisão assinada).
Source0:        %{name}-%{version}.tar.zst
# XPI assinado pela Mozilla (AMO, canal unlisted) gerado por scripts/sign.sh
# a partir da mesma revisão; não pode ser reconstruído no OBS sem invalidar
# a assinatura.
Source1:        %{ext_id}-%{version}.xpi
# Comprovante de revisão, fontes e conteúdo conferidos na assinatura.
Source2:        %{ext_id}-%{version}.provenance.json
BuildRequires:  python3
BuildRequires:  unzip
BuildRequires:  zstd
Requires:       MozillaFirefox >= 140
Requires:       lyra-downloads-firefox-integration >= 0.1.1
BuildArch:      noarch

%description
Firefox extension that sends downloads to Lyra Downloads through its native
messaging host. The package ships the Mozilla-signed XPI in
%{_datadir}/%{name}; Lyra OS installs it through a Firefox enterprise policy
(ExtensionSettings) provided by the desktop image.

%prep
%autosetup -p1

%build
# Nada a compilar: o artefato distribuído é o XPI assinado (Source1).

%install
install -D -m 0644 %{SOURCE1} %{buildroot}%{_datadir}/%{name}/%{ext_id}.xpi

%check
python3 scripts/verify-xpi.py verify --source . \
    --xpi %{SOURCE1} --receipt %{SOURCE2}
xpi=%{buildroot}%{_datadir}/%{name}/%{ext_id}.xpi
unzip -l "$xpi" | grep -Eq 'META-INF/(mozilla\.rsa|cose\.sig)'
unzip -p "$xpi" manifest.json | python3 -c '
import json, sys
m = json.load(sys.stdin)
assert m["browser_specific_settings"]["gecko"]["id"] == "%{ext_id}", "id"
assert m["version"] == "%{version}", "version"
'
# O manifesto do XPI assinado deve ter o mesmo conteúdo JSON da revisão
# empacotada (o AMO só reformata o arquivo).
unzip -p "$xpi" manifest.json > signed-manifest.json
python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1])) != json.load(open(sys.argv[2])))' \
    signed-manifest.json static/manifest.json

%files
%license LICENSE
%doc README.md
%dir %{_datadir}/%{name}
%{_datadir}/%{name}/%{ext_id}.xpi

%changelog
