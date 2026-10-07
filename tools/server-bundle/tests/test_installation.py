"""Local installer boundary tests; these do not stand in for container acceptance."""
from contextlib import redirect_stdout
from copy import deepcopy
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import configuration as config
import server_bundle as bundle


def images():
    return {'version': 1, 'bundleVersion': '0.1.0-rc.5', 'components': {
        'forge': {'image': 'registry.example.invalid/private/forge@sha256:' + '1' * 64, 'sourceRevision': 'a' * 40},
        'forgeProxy': {'image': 'registry.example.invalid/private/proxy@sha256:' + '2' * 64, 'sourceRevision': 'a' * 40},
        'weave': {'image': 'registry.example.invalid/private/weave@sha256:' + '3' * 64, 'sourceRevision': 'b' * 40},
        'postgres': {'image': 'registry.example.invalid/private/postgres@sha256:' + '4' * 64, 'major': 16}}}


class InstallationCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.state, _ = config.initialize(self.directory, images(), 'http://forge.example.test:8080', 'http://weave.example.test:8081')

    def tearDown(self):
        self.temp.cleanup()

    def private_file(self, name, content):
        path = self.directory / name
        path.write_text(content)
        path.chmod(0o600)
        return path


class ConfigurationTests(InstallationCase):
    def test_reinstall_preserves_secrets_binding_and_operator_key(self):
        self.state['organizationId'] = 'native-org'
        self.state['secrets']['weaveApiKey'] = 'wv_sk_test_only'
        config.write_private(self.directory / 'state.json', self.state)
        before = (self.directory / 'state.json').read_bytes()
        state, created = config.initialize(self.directory, images(), 'http://FORGE.example.test:8080/', 'http://weave.example.test:8081')
        self.assertFalse(created)
        self.assertEqual(state, self.state)
        self.assertEqual((self.directory / 'state.json').read_bytes(), before)
        self.assertEqual((self.directory / 'state.json').stat().st_mode & 0o777, 0o600)

    def test_conflicting_reinstall_does_not_rewrite_state(self):
        before = (self.directory / 'state.json').read_bytes()
        changed = images()
        changed['components']['weave']['image'] = 'registry.example.invalid/private/weave@sha256:' + '5' * 64
        for overrides in ({'images': changed}, {'forge_origin': 'http://other.example.test:8080'}, {'weave_port': 8090}):
            params = {'images': images(), 'forge_origin': 'http://forge.example.test:8080', 'weave_origin': 'http://weave.example.test:8081', **overrides}
            with self.subTest(overrides=tuple(overrides)), self.assertRaises(config.ConfigurationError):
                config.initialize(self.directory, **params)
            self.assertEqual((self.directory / 'state.json').read_bytes(), before)

    def test_template_floating_and_wrong_database_locks_are_rejected(self):
        invalid = [json.loads((bundle.HERE / 'images.template.json').read_text())]
        for target, field, value in [('weave', 'sourceRevision', 'unknown'), ('weave', 'image', 'registry.example.invalid/weave:latest@sha256:' + 'a' * 64), ('postgres', 'major', 17), ('postgres', 'major', True), ('forgeProxy', 'sourceRevision', 'c' * 40)]:
            candidate = images()
            candidate['components'][target][field] = value
            invalid.append(candidate)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(config.ConfigurationError):
                config.validate_images(candidate)

    def test_origin_normalization_and_rejection_boundaries(self):
        for value, expected in [('HTTPS://Example.Test:443/', 'https://example.test'), ('http://[2001:db8::1]:80', 'http://[2001:db8::1]'), ('http://192.0.2.1:8080/', 'http://192.0.2.1:8080')]:
            self.assertEqual(config.normalize_origin(value), expected)
        for value in ['file:///tmp/server', 'https://user:password@example.test', 'http://example.test/api', 'http://example.test?', 'http://example.test#', 'http://example.test\\other', 'http://127.1', 'http://0x7f000001', 'http://example.123', 'http://-bad.example', 'http://bad-.example', 'http://example.test:0', 'http://example.test:65536', 'http://a..test', 'http://exa mple.test']:
            with self.subTest(value=value), self.assertRaises(config.ConfigurationError):
                config.normalize_origin(value)

    def test_private_inputs_reject_permissive_files_symlinks_and_oversize(self):
        key = self.private_file('key', 'test-only')
        self.assertEqual(config.read_model_key(key), 'test-only')
        link = self.directory / 'linked'
        link.symlink_to(key)
        with self.assertRaises(config.ConfigurationError):
            config.private_read(link)
        key.chmod(0o644)
        with self.assertRaises(config.ConfigurationError):
            config.private_read(key)
        key.chmod(0o600)
        key.write_text('x' * 8193)
        with self.assertRaises(config.ConfigurationError):
            config.private_read(key)

    def test_connection_export_is_exact_and_never_contains_secrets(self):
        target = self.directory / 'connection.json'
        self.assertTrue(bundle.export_connection(self.state, target))
        data = json.loads(target.read_text())
        self.assertEqual(set(data), {'version', 'forgeOrigin', 'weaveOrigin'})
        self.assertEqual(data, self.state['connection'])
        for value in self.state['secrets'].values():
            if value:
                self.assertNotIn(value, target.read_text())
        self.assertFalse(bundle.export_connection(self.state, target))
        changed = deepcopy(self.state)
        changed['connection']['forgeOrigin'] = 'http://different.example.test'
        with self.assertRaises(config.ConfigurationError):
            bundle.export_connection(changed, target)
        self.assertEqual(json.loads(target.read_text()), data)

    def test_canonical_origin_is_shared_by_forge_session_and_desktop(self):
        env = config.compose_environment(self.state)
        origin = self.state['connection']['forgeOrigin']
        self.assertEqual(env['WW_FORGE_ORIGIN'], origin)
        self.assertEqual(env['WW_FORGE_SESSION_URL'], origin + '/api/v1/auth/get-session')
        self.assertEqual(env['WW_FORGE_EVENT_URL'], origin + '/api/v1/apps/forge/weave-events/team-runs')
        self.assertEqual(env['WW_ORGANIZATION_ID'], '')

    def test_corrupted_secret_is_not_silently_regenerated(self):
        self.state['secrets']['forgeAuthSecret'] = 'invalid'
        config.write_private(self.directory / 'state.json', self.state)
        before = (self.directory / 'state.json').read_bytes()
        with self.assertRaises(config.ConfigurationError):
            config.load_state(self.directory)
        self.assertEqual((self.directory / 'state.json').read_bytes(), before)


class FakeDocker:
    def __init__(self, state):
        self.state = state
        self.refreshed = 0
        self.bootstrap_calls = 0

    def forge_from_container(self):
        return {'version': '1', 'issuer': self.state['forgeIdentityIssuer']}

    def refresh_weave(self):
        self.refreshed += 1

    def compose(self, args, label):
        self.bootstrap_calls += 1
        return json.dumps({'workspace_id': self.state['organizationId'], 'api_key': 'wv_sk_test_only'})


class NativeBoundaryTests(InstallationCase):
    def setUp(self):
        super().setUp()
        self.docker = FakeDocker(self.state)

    def api(self, origin, path, token=None, method='GET', body=None):
        values = {
            '/api/v1/workbench/identity-source': {'version': '1', 'issuer': self.state['forgeIdentityIssuer']},
            '/api/v1/auth/get-session': {'user': {'id': 'native-user'}, 'session': {'userId': 'native-user', 'activeOrganizationId': 'native-org'}},
            '/api/v1/auth/me/permissions': {'authenticated': True, 'permissionSets': ['admin_full_access']},
            '/v1/auth/external/exchange': {'token': 'test-weave-session', 'organization': {'id': 'native-org'}, 'subject': {'externalId': 'native-user'}, 'issuer': self.state['forgeIdentityIssuer'], 'permissions': ['teams:admin']},
            '/v1/auth/me': {'tenant_id': self.state['organizationId'], 'role': 'admin', 'source': 'apikey'},
        }
        return deepcopy(values[path])

    def test_attach_uses_native_org_and_reconciles_interrupted_restart(self):
        with patch.object(bundle, 'request_json', side_effect=self.api):
            self.assertEqual(bundle.attach_organization(self.state, self.directory, self.docker, 'test-forge-token', 'native-user'), 'test-weave-session')
            bundle.attach_organization(self.state, self.directory, self.docker, 'test-forge-token', 'native-user')
        self.assertEqual(self.docker.refreshed, 2)
        self.assertEqual(config.load_state(self.directory)['organizationId'], 'native-org')
        self.assertNotIn('test-forge-token', (self.directory / 'state.json').read_text())

    def test_nonadmin_other_user_and_changed_org_cannot_rebind(self):
        before = (self.directory / 'state.json').read_bytes()
        cases = [('/api/v1/auth/me/permissions', {'authenticated': True, 'permissionSets': []}),
                 ('/api/v1/auth/get-session', {'user': {'id': 'someone-else'}, 'session': {'userId': 'someone-else', 'activeOrganizationId': 'native-org'}}),
                 ('/api/v1/workbench/identity-source', {'version': '1', 'issuer': 'another-installation'})]
        for path, wrong in cases:
            def api(origin, requested, *args, **kwargs):
                return wrong if requested == path else self.api(origin, requested, *args, **kwargs)
            with self.subTest(path=path), patch.object(bundle, 'request_json', side_effect=api), self.assertRaises(bundle.OperationError):
                bundle.attach_organization(self.state, self.directory, self.docker, 'test-forge-token', 'native-user')
            self.assertEqual((self.directory / 'state.json').read_bytes(), before)
        self.state['organizationId'] = 'already-bound-org'
        with patch.object(bundle, 'request_json', side_effect=self.api), self.assertRaises(bundle.OperationError):
            bundle.attach_organization(self.state, self.directory, self.docker, 'test-forge-token', 'native-user')
        self.assertEqual(self.docker.refreshed, 0)

    def test_wrong_exchange_issuer_is_rejected_without_inventing_another_org(self):
        def api(origin, path, *args, **kwargs):
            result = self.api(origin, path, *args, **kwargs)
            if path == '/v1/auth/external/exchange':
                result['issuer'] = 'wrong-issuer'
            return result
        with patch.object(bundle, 'request_json', side_effect=api), self.assertRaises(bundle.OperationError):
            bundle.attach_organization(self.state, self.directory, self.docker, 'test-forge-token', 'native-user')
        self.assertEqual(self.state['organizationId'], 'native-org')

    def test_bootstrap_reuses_saved_key_and_checks_actual_tenant(self):
        self.state['organizationId'] = 'native-org'
        with patch.object(bundle, 'request_json', side_effect=self.api):
            bundle.bootstrap_weave(self.state, self.directory, self.docker)
            bundle.bootstrap_weave(self.state, self.directory, self.docker)
        self.assertEqual(self.docker.bootstrap_calls, 1)
        with patch.object(bundle, 'request_json', return_value={'tenant_id': 'wrong-org', 'role': 'admin', 'source': 'apikey'}), self.assertRaises(bundle.OperationError):
            bundle.bootstrap_weave(self.state, self.directory, self.docker)
        self.assertEqual(self.docker.bootstrap_calls, 1)

    def test_bootstrap_lost_raw_key_does_not_reset_or_guess(self):
        self.state['organizationId'] = 'native-org'
        with patch.object(self.docker, 'compose', return_value=json.dumps({'workspace_id': 'native-org', 'api_key_created': False})), self.assertRaises(bundle.OperationError):
            bundle.bootstrap_weave(self.state, self.directory, self.docker)
        self.assertEqual(self.state['secrets']['weaveApiKey'], '')


class ModelAndStatusTests(InstallationCase):
    def setUp(self):
        super().setUp()
        self.state['organizationId'] = 'native-org'
        self.state['secrets']['deepseekApiKey'] = 'test-private-model-key'
        self.calls = []

    def api(self, origin, path, token=None, method='GET', body=None):
        self.calls.append((origin, path, method))
        values = {
            '/models': {'data': [{'id': 'deepseek-flash'}]},
            '/v1/providers/system': [{'id': 'deepseek', 'models': ['deepseek-flash'], 'mirrored': True, 'mirrored_as': 'system/deepseek', 'mirror_revision': 1}],
            '/v1/providers/system/deepseek/mirror': {'provider_id': 'system/deepseek', 'revision': 1, 'outcome': 'created'},
            '/api/v1/health': {'success': True},
            '/v1/health': {'status': 'ok', 'build_commit': 'b' * 40},
            '/v1/ready': {'status': 'ready'},
            '/api/v1/workbench/identity-source': {'version': '1', 'issuer': self.state['forgeIdentityIssuer']},
            '/v1/teams': [],
        }
        return deepcopy(values[path])

    def test_service_model_uses_explicit_mirror_and_checks_revision_not_personal_create(self):
        with patch.object(bundle, 'request_json', side_effect=self.api):
            result = bundle.configure_shared_model(self.state, 'test-admin-token')
        self.assertEqual(result['state'], 'catalog_verified_and_mirrored')
        self.assertFalse(result['executionVerified'])
        self.assertIn(('http://weave.example.test:8081', '/v1/providers/system/deepseek/mirror', 'POST'), self.calls)
        self.assertNotIn(('http://weave.example.test:8081', '/v1/providers', 'POST'), self.calls)
        self.assertNotIn(('http://weave.example.test:8081', '/v1/providers', 'GET'), self.calls)
        self.assertNotIn('test-private-model-key', json.dumps(result))

    def test_unmirrored_wrong_head_or_stale_revision_is_not_shared_ready(self):
        for change in [{'mirrored': False}, {'mirrored_as': 'personal/deepseek'}, {'mirror_revision': 2}, {'mirror_revision': True}]:
            def api(origin, path, *args, **kwargs):
                result = self.api(origin, path, *args, **kwargs)
                if path == '/v1/providers/system':
                    result[0].update(change)
                return result
            with self.subTest(change=change), patch.object(bundle, 'request_json', side_effect=api), self.assertRaises(bundle.OperationError):
                bundle.configure_shared_model(self.state, 'test-admin-token')

    def test_model_catalog_failure_does_not_mirror_anything(self):
        with patch.object(bundle, 'request_json', return_value={'data': [{'id': 'some-other-model'}]}) as request, self.assertRaises(bundle.OperationError):
            bundle.configure_shared_model(self.state, 'test-admin-token')
        self.assertEqual(request.call_count, 1)

    def test_hidden_service_metadata_preserves_receipt_but_never_claims_model_ready(self):
        def api(origin, path, *args, **kwargs):
            previous_reads = sum(p == '/v1/providers/system' for _, p, _ in self.calls)
            result = self.api(origin, path, *args, **kwargs)
            return [] if path == '/v1/providers/system' and previous_reads else result
        with patch.object(bundle, 'request_json', side_effect=api):
            result = bundle.configure_shared_model(self.state, 'test-admin-token')
        self.assertEqual(result['state'], 'mirror_committed_readback_unverified')
        self.assertEqual(result['mirrorReceipt'], {'provider_id': 'system/deepseek', 'revision': 1, 'outcome': 'created'})
        self.assertFalse(result['executionVerified'])

    def test_health_does_not_imply_model_team_or_business_execution(self):
        self.state['secrets']['deepseekApiKey'] = ''
        self.state['organizationId'] = None
        with patch.object(bundle, 'request_json', side_effect=self.api):
            result = bundle.check_installation(self.state, FakeDocker(self.state))
        self.assertTrue(result['baseHealthy'])
        self.assertEqual(result['outcome'], 'base_installed_business_pending')
        self.assertEqual(result['identity']['state'], 'awaiting_native_setup')
        self.assertEqual(result['model']['state'], 'unconfigured')
        self.assertEqual(result['teams']['state'], 'not_checked')
        self.assertFalse(result['eventBridge']['deliveryVerified'])
        self.assertEqual(result['desktopLogin']['state'], 'not_verified')

    def test_wrong_weave_binary_revision_fails_base_check(self):
        def api(origin, path, *args, **kwargs):
            result = self.api(origin, path, *args, **kwargs)
            if path == '/v1/health':
                result['build_commit'] = 'unknown'
            return result
        with patch.object(bundle, 'request_json', side_effect=api):
            result = bundle.check_installation(self.state, FakeDocker(self.state))
        self.assertFalse(result['baseHealthy'])


class DockerBoundaryTests(InstallationCase):
    def test_stop_preserves_volumes_and_ignores_ambient_compose_configuration(self):
        calls = []
        def runner(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, '', '')
        with patch.dict(os.environ, {'COMPOSE_FILE': '/unrelated/compose.yml', 'WW_EVENT_SECRET': 'wrong'}):
            bundle.Docker(self.state, runner).stop()
        command, params = calls[0]
        self.assertEqual(command[-1], 'stop')
        self.assertNotIn('down', command)
        self.assertNotIn('-v', command)
        self.assertEqual(command[command.index('--env-file') + 1], '/dev/null')
        self.assertNotIn('COMPOSE_FILE', params['env'])
        self.assertEqual(params['env']['WW_EVENT_SECRET'], self.state['secrets']['eventSecret'])
        for secret in self.state['secrets'].values():
            if secret:
                self.assertNotIn(secret, json.dumps(command))

    def test_wrong_postgres_major_stops_before_application_start(self):
        docker = bundle.Docker(self.state)
        with patch.object(docker, 'compose', side_effect=['', '', '', 'postgres (PostgreSQL) 17.5']) as compose, self.assertRaises(bundle.OperationError):
            docker.start()
        self.assertEqual(compose.call_count, 4)
        self.assertFalse(any(call.args[0] == ['up', '-d', '--no-build', '--wait', '--wait-timeout', '300'] for call in compose.call_args_list))

    def test_docker_error_does_not_echo_substituted_secrets(self):
        def runner(command, **kwargs):
            return subprocess.CompletedProcess(command, 1, '', self.state['secrets']['eventSecret'])
        with self.assertRaises(bundle.OperationError) as caught:
            bundle.Docker(self.state, runner).stop()
        self.assertNotIn(self.state['secrets']['eventSecret'], str(caught.exception))

    def test_remote_docker_context_is_rejected(self):
        docker = bundle.Docker(self.state)
        with patch.object(bundle.platform, 'system', return_value='Linux'), patch.object(bundle.shutil, 'which', return_value='/usr/bin/docker'), patch.dict(os.environ, {'DOCKER_HOST': 'ssh://remote.example.test'}), self.assertRaises(bundle.OperationError):
            docker.preflight()

    def test_noninteractive_install_stops_at_native_setup_without_manufacturing_accounts(self):
        lockfile = self.private_file('images.json', json.dumps(images()))
        with patch.object(bundle.Docker, 'preflight'), patch.object(bundle.Docker, 'start'), patch.object(bundle, 'sign_in_native') as login, redirect_stdout(io.StringIO()) as output:
            code = bundle.main(['install', '--state-dir', str(self.directory), '--images', str(lockfile), '--forge-origin', 'http://forge.example.test:8080', '--weave-origin', 'http://weave.example.test:8081', '--output', str(self.directory / 'connection.json'), '--non-interactive'])
        self.assertEqual(code, 2)
        self.assertFalse(login.called)
        self.assertEqual(json.loads(output.getvalue())['outcome'], 'native_setup_required')
        self.assertFalse((self.directory / 'connection.json').exists())
        self.assertIsNone(config.load_state(self.directory)['organizationId'])

    def test_default_install_completes_native_attach_and_exports_pending_business_state(self):
        lockfile = self.private_file('images.json', json.dumps(images()))
        credentials = self.private_file('administrator.json', json.dumps({'email': 'admin@example.test', 'password': 'test-only-password'}))
        calls = []
        def api(origin, path, token=None, method='GET', body=None):
            calls.append((path, method))
            current = config.load_state(self.directory)
            values = {
                '/api/v1/auth/sign-in/email': {'token': 'test-native-session', 'user': {'id': 'native-user'}},
                '/api/v1/workbench/identity-source': {'version': '1', 'issuer': current['forgeIdentityIssuer']},
                '/api/v1/auth/get-session': {'user': {'id': 'native-user'}, 'session': {'userId': 'native-user', 'activeOrganizationId': 'native-org'}},
                '/api/v1/auth/me/permissions': {'authenticated': True, 'permissionSets': ['admin_full_access']},
                '/v1/auth/external/exchange': {'token': 'test-weave-session', 'organization': {'id': 'native-org'}, 'subject': {'externalId': 'native-user'}, 'issuer': current['forgeIdentityIssuer'], 'permissions': ['teams:admin']},
                '/v1/auth/me': {'tenant_id': 'native-org', 'role': 'admin', 'source': 'apikey'},
                '/api/v1/health': {'success': True}, '/v1/health': {'status': 'ok', 'build_commit': 'b' * 40},
                '/v1/ready': {'status': 'ready'}, '/v1/teams': [], '/api/v1/auth/sign-out': {'success': True},
            }
            return values[path]
        def compose(docker, args, label):
            return json.dumps({'workspace_id': 'native-org', 'api_key': 'wv_sk_test_only'})
        with patch.object(bundle.Docker, 'preflight'), patch.object(bundle.Docker, 'start'), patch.object(bundle.Docker, 'refresh_weave'), patch.object(bundle.Docker, 'compose', compose), patch.object(bundle.Docker, 'forge_from_container', lambda docker: {'version': '1', 'issuer': docker.state['forgeIdentityIssuer']}), patch.object(bundle, 'request_json', side_effect=api), redirect_stdout(io.StringIO()) as output:
            code = bundle.main(['install', '--state-dir', str(self.directory), '--images', str(lockfile), '--forge-origin', 'http://forge.example.test:8080', '--weave-origin', 'http://weave.example.test:8081', '--output', str(self.directory / 'connection.json'), '--non-interactive', '--admin-credentials-file', str(credentials)])
        self.assertEqual(code, 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report['identity']['state'], 'authenticated')
        self.assertEqual(report['outcome'], 'base_installed_business_pending')
        self.assertEqual(report['teams']['state'], 'unconfigured')
        self.assertEqual(report['installerSession']['state'], 'closed')
        self.assertEqual(calls[-1], ('/api/v1/auth/sign-out', 'POST'))
        self.assertEqual(json.loads((self.directory / 'connection.json').read_text()), self.state['connection'])
        for secret in ('test-only-password', 'test-native-session', 'test-weave-session', 'wv_sk_test_only'):
            self.assertNotIn(secret, output.getvalue())
        for secret in ('test-only-password', 'test-native-session', 'test-weave-session'):
            self.assertNotIn(secret, (self.directory / 'state.json').read_text())


class HTTPBoundaryTests(unittest.TestCase):
    def test_redirect_does_not_forward_a_session_and_error_bodies_are_not_logged(self):
        paths = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                paths.append(self.path)
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/unexpected')
                else:
                    self.send_response(500)
                self.end_headers()
                self.wfile.write(b'{"private":"test-sensitive-response"}')
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            origin = 'http://127.0.0.1:' + str(server.server_port)
            for path in ('/redirect', '/failure'):
                with self.assertRaises(bundle.OperationError) as caught:
                    bundle.request_json(origin, path, 'test-sensitive-session')
                self.assertNotIn('test-sensitive', str(caught.exception))
            self.assertEqual(paths, ['/redirect', '/failure'])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == '__main__':
    unittest.main()
