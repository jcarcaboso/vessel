import json
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

import release

spec = importlib.util.spec_from_file_location('verify_release', Path(__file__).with_name('verify-release.py'))
verify_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_release)

REVISION = 'a' * 40


def write_release(root, version='1.2.3', **overrides):
    files = {
        'frontend/package.json': json.dumps({'name': 'vessel-frontend', 'version': version}),
        'backend/Directory.Build.props': f'<Project><PropertyGroup><Version>{version}</Version></PropertyGroup></Project>',
        'backend/Dockerfile': f'FROM a AS build\nARG VERSION={version}\nFROM b\nARG VERSION={version}\n',
        'frontend/Dockerfile': f'FROM c\nARG VERSION={version}\n',
        'deploy/compose.yaml': f'image: skorcius/vessel:api-${{VESSEL_VERSION:-{version}}}\n'
                               f'image: skorcius/vessel:web-${{VESSEL_VERSION:-{version}}}\n',
        'deploy/.env.example': f'VESSEL_VERSION={version}\n',
        'CHANGELOG.md': f'# Changelog\n\n## Unreleased\n\n## {version} - October 15, 2026\n',
        f'docs/releases/v{version}.md': 'Notes.\n',
    }
    files.update(overrides)
    for path, text in files.items():
        if text is None:
            continue
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)


def image(version='1.2.3', revision=REVISION, platform=('linux', 'amd64')):
    return {'os': platform[0], 'architecture': platform[1], 'config': {'Labels': {
        'org.opencontainers.image.version': version, 'org.opencontainers.image.revision': revision}}}


class ReleaseCheckTests(unittest.TestCase):
    def check(self, tag=None, **overrides):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_release(root, **overrides)
            return release.check(root, tag)

    def test_repository_versions_agree_and_have_notes(self):
        version = release.check(release.ROOT)
        self.assertRegex(version, r'^\d+\.\d+\.\d+$')

    def test_consistent_release_with_matching_tag(self):
        self.assertEqual('1.2.3', self.check(tag='v1.2.3'))

    def test_any_disagreeing_file_is_named(self):
        with self.assertRaisesRegex(release.ReleaseError, 'frontend/Dockerfile: 1.2.4'):
            self.check(**{'frontend/Dockerfile': 'ARG VERSION=1.2.4\n'})
        with self.assertRaisesRegex(release.ReleaseError, 'deploy/compose.yaml'):
            self.check(**{'deploy/compose.yaml': 'image: skorcius/vessel:api-${VESSEL_VERSION:-1.2.3}\n'
                                                 'image: skorcius/vessel:web-${VESSEL_VERSION:-1.2.2}\n'})

    def test_missing_version_is_reported(self):
        with self.assertRaisesRegex(release.ReleaseError, 'No version found in deploy/.env.example'):
            self.check(**{'deploy/.env.example': 'VESSEL_WEB_BIND=127.0.0.1:8080\n'})

    def test_tag_must_match_the_packaged_version(self):
        with self.assertRaisesRegex(release.ReleaseError, 'Tag v1.2.4 does not match'):
            self.check(tag='v1.2.4')

    def test_changelog_section_and_notes_are_required(self):
        with self.assertRaisesRegex(release.ReleaseError, 'CHANGELOG.md has no'):
            self.check(**{'CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- 1.2.3 soon\n'})
        with self.assertRaisesRegex(release.ReleaseError, 'v1.2.3.md are missing or empty'):
            self.check(**{'docs/releases/v1.2.3.md': None})
        with self.assertRaisesRegex(release.ReleaseError, 'v1.2.3.md are missing or empty'):
            self.check(**{'docs/releases/v1.2.3.md': '\n'})

    def test_non_semantic_versions_are_rejected(self):
        with self.assertRaisesRegex(release.ReleaseError, 'is not MAJOR.MINOR.PATCH'):
            self.check(version='1.2')


class ReleasePublishTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.registry = {}

    def fake_docker(self, *args, capture=False):
        self.calls.append((args[0], args[args.index('-t') + 1] if args[0] == 'build' else args[-1]))
        if args[0] == 'image':
            return json.dumps([{'Os': 'linux', 'Architecture': 'amd64', 'Config': image()['config']}])
        if args[0] == 'push':
            ref = args[-1]
            versioned = ref.replace('-latest', '-1.2.3')
            self.registry[ref] = {'digest': 'sha256:' + versioned.rsplit(':', 1)[1], 'image': image()}
        return None

    def publish(self):
        with patch.object(release, 'docker', self.fake_docker), \
                patch.object(release, 'remote', lambda ref: self.registry.get(ref)), \
                patch.dict('os.environ', {'GITHUB_STEP_SUMMARY': ''}), patch('builtins.print'):
            return release.publish(Path('/source'), '1.2.3', REVISION, 'example/vessel')

    def test_latest_moves_only_after_both_versioned_tags_are_pushed(self):
        digests = self.publish()
        self.assertEqual({'api': 'sha256:api-1.2.3', 'web': 'sha256:web-1.2.3'}, digests)
        pushes = [ref for command, ref in self.calls if command == 'push']
        self.assertEqual(['example/vessel:api-1.2.3', 'example/vessel:web-1.2.3',
                          'example/vessel:api-latest', 'example/vessel:web-latest'], pushes)

    def test_a_version_published_from_another_revision_is_never_overwritten(self):
        self.registry['example/vessel:web-1.2.3'] = {'digest': 'sha256:old', 'image': image(revision='b' * 40)}
        with self.assertRaisesRegex(release.ReleaseError, 'never overwritten'):
            self.publish()
        self.assertEqual([], [call for call in self.calls if call[0] in ('build', 'push')])

    def test_a_version_from_the_same_revision_is_reused_not_rebuilt(self):
        self.registry['example/vessel:api-1.2.3'] = {'digest': 'sha256:api-1.2.3', 'image': image()}
        self.publish()
        self.assertIn(('pull', 'example/vessel:api-1.2.3'), self.calls)
        self.assertNotIn(('build', 'example/vessel:api-1.2.3'), self.calls)
        self.assertIn(('build', 'example/vessel:web-1.2.3'), self.calls)

    def test_metadata_rejects_another_platform_or_version(self):
        with self.assertRaisesRegex(release.ReleaseError, 'linux/arm64, not linux/amd64'):
            release.expect_metadata('ref', image(platform=('linux', 'arm64')), '1.2.3')
        with self.assertRaisesRegex(release.ReleaseError, "labelled version '1.2.2'"):
            release.expect_metadata('ref', image(version='1.2.2'), '1.2.3')


class WalletReleaseTests(unittest.TestCase):
    def check(self, *args):
        check = verify_release.Check(verify_release.parse_args(list(args)))
        self.addCleanup(shutil.rmtree, check.temp)
        return check

    def test_token_remains_the_default_and_uses_only_a_bearer(self):
        check = self.check()
        self.assertFalse(check.wallet)
        self.assertEqual({'Authorization': 'Bearer ' + check.token}, check.auth_headers())
        self.assertEqual({}, check.auth_headers(False))

    def test_wallet_headers_never_send_the_token_and_bind_the_owner(self):
        check = self.check('--auth', 'wallet')
        check.tls = True
        check.session_cookie = '__Host-vessel-session=synthetic'
        headers = check.auth_headers()
        self.assertNotIn('Authorization', headers)
        self.assertEqual(check.owner, headers['X-Vessel-User'])
        self.assertEqual(check.session_cookie, headers['Cookie'])
        self.assertEqual(check.url, headers['Origin'])
        self.assertEqual('1', headers['X-Vessel-Request'])
        self.assertNotIn('Cookie', check.auth_headers(False))

    def test_wallet_compose_applies_overlay_to_every_command_and_ignores_caller_secrets(self):
        check = self.check('--auth', 'wallet')
        check.tls = True
        with patch.object(verify_release, 'run') as run, patch.dict('os.environ', {'Vessel__Auth__Token': 'caller-secret'}):
            check.compose('config')
        args = run.call_args.args
        self.assertIn(str(check.temp / 'compose.wallet.yaml'), args)
        self.assertIn(str(check.temp / 'compose.tls.yaml'), args)
        self.assertNotIn('Vessel__Auth__Token', run.call_args.kwargs['env'])

    def test_cookie_assertions_require_every_host_cookie_attribute(self):
        check = self.check('--auth', 'wallet')
        name = '__Host-vessel-session'
        value = name + '=synthetic; Path=/; Secure; HttpOnly; SameSite=Strict'
        with patch('builtins.print'):
            self.assertEqual(name + '=synthetic', check.cookie([('Set-Cookie', value)], name))
            for missing in ('; Path=/', '; Secure', '; HttpOnly', '; SameSite=Strict'):
                with self.assertRaises(AssertionError, msg=missing):
                    check.cookie([('Set-Cookie', value.replace(missing, ''))], name)
            with self.assertRaises(AssertionError):
                check.cookie([('Set-Cookie', value + '; Domain=localhost')], name)

    def test_bootstrap_requires_no_wallet_readiness_before_binding_synthetic_operator(self):
        check = self.check('--auth', 'wallet')
        check.compose = Mock(return_value=Mock(stdout='{"reason":"no-operator-wallet"}'))
        check.identity = Mock()
        check.wallet_signature = Mock(return_value={'address': '0x' + '1' * 40})
        with patch('builtins.print'):
            check.wallet_bootstrap()
        self.assertIn(('run', '--rm', 'migrate'), [call.args for call in check.compose.call_args_list])
        check.identity.assert_called_once_with('bind-wallet', '--user', check.owner, '--address', '0x' + '1' * 40)


if __name__ == '__main__':
    unittest.main()
