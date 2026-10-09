import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weave_bundle import Deployment, ConfigurationError, STATE


def image_lock():
    return {'version': 1, 'kind': 'weave-standalone', 'bundleVersion': '0.1.0-rc.6', 'components': {
        'weave': {'image': 'registry.example.invalid/weave@sha256:' + '1' * 64, 'sourceRevision': 'a' * 40},
        'postgres': {'image': 'postgres@sha256:' + '2' * 64, 'major': 16}}}


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'images.lock.json').write_text(json.dumps(image_lock()))
        shutil.copyfile(Path(__file__).resolve().parents[1] / 'compose.yaml', self.root / 'compose.yaml')
        self.config = self.root / 'installation.json'
        self.config.write_text(json.dumps({'origin': 'http://weave.example.test:8081'}))
        self.deployment = Deployment(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_repeat_config_keeps_vault_identity_and_project(self):
        self.deployment.configure(self.config)
        before = (self.root / STATE).read_bytes(), (self.root / '.env').read_bytes()
        self.deployment.configure(self.config)
        self.assertTrue(before == ((self.root / STATE).read_bytes(), (self.root / '.env').read_bytes()))
        self.assertEqual((self.root / '.env').stat().st_mode & 0o777, 0o600)
        self.config.write_text(json.dumps({'origin': 'http://other.example.test:8081'}))
        with self.assertRaises(ConfigurationError):
            self.deployment.configure(self.config)
        self.assertTrue((self.root / STATE).read_bytes() == before[0])

    def test_unsupported_identity_and_foreign_env_refused(self):
        self.config.write_text(json.dumps({'origin': 'http://weave.example.test:8081', 'forgeOrigin': 'http://forge.example.test:8080'}))
        with self.assertRaises(ConfigurationError):
            self.deployment.configure(self.config)
        self.assertFalse((self.root / STATE).exists())
        self.config.write_text(json.dumps({'origin': 'http://weave.example.test:8081'}))
        (self.root / '.env').write_text('OTHER=test-only\n')
        with self.assertRaises(ConfigurationError):
            self.deployment.configure(self.config)
        self.assertEqual((self.root / '.env').read_text(), 'OTHER=test-only\n')

    def test_bootstrap_uses_existing_key_without_second_creation(self):
        self.deployment.configure(self.config)
        state = self.deployment.load()
        calls = []
        def runner(command, **kwargs):
            calls.append(command)
            if 'bootstrap' in command:
                return SimpleNamespace(returncode=0, stdout=json.dumps({'workspace_id': state['workspace'], 'api_key': 'wv_sk_test_only'}))
            self.assertTrue(json.loads(kwargs['input'])['key'] == 'wv_sk_test_only')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'tenant_id': state['workspace'], 'role': 'admin', 'source': 'apikey'}))
        self.deployment.runner = runner
        report = self.deployment.bootstrap()
        self.assertNotIn('wv_sk_test_only', json.dumps(report))
        self.deployment.bootstrap()
        self.assertEqual(sum('bootstrap' in c for c in calls), 1)
        self.assertEqual((self.root / 'operator-key.local').stat().st_mode & 0o777, 0o600)
        self.assertFalse(any('wv_sk_test_only' in str(c) for c in calls))

    def test_unknown_bootstrap_is_not_replayed(self):
        self.deployment.configure(self.config)
        calls = []
        def runner(command, **kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=1, stdout='')
        self.deployment.runner = runner
        with self.assertRaises(ConfigurationError):
            self.deployment.bootstrap()
        with self.assertRaises(ConfigurationError):
            self.deployment.bootstrap()
        self.assertEqual(len(calls), 1)
        self.assertFalse((self.root / 'operator-key.local').exists())
