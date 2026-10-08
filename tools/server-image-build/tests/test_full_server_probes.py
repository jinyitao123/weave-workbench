import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build
import resume
from test_resume import publication, encoded


def forge_proof():
    return {'imageConfigDigest': 'sha256:' + '2' * 64, 'sourceRevision': 'b' * 40,
            'productSourceRevision': 'a' * 40, 'postgresImage': 'postgres@sha256:' + '3' * 64,
            'officialCommandUsed': True, 'command': build.FORGE_CMD,
            'sameDatabaseAfterRestart': True,
            'firstStart': {'health': {'success': True}, 'bootstrap': {'hasOwner': False}},
            'afterRestart': {'health': {'success': True}, 'bootstrap': {'hasOwner': False}}}


def full_publication():
    files, args = publication();m = json.loads(files['build-manifest.json'])
    m.update(schemaVersion=3, kind='full-server-probed')
    files['forge-server-proof.json'] = encoded(forge_proof())
    files['weave-server-proof.json'] = encoded({
        'imageConfigDigest': 'sha256:' + '2' * 64, 'sourceRevision': 'c' * 40, 'productSourceRevision': 'a' * 40,
        'target': 'server', 'cliExecutablesAbsent': True, 'cliPackagesAbsent': True, 'loomBinaryModulePresent': True,
        'health': {'status': 'ok', 'build_commit': 'c' * 40}, 'ready': {'status': 'ready'},
        'loomTree': 'e' * 40, 'loomModulePath': './third_party/loom', 'postgresImage': 'postgres@sha256:' + '3' * 64})
    for name in ('forge', 'weave'): m['images'][name]['serverProofSha256'] = hashlib.sha256(files[name + '-server-proof.json']).hexdigest()
    files['build-manifest.json'] = encoded(m)
    return files, args


class FullProofTests(unittest.TestCase):
    def test_full_proof_and_legacy_metadata_are_distinct(self):
        files, args = full_publication()
        resume.validate_publication(files, *args, require_probes=True, loom_tree='e' * 40)
        old, args = publication()
        resume.validate_publication(old, *args)
        with self.assertRaises(build.BuildError): resume.validate_publication(old, *args, require_probes=True, loom_tree='e' * 40)

    def test_health_owner_restart_image_and_database_proofs_are_required(self):
        baseline = forge_proof()
        for field, value in [('officialCommandUsed', False), ('command', ['node', 'serve']), ('sameDatabaseAfterRestart', False),
                             ('imageConfigDigest', 'sha256:' + '0' * 64), ('postgresImage', 'pgvector/pgvector:pg16'),
                             ('firstStart', {'health': {'success': True}, 'bootstrap': {'data': {'hasOwner': False}}}),
                             ('afterRestart', {'health': {'success': True}, 'bootstrap': {'hasOwner': True}}),
                             ('firstStart', {'health': {}, 'bootstrap': {'hasOwner': False}}),
                             ('firstStart', {'health': {'success': True, 'extra': 'not-public'}, 'bootstrap': {'hasOwner': False}}),
                             ('firstStart', {'health': {'success': True}, 'bootstrap': {'hasOwner': 0}})]:
            with self.subTest(field=field, value=value), self.assertRaises(build.BuildError):
                build.validate_forge_evidence(dict(baseline, **{field: value}), baseline['imageConfigDigest'], 'b' * 40, 'a' * 40, baseline['postgresImage'])

    def test_resume_rejects_forged_proof_even_with_recomputed_file_hash(self):
        for name in ('forge', 'weave'):
            files, args = full_publication();p = json.loads(files[name + '-server-proof.json'])
            if name == 'forge': p['afterRestart']['bootstrap']['hasOwner'] = True
            else: p['cliPackagesAbsent'] = False
            files[name + '-server-proof.json'] = encoded(p)
            m = json.loads(files['build-manifest.json']);m['images'][name]['serverProofSha256'] = hashlib.sha256(files[name + '-server-proof.json']).hexdigest()
            files['build-manifest.json'] = encoded(m)
            with self.subTest(name=name), self.assertRaises(build.BuildError):
                resume.validate_publication(files, *args, require_probes=True, loom_tree='e' * 40)
        files, args = full_publication();del files['forge-server-proof.json']
        with self.assertRaises(build.BuildError): resume.validate_publication(files, *args, require_probes=True, loom_tree='e' * 40)

    def test_full_archive_requires_both_proofs_and_rejects_failed_diagnostics(self):
        import io, zipfile
        def archive(files):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as z:
                for name, value in files.items(): z.writestr(name, value)
            return buffer.getvalue()
        files, _ = full_publication();self.assertEqual(resume.read_archive(archive(files)), files)
        for changed in (dict(files, **{'failed/forge-server-probe.json': b'{}'}), {k:v for k,v in files.items() if k != 'weave-server-proof.json'}):
            with self.assertRaises(build.BuildError): resume.read_archive(archive(changed))


class ForgeProbeTests(unittest.TestCase):
    def exercise(self, wrong_command=False, unhealthy=False):
        calls = []
        pg = 'postgres@sha256:' + '3' * 64
        image_id = 'sha256:' + '2' * 64
        plan = {'repository': 'example/suite', 'sourceRevision': 'a' * 40, 'components': {'forge': {'revision': 'b' * 40}}}
        image_config = {'Cmd': build.FORGE_CMD, 'Entrypoint': ['native-entrypoint']}
        def inspect(image, *args):
            return {'RepoDigests': [pg]} if image == pg else {'Id': image_id, 'Config': image_config}
        def command(args, **kwargs):
            args = list(map(str,args));calls.append(args)
            if args[:3] == ['docker', 'inspect', '--format']: return 'unchanged-database-id'
            if args[:2] == ['docker', 'inspect']:
                config = dict(image_config)
                if wrong_command: config['Entrypoint'] = ['bypass']
                return json.dumps([{'Image': image_id, 'Config': config}])
            if args[:2] == ['docker', 'run'] and args[-1] == 'forge-image':
                self.assertNotIn('--entrypoint', args)
                data = dict(x.split('=',1) for x in Path(args[args.index('--env-file')+1]).read_text().splitlines())
                for key in ('OS_AUTH_SECRET','OS_SECRET_KEY','FORGE_WEAVE_EVENT_SECRET'): self.assertRegex(data[key], r'^[a-f0-9]{64}$')
                self.assertRegex(data['FORGE_IDENTITY_ISSUER'], r'^urn:weave-workbench:proof:[A-Za-z0-9-]+$')
                self.assertEqual(Path(args[args.index('--env-file')+1]).stat().st_mode & 0o777, 0o600)
            return ''
        def process(args, **kwargs):
            calls.append(list(map(str,args)))
            data = {'health': {'success': True, 'notForPublication': 'synthetic-private-detail'}, 'bootstrap': {'hasOwner': False, 'notForPublication': 'synthetic-private-detail'}}
            return SimpleNamespace(returncode=1 if unhealthy and 'node' in args else 0, stdout=json.dumps(data))
        with tempfile.TemporaryDirectory() as folder, patch.object(build,'inspect_image',side_effect=inspect), patch.object(build,'run',side_effect=command), \
             patch.object(build.subprocess,'run',side_effect=process), patch.object(build.time,'sleep'), patch.object(build,'write_probe_diagnostic') as diagnostic:
            if wrong_command or unhealthy:
                with self.assertRaises(build.BuildError): build.verify_forge_server(plan,'forge-image',pg,Path(folder),{},Path(folder)/'failed.json')
                diagnostic.assert_called_once()
            else:
                proof=build.verify_forge_server(plan,'forge-image',pg,Path(folder),{},Path(folder)/'failed.json')
                self.assertTrue(proof['sameDatabaseAfterRestart']);diagnostic.assert_not_called()
                self.assertNotIn('synthetic-private-detail', json.dumps(proof))
                for phase in ('firstStart','afterRestart'):
                    self.assertEqual(proof[phase], {'health': {'success': True}, 'bootstrap': {'hasOwner': False}})
            self.assertFalse(list(Path(folder).glob('*.env')))
        self.assertEqual(sum(c[:3] == ['docker','rm','-f'] for c in calls),2)
        self.assertTrue(any(c[:3] == ['docker','network','rm'] for c in calls))
        return calls

    def test_official_command_and_stop_start_same_app_without_recreating_database(self):
        calls=self.exercise()
        starts=[c for c in calls if c[:2] == ['docker','start']];stops=[c for c in calls if c[:2] == ['docker','stop']]
        self.assertEqual(len(starts),1);self.assertEqual(len(stops),1);self.assertEqual(starts[0][-1],stops[0][-1])
        self.assertEqual(sum(c[:2] == ['docker','run'] and c[-1]=='forge-image' for c in calls),1)

    def test_overridden_command_is_rejected_and_cleaned(self): self.exercise(wrong_command=True)
    def test_unhealthy_service_fails_and_keeps_diagnostic_before_cleanup(self): self.exercise(unhealthy=True)

class PublicationGateTests(unittest.TestCase):
    def test_full_execution_cannot_publish_when_server_probe_fails(self):
        files,args=publication();plan=json.loads(files['build-manifest.json'])['plan']
        plan['console']['source'].update(nodeVersion='24.19.0',pnpmVersion='10.31.0')
        calls=[]
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)/'output'
            def archive(revision,destination,work,env):
                directory=destination/'apps/forge-objectstack' if destination.name=='forge' else destination
                directory.mkdir(parents=True);(directory/'Dockerfile').write_text('FROM fixed\n')
            def command(argv,**kwargs):
                argv=list(map(str,argv));calls.append(argv)
                if argv==['node','--version']:return 'v24.19.0'
                if argv==['pnpm','--version']:return '10.31.0'
                if argv[0]=='fake-build':(output/(argv[1]+'-buildkit.json')).write_text('{}')
                if len(argv)>1 and argv[0]=='node' and argv[1].endswith('build-console94.mjs'):
                    console=Path(kwargs['env']['FORGE_CONSOLE_BUILD_CONTEXT']);console.mkdir()
                    for name in ['console94-build.json','console94.lock.json']:(console/name).write_text('{}')
                if argv[-1]=='--version' and 'postgres' in argv:return 'postgres (PostgreSQL) 16.15'
                return ''
            with patch.object(build,'git',return_value=''),patch.object(build,'Github'),patch.object(build,'archive_source',side_effect=archive), \
                 patch.object(build,'build_environment',return_value={}),patch.object(build,'run',side_effect=command), \
                 patch.object(build,'build_command',side_effect=lambda plan,name,*args:['fake-build',name]), \
                 patch.object(build,'inspect_image',return_value={'Id':'sha256:'+'2'*64,'RepoDigests':['postgres@sha256:'+'3'*64]}), \
                 patch.object(build,'verify_build_metadata',return_value='sha256:'+'2'*64), \
                 patch.object(build,'verify_full_servers',side_effect=build.BuildError('probe failed')) as probe:
                with self.assertRaisesRegex(build.BuildError,'probe failed'):
                    build.execute(plan,folder,output,'postgres:16-bookworm',True)
                probe.assert_called_once()
            self.assertFalse(any(c[:2]==['docker','push'] for c in calls))
            self.assertFalse((output/'images.lock.json').exists())
            manifest=json.loads((output/'build-manifest.json').read_text())
            self.assertEqual(manifest['status'],'failed');self.assertFalse(manifest['published'])

    def test_full_gate_also_requires_the_weave_probe(self):
        plan={'sourceRevision':'a'*40,'repository':'example/suite','tags':{'forge':'forge','weave':'weave'},'components':{'weave':{'revision':'c'*40},'forge':{'revision':'b'*40}}}
        manifest={'images':{'weave':{'localImageId':'sha256:'+'2'*64},'forge':{'localImageId':'sha256:'+'2'*64}}}
        with tempfile.TemporaryDirectory() as folder,patch.object(build,'verify_forge_server',return_value=forge_proof()) as forge, \
             patch.object(build,'inspect_image',return_value={'Id':'sha256:'+'2'*64}), \
             patch.object(build,'verify_weave_server',side_effect=build.BuildError('weave probe failed')) as weave:
            with self.assertRaisesRegex(build.BuildError,'weave probe failed'):
                build.verify_full_servers(plan,manifest,'postgres@sha256:'+'3'*64,Path(folder),{},Path(folder))
            forge.assert_called_once();weave.assert_called_once()

    def test_replaced_forge_tag_cannot_write_success_proof_or_reach_weave(self):
        plan={'sourceRevision':'a'*40,'repository':'example/suite','tags':{'forge':'forge','weave':'weave'},'components':{'weave':{'revision':'c'*40},'forge':{'revision':'b'*40}}}
        manifest={'images':{'weave':{'localImageId':'sha256:'+'2'*64},'forge':{'localImageId':'sha256:'+'2'*64}}}
        changed=forge_proof();changed['imageConfigDigest']='sha256:'+'9'*64
        with tempfile.TemporaryDirectory() as folder,patch.object(build,'verify_forge_server',return_value=changed), \
             patch.object(build,'verify_weave_server') as weave:
            with self.assertRaises(build.BuildError):
                build.verify_full_servers(plan,manifest,'postgres@sha256:'+'3'*64,Path(folder),{},Path(folder))
            weave.assert_not_called()
            self.assertFalse((Path(folder)/'forge-server-proof.json').exists())

    def test_schema3_base_is_refused_before_build_or_publication(self):
        files,args=full_publication();plan=json.loads(files['build-manifest.json'])['plan']
        with tempfile.TemporaryDirectory() as folder,patch.object(build,'git',return_value=''), \
             patch.object(resume,'fetch_publication',return_value=(files,json.loads(files['images.lock.json']),{})), \
             patch.object(build,'run') as run,patch.object(build,'Github') as api:
            output=Path(folder)/'output'
            with self.assertRaisesRegex(build.BuildError,'only supports schema1'):
                build.replace_weave(plan,'a'*40,123,output,True)
            run.assert_not_called();api.assert_not_called();self.assertFalse(output.exists())
