# The payload is static, but distribution integration targets x86_64 Firefox.
%global firefox_dist /usr/lib64/firefox/distribution

Name:           lyra-firefox-theme
Version:        0.1.0
Release:        0
Summary:        Lyra OS light and dark theme for Firefox
License:        GPL-3.0-or-later
URL:            https://github.com/lyra-os-linux/lyra-firefox-ext
Source0:        %{name}-%{version}.tar.zst
Source1:        theme@lyraos.com.br-%{version}.xpi
BuildRequires:  python3
BuildRequires:  zstd
ExclusiveArch:  x86_64
Requires:       MozillaFirefox >= 140

%description
Standalone static Firefox theme with light and dark palettes and English,
Portuguese and Spanish metadata. Contains no scripts or permissions.
Firefox discovers the theme through its distribution extensions directory.
It is available for selection without replacing the current theme. Users retain the
ability to select another theme or remove this one.

%prep
%autosetup

%build
# The Mozilla-signed XPI must not be rebuilt or modified.

%install
install -Dm0644 %{SOURCE1} %{buildroot}%{_datadir}/%{name}/theme@lyraos.com.br.xpi

install -d %{buildroot}%{firefox_dist}/extensions
ln -s %{_datadir}/%{name}/theme@lyraos.com.br.xpi %{buildroot}%{firefox_dist}/extensions/theme@lyraos.com.br.xpi

%check
python3 theme/scripts/verify.py --source theme/static --xpi %{SOURCE1}
python3 -c 'import json; assert json.load(open("theme/static/manifest.json"))["version"] == "%{version}"'

%files
%license LICENSE
%doc theme/README.md
%{_datadir}/%{name}/
%dir /usr/lib64/firefox
%dir %{firefox_dist}
%dir %{firefox_dist}/extensions
%{firefox_dist}/extensions/theme@lyraos.com.br.xpi

%changelog
