import copy
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build
import resume
from test_resume import publication


class ReplaceWeaveTests(unittest.TestCase):
    def test_reuse_requires_unchanged_forge_and_console_and_copies_lock(self):
        files, args = publication()
        old = json.loads(files['build-manifest.json'])
        plan = copy.deepcopy(old['plan'])
        plan['components']['weave']['revision'] = 'e' * 40
        lock = build.reusable_lock(plan, files)
        self.assertEqual(lock, json.loads(files['images.lock.json']))
        for field in ('components', 'console'):
            changed = copy.deepcopy(plan)
            if field == 'components': changed[field]['forge']['revision'] = 'f' * 40
            else: changed[field]['source']['revision'] = 'f' * 40
            with self.assertRaises(build.BuildError): build.reusable_lock(changed, files)

    def test_server_proof_requires_actual_commit_ready_no_cli_and_loom(self):
        evidence = {'target': 'server', 'cliExecutablesAbsent': True, 'cliPackagesAbsent': True,
                    'health': {'build_commit': 'a' * 40, 'status': 'ok'}, 'loomBinaryModulePresent': True, 'ready': {'status': 'ready'},
                    'loomTree': 'b' * 40, 'loomModulePath': './third_party/loom',
                    'postgresImage': 'postgres@sha256:' + 'c' * 64}
        build.validate_server_evidence(evidence, 'a' * 40, 'b' * 40, evidence['postgresImage'])
        for field, value in [('target', 'executor'), ('cliExecutablesAbsent', False),
                             ('cliPackagesAbsent', False), ('health', {'build_commit': 'd' * 40}),
                             ('ready', {'status': 'not_ready'}), ('loomTree', 'd' * 40),
                             ('loomModulePath', '/unverified/loom'), ('postgresImage', 'pgvector/pgvector:pg16')]:
            changed = dict(evidence, **{field: value})
            with self.subTest(field=field), self.assertRaises(build.BuildError):
                build.validate_server_evidence(changed, 'a' * 40, 'b' * 40, evidence['postgresImage'])


def replacement():
    import hashlib
    from test_resume import encoded
    base, original = publication()
    repo, old_revision, version, raw_components, raw_console, dockerfiles = original
    old = json.loads(base['build-manifest.json'])
    plan = copy.deepcopy(old['plan'])
    revision, source, loom = '5' * 40, '6' * 40, '7' * 40
    plan['sourceRevision'] = revision
    plan['components']['weave']['revision'] = source
    components = encoded({'components': plan['components']})
    plan['componentsLockSha256'] = hashlib.sha256(components).hexdigest()
    tag = f'ghcr.io/{repo}-weave:{version}-{revision[:12]}'
    plan['tags']['weave'] = tag
    provenance = {'publicationRunId': 123, 'publicationRevision': old_revision, 'artifactId': 456,
                  'archiveDigest': 'sha256:' + '8' * 64, 'archiveBytes': 40000}
    files = {'base-' + name: data for name, data in base.items()}
    evidence = {'target': 'server', 'cliExecutablesAbsent': True, 'cliPackagesAbsent': True,
                'loomBinaryModulePresent': True, 'health': {'status': 'ok', 'build_commit': source},
                'ready': {'status': 'ready'}, 'loomTree': loom, 'loomModulePath': './third_party/loom',
                'postgresImage': json.loads(base['images.lock.json'])['components']['postgres']['image']}
    files['weave-server-proof.json'] = encoded(evidence)
    files['weave-buildkit.json'] = base['weave-buildkit.json']
    image = copy.deepcopy(old['images']['weave'])
    image.update(sourceRevision=source, target='server', tag=tag,
                 serverProofSha256=hashlib.sha256(files['weave-server-proof.json']).hexdigest())
    manifest = {'schemaVersion': 2, 'kind': 'weave-replacement', 'status': 'published-private', 'published': True,
                'plan': plan, 'basePublication': provenance, 'images': {'weave': image},
                'componentBuildSources': {'forge': old_revision, 'forgeProxy': old_revision,
                                          'postgres': old_revision, 'weave': revision}}
    lock = json.loads(base['images.lock.json'])
    lock['components']['weave']['sourceRevision'] = source
    files['images.lock.json'] = encoded(lock)
    files['build-manifest.json'] = encoded(manifest)
    args = (repo, revision, version, components, raw_console, dockerfiles, base, provenance,
            b'replace github.com/jinyitao123/loom => ./third_party/loom\n', loom)
    return files, args


class ReplacementChainTests(unittest.TestCase):
    def test_combination_preserves_original_proof_and_distinguishes_origins(self):
        files, args = replacement()
        lock = resume.validate_replacement(files, *args)
        self.assertEqual(lock['components']['forge'], json.loads(args[6]['images.lock.json'])['components']['forge'])
        self.assertEqual(lock['components']['weave']['sourceRevision'], '6' * 40)
        # The old same-source validator must NOT accept a replacement envelope.
        with self.assertRaises(build.BuildError): resume.validate_publication(files, *args[:6])

    def test_mixed_original_or_replacement_evidence_is_rejected(self):
        from test_resume import encoded
        import hashlib
        for mutation in ('base-bytes', 'base-run', 'origins', 'reused-digest', 'new-source', 'new-config', 'new-health', 'pg-substitution'):
            files, args = replacement()
            manifest = json.loads(files['build-manifest.json'])
            if mutation == 'base-bytes': files['base-forge-buildkit.json'] += b'\n'
            if mutation == 'base-run': manifest['basePublication']['publicationRunId'] += 1
            if mutation == 'origins': manifest['componentBuildSources']['forge'] = args[1]
            if mutation == 'reused-digest':
                lock = json.loads(files['images.lock.json']);lock['components']['forge']['image'] = 'ghcr.io/example/suite-forge-app@sha256:' + '0' * 64;files['images.lock.json'] = encoded(lock)
            if mutation == 'new-source': manifest['images']['weave']['sourceRevision'] = 'a' * 40
            if mutation == 'new-config': manifest['images']['weave']['registryConfigDigest'] = 'sha256:' + '0' * 64
            if mutation in ('new-health', 'pg-substitution'):
                proof = json.loads(files['weave-server-proof.json'])
                if mutation == 'new-health': proof['health']['build_commit'] = '0' * 40
                else: proof['postgresImage'] = 'pgvector/pgvector:pg16'
                files['weave-server-proof.json'] = encoded(proof)
                manifest['images']['weave']['serverProofSha256'] = hashlib.sha256(files['weave-server-proof.json']).hexdigest()
            files['build-manifest.json'] = encoded(manifest)
            with self.subTest(mutation=mutation), self.assertRaises(build.BuildError): resume.validate_replacement(files, *args)

    def test_replacement_archive_has_a_bounded_distinct_allowlist(self):
        import io
        import zipfile
        files, _ = replacement()
        def archive(items):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as output:
                for name, value in items.items(): output.writestr(name, value)
            return stream.getvalue()
        self.assertEqual(resume.read_archive(archive(files)), files)
        for name in ('unexpected.json', 'forge-buildkit.json', '../secrets.json'):
            with self.subTest(name=name), self.assertRaises(build.BuildError):
                resume.read_archive(archive(dict(files, **{name: b'{}'})))

    def test_build_command_explicitly_selects_server(self):
        files, _ = replacement();plan = json.loads(files['build-manifest.json'])['plan']
        plan['weaveVersion'] = '1.0.0'
        args = build.build_command(plan, 'weave', Path('/weave'), None, Path('/proof.json'))
        self.assertEqual(args[args.index('--target') + 1], 'server')
        self.assertNotIn('executor', args)

class ServerProbeTests(unittest.TestCase):
    def test_probe_uses_official_locked_database_and_cleans_up_after_wrong_commit(self):
        import tempfile
        from unittest.mock import patch
        from types import SimpleNamespace
        calls = []
        private_values = []
        pg = 'postgres@sha256:' + 'c' * 64
        plan = {'components': {'weave': {'revision': 'a' * 40}}}
        def fake_git(*args, **kwargs):
            return 'b' * 40 if args[0] == 'rev-parse' else 'replace github.com/jinyitao123/loom => ./third_party/loom\n'
        def fake_run(args, **kwargs):
            calls.append([str(x) for x in args])
            if '--env-file' in args and str(args[args.index('--env-file') + 1]).endswith('probe-server.env'):
                env_file = Path(args[args.index('--env-file') + 1])
                values = dict(line.split('=', 1) for line in env_file.read_text().splitlines())
                self.assertRegex(values['WEAVE_SECRET_KEY'], r'^[0-9a-f]{64}$')
                self.assertRegex(values['JWT_SECRET'], r'^[0-9a-f]{64}$')
                self.assertNotEqual(values['WEAVE_SECRET_KEY'], values['JWT_SECRET'])
                self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
                private_values.extend([values['WEAVE_SECRET_KEY'], values['JWT_SECRET'], values['DATABASE_URL'].split(':')[2].split('@')[0]])
            if '--version' in args: return 'postgres (PostgreSQL) 16.15'
            return ''
        def fake_process(args, **kwargs):
            calls.append([str(x) for x in args])
            if args[1] in ('logs', 'inspect'):
                kwargs['stdout'].write(('sensitive ' + ' '.join(private_values) + ' https://example.invalid/?signed=value').encode())
            data = {'health': {'status': 'ok', 'build_commit': 'WRONG'}, 'ready': {'status': 'ready'}}
            return SimpleNamespace(returncode=0, stdout=json.dumps(data))
        with tempfile.TemporaryDirectory() as root, patch.object(build, 'git', side_effect=fake_git), \
             patch.object(build, 'run', side_effect=fake_run), \
             patch.object(build, 'inspect_image', return_value={'RepoDigests': [pg]}), \
             patch.object(build.subprocess, 'run', side_effect=fake_process):
            diagnostic = Path(root) / 'failed/probe.json'
            with self.assertRaises(build.BuildError): build.verify_weave_server(plan, 'new-weave', pg, Path(root), {}, diagnostic)
            text = diagnostic.read_text()
            self.assertTrue(private_values)
            for value in private_values: self.assertNotIn(value, text)
            self.assertNotIn('signed=value', text)
            self.assertIn('<redacted>', text)
            self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)
            self.assertFalse((Path(root) / 'probe-pg.env').exists())
            self.assertFalse((Path(root) / 'probe-server.env').exists())
        self.assertTrue(any(call[:3] == ['docker', 'network', 'create'] and '--internal' in call for call in calls))
        self.assertTrue(any(call[:2] == ['docker', 'pull'] and pg in call for call in calls))
        self.assertEqual(sum(call[:3] == ['docker', 'rm', '-f'] for call in calls), 2)
        self.assertTrue(any(call[:3] == ['docker', 'network', 'rm'] for call in calls))
        self.assertFalse(any('pgvector' in arg for call in calls for arg in call))

class CombinationResumeTests(unittest.TestCase):
    def test_staging_restore_keeps_base_bytes_and_discards_prior_host_receipt(self):
        import tempfile
        from unittest.mock import patch
        files, args = replacement()
        files['host-staging-receipt.json'] = b'{"stale":true}'
        lock = json.loads(files['images.lock.json'])
        with tempfile.TemporaryDirectory() as directory, patch.object(resume, 'fetch_publication', return_value=(files, lock, {'rebuilt': False})) as fetch:
            output = Path(directory) / 'restored'
            resume.resume(args[0], args[1], args[2], 99, output)
            fetch.assert_called_once_with(args[0], args[1], args[2], 99)
            for name, data in files.items():
                if name != 'host-staging-receipt.json': self.assertEqual((output / name).read_bytes(), data)
            self.assertFalse((output / 'host-staging-receipt.json').exists())
            self.assertFalse(json.loads((output / 'resume-proof.json').read_text())['rebuilt'])

class FailedProbeDiagnosticsTests(unittest.TestCase):
    def test_failure_output_is_bounded_and_separate_from_recoverable_artifact(self):
        import tempfile
        from unittest.mock import patch
        from types import SimpleNamespace
        secret = 'f' * 64
        def capture(args, **kwargs):
            kwargs['stdout'].write(('x' * 100000 + secret + ' https://example.invalid/private?signed=hidden').encode())
            return SimpleNamespace(returncode=1)
        with tempfile.TemporaryDirectory() as directory, patch.object(build.subprocess, 'run', side_effect=capture):
            path = Path(directory) / 'failed/probe.json'
            build.write_probe_diagnostic(path, ['server', 'database'], {}, [secret])
            data = json.loads(path.read_text())
            for record in data['containers']:
                for field in ('state', 'logs'):
                    self.assertLessEqual(len(record[field]), 16384)
                    self.assertNotIn(secret, record[field])
                    self.assertNotIn('signed=hidden', record[field])
                    self.assertTrue(record[field + 'Truncated'])
            self.assertNotIn('failed/probe.json', resume.ALLOWED | resume.REPLACEMENT_ALLOWED)

