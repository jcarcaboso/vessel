#!/usr/bin/env python3
"""Release metadata checks and image publication for Vessel.

`check` confirms that every packaged version agrees and that the version has a
changelog entry and release notes. `publish` builds the Linux amd64 API and web
images from one commit, pushes both versioned tags, then moves both latest tags
and verifies all four remotely. It never overwrites a versioned tag published
from another revision. Registry authentication is the caller's Docker login;
this script never reads, prints or stores credentials.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
IMAGE = 'skorcius/vessel'
DOCKERFILES = {'api': 'backend/Dockerfile', 'web': 'frontend/Dockerfile'}
SEMVER = re.compile(r'\d+\.\d+\.\d+')


class ReleaseError(Exception):
    pass


def packaged_versions(root):
    """Every place that states the release version, with what it states."""
    def matches(path, pattern):
        return re.findall(pattern, (root / path).read_text(), re.MULTILINE)

    found = {'frontend/package.json': [json.loads((root / 'frontend/package.json').read_text()).get('version')]}
    found['backend/Directory.Build.props'] = matches('backend/Directory.Build.props', r'<Version>([^<]*)</Version>')
    for file in DOCKERFILES.values():
        found[file] = matches(file, r'^ARG VERSION=(\S*)$')
    found['deploy/compose.yaml'] = matches('deploy/compose.yaml', r'vessel:(?:api|web)-\$\{VESSEL_VERSION:-([^}]*)\}')
    found['deploy/.env.example'] = matches('deploy/.env.example', r'^VESSEL_VERSION=(\S*)$')
    return found


def check(root, tag=None):
    found = packaged_versions(root)
    missing = sorted(path for path, values in found.items() if not values)
    if missing:
        raise ReleaseError('No version found in ' + ', '.join(missing))
    distinct = {value for values in found.values() for value in values}
    if len(distinct) != 1:
        detail = '; '.join(f'{path}: {", ".join(map(str, values))}' for path, values in sorted(found.items()))
        raise ReleaseError('Packaged versions disagree: ' + detail)
    version = distinct.pop()
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        raise ReleaseError(f'Version {version!r} is not MAJOR.MINOR.PATCH')
    if tag is not None and tag != f'v{version}':
        raise ReleaseError(f'Tag {tag} does not match packaged version {version}')
    if not re.search(rf'^## {re.escape(version)} - ', (root / 'CHANGELOG.md').read_text(), re.MULTILINE):
        raise ReleaseError(f'CHANGELOG.md has no "## {version} - <date>" section')
    notes = root / 'docs' / 'releases' / f'v{version}.md'
    if not notes.is_file() or not notes.read_text().strip():
        raise ReleaseError(f'Release notes {notes.relative_to(root)} are missing or empty')
    return version


def docker(*args, capture=False):
    result = subprocess.run(['docker', *args], text=True, capture_output=capture)
    if result.returncode != 0:
        detail = (result.stderr or '').strip().splitlines()[-1:] if capture else []
        raise ReleaseError(f'docker {args[0]} {args[1] if len(args) > 1 else ""} failed' + (f': {detail[0]}' if detail else ''))
    return result.stdout if capture else None


def remote(ref):
    """The manifest digest and linux/amd64 image config of a remote tag, or None when the tag does not exist."""
    result = subprocess.run(['docker', 'buildx', 'imagetools', 'inspect', ref, '--format', '{{json .}}'],
                            text=True, capture_output=True)
    if result.returncode != 0:
        if 'not found' in result.stderr:
            return None
        raise ReleaseError(f'Could not inspect {ref}: ' + (result.stderr.strip().splitlines() or ['unknown error'])[-1])
    info = json.loads(result.stdout)
    image = info.get('image') or {}
    if 'architecture' not in image:
        image = image.get('linux/amd64') or {}
    return {'digest': info['manifest']['digest'], 'image': image}


def expect_metadata(ref, image, version, revision=None):
    labels = (image.get('config') or {}).get('Labels') or {}
    platform = f'{image.get("os")}/{image.get("architecture")}'
    if platform != 'linux/amd64':
        raise ReleaseError(f'{ref} is {platform}, not linux/amd64')
    if labels.get('org.opencontainers.image.version') != version:
        raise ReleaseError(f'{ref} is labelled version {labels.get("org.opencontainers.image.version")!r}, not {version}')
    if revision is not None and labels.get('org.opencontainers.image.revision') != revision:
        raise ReleaseError(f'{ref} was built from {labels.get("org.opencontainers.image.revision")!r}, not {revision}')
    return labels.get('org.opencontainers.image.revision')


def publish(root, version, revision, image=IMAGE):
    versioned = {kind: f'{image}:{kind}-{version}' for kind in DOCKERFILES}
    latest = {kind: f'{image}:{kind}-latest' for kind in DOCKERFILES}
    reused = []
    for kind, ref in versioned.items():
        existing = remote(ref)
        if existing is None:
            continue
        published = expect_metadata(ref, existing['image'], version)
        if published != revision:
            raise ReleaseError(f'{ref} already exists from revision {published}; a published version is never overwritten')
        print(f'{ref} is already published from this revision; reusing it.', flush=True)
        reused.append(kind)

    for kind, file in DOCKERFILES.items():
        if kind in reused:
            docker('pull', '--quiet', '--platform', 'linux/amd64', versioned[kind])
            continue
        # Attestations would wrap the image in an index; keep the single amd64 manifest of earlier releases.
        docker('build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false', '-f', str(root / file),
               '--build-arg', f'VERSION={version}', '--build-arg', f'REVISION={revision}', '-t', versioned[kind], str(root))
        local = json.loads(docker('image', 'inspect', versioned[kind], capture=True))[0]
        expect_metadata(versioned[kind], {'os': local['Os'], 'architecture': local['Architecture'], 'config': local['Config']},
                        version, revision)

    for kind in DOCKERFILES:
        if kind not in reused:
            docker('push', '--quiet', versioned[kind])
    digests = {}
    for kind, ref in versioned.items():
        published = remote(ref)
        if published is None:
            raise ReleaseError(f'{ref} is missing after its push')
        expect_metadata(ref, published['image'], version, revision)
        digests[kind] = published['digest']

    # Latest moves only after both versioned tags are verified remotely. Tag and push, rather than a registry-side
    # copy, so the moving tag keeps the versioned manifest digest instead of a new index.
    for kind in DOCKERFILES:
        docker('tag', versioned[kind], latest[kind])
        docker('push', '--quiet', latest[kind])
    for kind, ref in latest.items():
        moved = remote(ref)
        if moved is None or moved['digest'] != digests[kind]:
            raise ReleaseError(f'{ref} does not resolve to {versioned[kind]} ({digests[kind]})')

    lines = [f'| `{versioned[kind]}` and `{latest[kind]}` | `{digests[kind]}` |' for kind in DOCKERFILES]
    summary = '\n'.join([f'### Published {image} {version}', '', '| Tags | Digest |', '| --- | --- |', *lines,
                         '', f'Revision `{revision}`, linux/amd64.', ''])
    print(summary, flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as handle:
            handle.write(summary)
    return digests


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    checking = commands.add_parser('check', help='Check packaged versions, changelog and release notes.')
    checking.add_argument('--tag', help='Also require this Git tag to be v<version>.')
    publishing = commands.add_parser('publish', help='Build, push and verify both images, then move both latest tags.')
    publishing.add_argument('--revision', required=True, help='Full commit SHA the images are built from.')
    publishing.add_argument('--image', default=IMAGE, help=f'Repository to publish to (default {IMAGE}).')
    args = parser.parse_args(argv)
    try:
        version = check(ROOT, getattr(args, 'tag', None))
        if args.command == 'check':
            print(version)
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a') as handle:
                    handle.write(f'version={version}\n')
        else:
            if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
                raise ReleaseError('--revision must be a full commit SHA')
            publish(ROOT, version, args.revision, args.image)
    except ReleaseError as error:
        print(f'::error::{error}' if os.environ.get('GITHUB_ACTIONS') else f'error: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
