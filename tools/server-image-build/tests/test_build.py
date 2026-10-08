import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

DIRECTORY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('server_image_build', DIRECTORY / 'build.py')
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)


def plan():
    return {
        'repository': 'example/private-suite', 'sourceRevision': 'a' * 40,
        'bundleVersion': '0.1.0-rc.5', 'weaveVersion': '0.1.0', 'platform': 'linux/amd64',
        'components': {'forge': {'revision': 'b' * 40}, 'weave': {'revision': 'c' * 40}},
        'console': {'source': {'revision': 'd' * 40}, 'artifact': {'packagedTreeSha256': 'e' * 64},
                    'forge': {'runtimeImageReference': 'ghcr.io/example/runtime:17.5.0@sha256:' + 'f' * 64}},
        'tags': {name: 'ghcr.io/example/private-suite-' + name.lower() + ':0.1.0-rc.5-a'
                 for name in ('forge', 'forgeProxy', 'weave')},
    }


class BuildTests(unittest.TestCase):
    def source_plan_for_toolchain(self, node_version, pnpm_version='10.31.0'):
        value = plan()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            components = {
                name: {**component, 'importPath': build.EXPECTED_PATHS[name],
                       'source': 'https://github.com/example/' + name + '.git'}
                for name, component in value['components'].items()
            }
            (root / 'components.lock.json').write_text(json.dumps({'schemaVersion': 1, 'components': components}))
            console_file = root / 'platform/forge/apps/forge-objectstack/console94.lock.json'
            console_file.parent.mkdir(parents=True)
            console = {**value['console'], 'schemaVersion': 1, 'source': {
                **value['console']['source'], 'repository': 'https://github.com/example/objectui.git',
                'nodeVersion': node_version, 'pnpmVersion': pnpm_version,
            }}
            console_file.write_text(json.dumps(console))

            def source_git(*args):
                if args == ('rev-parse', 'HEAD'):
                    return value['sourceRevision']
                if args[0] == 'cat-file':
                    return ''
                if args[0] == 'rev-parse':
                    return 'f' * 40  # Each locked source tree matches its imported tree.
                if args == ('show', components['weave']['revision'] + ':VERSION'):
                    return value['weaveVersion']
                self.fail('Unexpected source-plan Git request')

            with patch.object(build, 'ROOT', root), patch.object(build, 'git', side_effect=source_git):
                result = build.source_plan(value['repository'], value['sourceRevision'], value['bundleVersion'])
                self.assertEqual(result['consoleLockSha256'], build.digest_file(console_file))
                self.assertEqual(result['components'], components)
                return result

    def test_source_plan_preserves_each_exact_reviewed_console_toolchain(self):
        for node_version in ('24.19.0', '24.21.0'):
            with self.subTest(node_version=node_version):
                result = self.source_plan_for_toolchain(node_version)
                self.assertEqual(result['console']['source']['nodeVersion'], node_version)
                self.assertEqual(result['console']['source']['pnpmVersion'], '10.31.0')

    def test_source_plan_rejects_unreviewed_node_and_changed_pnpm(self):
        for node_version, pnpm_version in [('24.20.0', '10.31.0'), ('24.21.1', '10.31.0'),
                                           ('25.0.0', '10.31.0'), ('latest', '10.31.0'),
                                           ('24.21.0', '10.32.0')]:
            with self.subTest(node_version=node_version, pnpm_version=pnpm_version):
                with self.assertRaisesRegex(build.BuildError, 'Console source/toolchain lock'):
                    self.source_plan_for_toolchain(node_version, pnpm_version)

    def test_reject_floating_or_credential_image_references(self):
        for value in ['postgres:latest', 'image@unknown', 'https://user:password@registry/image',
                      'registry/image:latest@sha256:' + 'a' * 64,
                      'registry/image:unknown@sha256:' + 'a' * 64,
                      'registry/../image@sha256:' + 'a' * 64]:
            with self.subTest(value=value), self.assertRaises(build.BuildError):
                build.validate_digest_reference(value)

    def test_postgres_only_official_major_16(self):
        for value in ['postgres:17', 'example/postgres:16', 'postgres:latest', 'postgres:16;echo unsafe']:
            with self.assertRaises(build.BuildError):
                build.postgres_reference(value)
        self.assertEqual(build.postgres_reference('postgres:16-bookworm'), 'postgres:16-bookworm')

    def test_built_commands_keep_exact_component_source_and_native_context(self):
        value = plan()
        for name in ('forge', 'forgeProxy', 'weave'):
            command = build.build_command(value, name, Path('/source'), Path('/console'), Path('/proof.json'))
            self.assertIn('linux/amd64', command)
            self.assertIn('--load', command)
            self.assertNotIn('--push', command)
            self.assertNotIn('--secret', command)
            self.assertNotIn('--refresh-lock', command)
            expected = value['components']['weave' if name == 'weave' else 'forge']['revision']
            self.assertIn('org.opencontainers.image.revision=' + expected, command)
            self.assertIn('org.opencontainers.image.source=https://github.com/example/private-suite', command)
        self.assertIn('console94=/console', build.build_command(value, 'forge', Path('/source'), Path('/console'), Path('/proof')))
        self.assertIn('WEAVE_VERSION=0.1.0', build.build_command(value, 'weave', Path('/source'), Path('/console'), Path('/proof')))

    def test_images_lock_uses_the_installers_exact_version_one_shape(self):
        value = plan()
        refs = {name: tag.split(':')[0] + '@sha256:' + 'a' * 64 for name, tag in value['tags'].items()}
        result = build.image_lock(value, refs, 'postgres@sha256:' + 'b' * 64)
        self.assertEqual(set(result), {'version', 'bundleVersion', 'components'})
        self.assertEqual(result['components']['postgres'], {'image': 'postgres@sha256:' + 'b' * 64, 'major': 16})
        self.assertEqual(result['components']['forge']['sourceRevision'], result['components']['forgeProxy']['sourceRevision'])
        installer = build.ROOT / 'tools/server-bundle'
        sys.path.insert(0, str(installer))
        try:
            from configuration import validate_images
            self.assertEqual(validate_images(result), result)
        finally:
            sys.path.remove(str(installer))

    def test_gate_rejects_incomplete_repository_or_public_package(self):
        api = build.Github('example/private-suite', token='test-only-not-a-credential')
        with patch.object(api, 'get', return_value={'private': False, 'visibility': 'public'}):
            with self.assertRaises(build.BuildError):
                api.repository_verified()
        private_repo = {'id': 77, 'private': True, 'visibility': 'private', 'full_name': 'example/private-suite', 'owner': {'type': 'User'}}
        with patch.object(api, 'get', side_effect=[private_repo, {'visibility': 'public', 'package_type': 'container'}]):
            with self.assertRaises(build.BuildError):
                api.package_private('ghcr.io/example/private-suite-forge:0.1.0')

    def test_public_source_keeps_private_package_and_identity_checks(self):
        api = build.Github('example/private-suite', token='test-only-not-a-credential')
        public_repo = {'id': 77, 'private': False, 'visibility': 'public', 'full_name': 'example/private-suite', 'owner': {'type': 'User'}}
        linked = {'id': 77, 'private': False, 'full_name': 'example/private-suite'}
        package = {'visibility': 'private', 'package_type': 'container', 'repository': linked}
        with patch.object(api, 'get', side_effect=[public_repo, package]):
            self.assertEqual(api.package_private('ghcr.io/example/private-suite-forge:0.1.0'), 'private')
        for changed in [{**package, 'visibility': 'public'}, {**package, 'repository': {**linked, 'id': 78}}, {**package, 'repository': {**linked, 'private': True}}]:
            with patch.object(api, 'get', side_effect=[public_repo, changed]), self.assertRaises(build.BuildError):
                api.package_private('ghcr.io/example/private-suite-forge:0.1.0')
        for changed in [{**public_repo, 'private': True}, {**public_repo, 'visibility': 'internal'}, {**public_repo, 'id': None}]:
            with patch.object(api, 'get', return_value=changed), self.assertRaises(build.BuildError):
                api.repository_verified()

    def test_private_gate_rejects_missing_package_or_conflicting_repository(self):
        api = build.Github('example/private-suite', token='test-only-not-a-credential')
        private_repo = {'id': 77, 'private': True, 'visibility': 'private', 'full_name': 'example/private-suite', 'owner': {'type': 'User'}}
        wrong_package = {'visibility': 'private', 'package_type': 'container', 'repository': {'private': True, 'full_name': 'example/other'}}
        with patch.object(api, 'get', side_effect=[private_repo, wrong_package]):
            with self.assertRaises(build.BuildError):
                api.package_private('ghcr.io/example/private-suite-forge:0.1.0')
        with patch.object(api, 'get', side_effect=[private_repo, None]):
            self.assertEqual(api.package_private('ghcr.io/example/private-suite-forge:0.1.0', missing=True), 'new-package')
        with patch.object(api, 'get', side_effect=[private_repo, None]):
            with self.assertRaises(build.BuildError):
                api.package_private('ghcr.io/example/private-suite-forge:0.1.0')

    def test_nullable_repository_metadata_does_not_replace_private_checks(self):
        api = build.Github('example/private-suite', token='test-only-not-a-credential')
        repo = {'id': 77, 'private': True, 'visibility': 'private', 'full_name': 'example/private-suite', 'owner': {'type': 'User'}}
        for package in [{'visibility': 'private', 'package_type': 'container'},
                        {'visibility': 'private', 'package_type': 'container', 'repository': None}]:
            with patch.object(api, 'get', side_effect=[repo, package]):
                self.assertEqual(api.package_private('ghcr.io/example/private-suite-forge:0.1.0'), 'private-association-not-reported')
        linked = {'id': 77, 'private': True, 'full_name': 'example/private-suite'}
        with patch.object(api, 'get', side_effect=[repo, {'visibility': 'private', 'package_type': 'container', 'repository': linked}]):
            self.assertEqual(api.package_private('ghcr.io/example/private-suite-forge:0.1.0'), 'private')
        for change in [{'id': 78}, {'private': False}, {'private': None}]:
            with patch.object(api, 'get', side_effect=[repo, {'visibility': 'private', 'package_type': 'container', 'repository': {**linked, **change}}]):
                with self.assertRaises(build.BuildError):
                    api.package_private('ghcr.io/example/private-suite-forge:0.1.0')

    def test_actual_oci_source_and_registry_configuration_are_bound(self):
        image_id = 'sha256:' + 'a' * 64
        labels = {'org.opencontainers.image.revision': 'b' * 40,
                  'org.opencontainers.image.source': 'https://github.com/example/private-suite',
                  'io.weave-workbench.source-revision': 'c' * 40}
        image = {'Os': 'linux', 'Architecture': 'amd64', 'Id': image_id, 'Config': {'Labels': labels}}
        with patch.object(build, 'run', return_value=json.dumps([image])):
            self.assertEqual(build.inspect_image('tag', {}, 'b' * 40, 'example/private-suite', 'c' * 40)['Id'], image_id)
            for repository, revision in [('example/other', 'c' * 40), ('example/private-suite', 'd' * 40)]:
                with self.assertRaises(build.BuildError):
                    build.inspect_image('tag', {}, 'b' * 40, repository, revision)
        build.verify_registry_config({'schemaVersion': 2, 'config': {'digest': image_id}}, image_id)
        for manifest in [{'schemaVersion': 2, 'config': {'digest': 'sha256:' + 'e' * 64}},
                         {'schemaVersion': 2, 'manifests': []}, {'schemaVersion': 2, 'config': None}]:
            with self.assertRaises(build.BuildError):
                build.verify_registry_config(manifest, image_id)

    def test_build_environment_drops_runtime_keys_and_github_token(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {'DEEPSEEK_API_KEY': 'test-only', 'GH_TOKEN': 'test-only'}):
            env = build.build_environment(Path(root) / 'profile')
            self.assertNotIn('DEEPSEEK_API_KEY', env)
            self.assertNotIn('GH_TOKEN', env)
            self.assertEqual(Path(env['NPM_CONFIG_USERCONFIG']).read_text(), '')
            self.assertNotEqual(env['NPM_CONFIG_USERCONFIG'], env['NPM_CONFIG_GLOBALCONFIG'])

    def test_wrong_image_architecture_or_source_is_rejected(self):
        with patch.object(build, 'run', return_value=json.dumps([{'Os': 'linux', 'Architecture': 'arm64'}])):
            with self.assertRaises(build.BuildError):
                build.inspect_image('test', {})
        with patch.object(build, 'run', return_value=json.dumps([{'Os': 'linux', 'Architecture': 'amd64', 'Config': {'Labels': {}}}])):
            with self.assertRaises(build.BuildError):
                build.inspect_image('test', {}, 'a' * 40)

    def test_buildkit_evidence_must_describe_the_loaded_image(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'metadata.json'
            metadata = {'containerimage.config.digest': 'sha256:' + 'a' * 64,
                        'containerimage.digest': 'sha256:' + 'b' * 64}
            file.write_text(json.dumps(metadata))
            self.assertEqual(build.verify_build_metadata(file, 'sha256:' + 'a' * 64), 'sha256:' + 'b' * 64)
            with self.assertRaises(build.BuildError):
                build.verify_build_metadata(file, 'sha256:' + 'c' * 64)

    def test_dirty_checkout_stops_before_docker_or_api_calls(self):
        with patch.object(build, 'git', return_value=' M other-agent-work'), patch.object(build, 'run') as execute:
            with self.assertRaises(build.BuildError):
                build.execute(plan(), '/objectui', Path('/unused'), 'postgres:16-bookworm', True)
            execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
