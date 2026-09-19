#!/usr/bin/env python3
"""Bind an AMO artifact to its source revision and complete built payload.

The receipt records content integrity/provenance; Firefox verifies the Mozilla
signature cryptographically when installing. No credentials are handled here.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(name, data):
    if name == "manifest.json":
        return json.dumps(json.loads(data), sort_keys=True, separators=(",", ":")).encode()
    return data


def source_hashes(root):
    files = [root / p for p in ("package.json", "package-lock.json", "tsconfig.json")]
    for directory in ("src", "static", "scripts"):
        files.extend(p for p in (root / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    return {p.relative_to(root).as_posix(): digest(p.read_bytes()) for p in sorted(files)}


def xpi_payload(xpi):
    with zipfile.ZipFile(xpi) as archive:
        names = archive.namelist()
        if len(set(names)) != len(names):
            raise ValueError("XPI contém entradas duplicadas")
        if not {"META-INF/mozilla.rsa", "META-INF/cose.sig"}.intersection(names):
            raise ValueError("XPI sem arquivos de assinatura Mozilla")
        payload = {}
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("caminho inválido no XPI")
            if name.endswith("/") or name.startswith("META-INF/"):
                continue
            payload[name] = digest(canonical(name, archive.read(name)))
        return payload


def build_payload(dist):
    return {
        p.relative_to(dist).as_posix(): digest(canonical(p.relative_to(dist).as_posix(), p.read_bytes()))
        for p in dist.rglob("*") if p.is_file() and p.relative_to(dist).as_posix() != ".amo-upload-uuid"
    }


def verify(root, xpi, receipt, revision):
    if receipt.get("schema") != 1 or receipt.get("source_revision") != revision:
        raise ValueError("XPI foi assinado para outra revisão; gere um novo artefato")
    if receipt.get("sources") != source_hashes(root):
        raise ValueError("fontes diferem da revisão usada para assinar o XPI")
    if receipt.get("xpi_sha256") != digest(xpi.read_bytes()):
        raise ValueError("hash do XPI difere do artefato assinado")
    if receipt.get("payload") != xpi_payload(xpi):
        raise ValueError("conteúdo do XPI difere do build verificado")
    with zipfile.ZipFile(xpi) as archive:
        signed = json.loads(archive.read("manifest.json"))
    if signed != json.loads((root / "static/manifest.json").read_text()):
        raise ValueError("manifesto assinado difere das fontes")
    version = signed["version"]
    if json.loads((root / "package.json").read_text())["version"] != version:
        raise ValueError("package.json e manifesto têm versões diferentes")


def record(root, xpi, dist, revision):
    payload = xpi_payload(xpi)
    if payload != build_payload(dist):
        raise ValueError("conteúdo assinado difere do build local")
    receipt = {
        "schema": 1, "source_revision": revision,
        "sources": source_hashes(root), "payload": payload,
        "xpi_sha256": digest(xpi.read_bytes()),
    }
    verify(root, xpi, receipt, revision)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["record", "verify"])
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--xpi", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--revision")
    parser.add_argument("--dist", type=Path)
    args = parser.parse_args()
    try:
        revision = args.revision or (args.source / ".source-revision").read_text().strip()
        if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
            raise ValueError("revisão Git inválida")
        if args.mode == "record":
            if args.dist is None:
                raise ValueError("--dist obrigatório ao registrar assinatura")
            receipt = record(args.source, args.xpi, args.dist, revision)
            args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        else:
            verify(args.source, args.xpi, json.loads(args.receipt.read_text()), revision)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"erro: {error}\n")


if __name__ == "__main__":
    main()
