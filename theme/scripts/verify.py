#!/usr/bin/env python3
"""Verify a signed static theme against every source payload file."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def payload(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob('*') if p.is_file() and p.name != '.amo-upload-uuid'}


def canonical(name, value):
    return json.dumps(json.loads(value), sort_keys=True).encode() if name.endswith('.json') else value


def verify(source, xpi):
    expected = payload(source)
    with zipfile.ZipFile(xpi) as z:
        names = z.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive entry')
        if not {'META-INF/mozilla.rsa', 'META-INF/cose.sig'}.intersection(names):
            raise ValueError('Missing Mozilla signature files; Firefox must also verify the signature')
        actual = {}
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe archive path')
            if name.endswith('/') or name.startswith('META-INF/'):
                continue
            actual[name] = z.read(name)
    if set(actual) != set(expected):
        raise ValueError('Signed payload file list differs from sources')
    for name in expected:
        if canonical(name, expected[name]) != canonical(name, actual[name]):
            raise ValueError(f'Signed payload differs: {name}')
    return {'xpi_sha256': hashlib.sha256(xpi.read_bytes()).hexdigest(), 'payload_sha256': {name: hashlib.sha256(canonical(name, data)).hexdigest() for name, data in sorted(actual.items())}}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--xpi', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(verify(a.source, a.xpi), indent=2))
