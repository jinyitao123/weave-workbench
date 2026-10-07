import copy
import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import unittest
from unittest.mock import Mock, patch
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import resume


def encoded(value):
    return json.dumps(value, sort_keys=True).encode()


def publication():
    repository, revision, version = 'example/suite', 'a' * 40, '0.1.0-rc.5'
    components = {'components': {name: {'revision': letter * 40} for name, letter in [('forge', 'b'), ('weave', 'c')]}}
    console = {'source': {'revision': 'd' * 40}, 'artifact': {'runtimeSourceTreeSha256': 'e' * 64, 'packagedTreeSha256': 'f' * 64}}
    raw_components, raw_console = encoded(components), encoded(console)
    manifest = {'schemaVersion': 1, 'status': 'published-private', 'published': True, 'images': {},
        'plan': {'schemaVersion': 1, 'repository': repository, 'sourceRevision': revision, 'bundleVersion': version,
                 'platform': 'linux/amd64', 'components': components['components'], 'console': console, 'tags': {},
                 'componentsLockSha256': hashlib.sha256(raw_components).hexdigest(), 'consoleLockSha256': hashlib.sha256(raw_console).hexdigest()}}
    lock = {'version': 1, 'bundleVersion': version, 'components': {}}
    files, dockerfiles = {}, {}
    for name, suffix in resume.SUFFIXES.items():
        source = components['components']['weave' if name == 'weave' else 'forge']['revision']
        prefix = f'ghcr.io/{repository}-{suffix}'
        image, local = prefix + '@sha256:' + '1' * 64, 'sha256:' + '2' * 64
        tag = prefix + ':' + version + '-' + revision[:12]
        metadata = encoded({'containerimage.config.digest': local, 'containerimage.digest': local})
        dockerfiles[name] = b'FROM fixed:1\n'
        manifest['plan']['tags'][name] = tag
        files[name + '-buildkit.json'] = metadata
        manifest['images'][name] = {'image': image, 'sourceRevision': source, 'tag': tag, 'localImageId': local,
            'registryConfigDigest': local, 'visibility': 'private', 'buildManifestDigest': local,
            'dockerfileSha256': hashlib.sha256(dockerfiles[name]).hexdigest(), 'buildkitMetadataSha256': hashlib.sha256(metadata).hexdigest()}
        lock['components'][name] = {'image': image, 'sourceRevision': source}
    pg = 'postgres@sha256:' + '3' * 64
    lock['components']['postgres'] = {'image': pg, 'major': 16}
    manifest['postgres'] = {'image': pg, 'version': 'postgres (PostgreSQL) 16.15', 'localImageId': 'sha256:' + '4' * 64}
    built = {'sourceRevision': console['source']['revision'], 'sourceTreeSha256': console['artifact']['runtimeSourceTreeSha256'], 'packagedTreeSha256': console['artifact']['packagedTreeSha256']}
    manifest['consoleBuild'] = built
    files.update({'build-manifest.json': encoded(manifest), 'images.lock.json': encoded(lock), 'console94.lock.json': raw_console, 'console94-build.json': encoded(built)})
    return files, (repository, revision, version, raw_components, raw_console, dockerfiles)


class ResumeTests(unittest.TestCase):
    def test_completed_stage_failure_is_allowed_but_wrong_run_source_or_workflow_is_rejected(self):
        repo = {'id': 9, 'full_name': 'example/suite'}
        run = {'id': 10, 'head_sha': 'a' * 40, 'status': 'completed', 'conclusion': 'failure',
               'workflow_id': 11, 'path': resume.WORKFLOW, 'repository': repo, 'head_repository': repo}
        workflow = {'id': 11, 'path': resume.WORKFLOW}
        resume.validate_run(run, workflow, 'example/suite', 9, 10, 'a' * 40)
        for change in [{'id': 12}, {'head_sha': 'b' * 40}, {'workflow_id': 12}, {'status': 'in_progress'}, {'head_repository': {'id': 8, 'full_name': 'other/suite'}}]:
            with self.assertRaises(resume.BuildError):
                resume.validate_run(dict(run, **change), workflow, 'example/suite', 9, 10, 'a' * 40)

    def test_only_the_complete_published_chain_is_accepted(self):
        files, args = publication()
        self.assertEqual(resume.validate_publication(files, *args)['version'], 1)
        for mutation in ['not-published', 'wrong-source', 'wrong-config', 'wrong-image']:
            changed = dict(files)
            manifest = json.loads(changed['build-manifest.json'])
            if mutation == 'not-published': manifest['published'] = False
            if mutation == 'wrong-source': manifest['plan']['sourceRevision'] = 'b' * 40
            if mutation == 'wrong-config': manifest['images']['forge']['registryConfigDigest'] = 'sha256:' + '9' * 64
            if mutation == 'wrong-image': manifest['images']['forge']['image'] = 'ghcr.io/other/image@sha256:' + '8' * 64
            changed['build-manifest.json'] = encoded(manifest)
            with self.subTest(mutation=mutation), self.assertRaises(resume.BuildError):
                resume.validate_publication(changed, *args)

    def test_official_archive_digest_and_size_are_required(self):
        api = Mock(repository='example/suite', token='test-only')
        artifact = {'id': 1, 'size_in_bytes': 3, 'digest': 'sha256:' + '0' * 64}
        opener = Mock()
        opener.open.return_value = io.BytesIO(b'abc')
        with patch.object(resume.urllib.request, 'build_opener', return_value=opener), self.assertRaises(resume.BuildError):
            resume.download_archive(api, artifact)

    def test_zip_path_symlink_duplicate_and_oversize_are_rejected(self):
        for kind in ['path', 'symlink', 'duplicate', 'oversize']:
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                name = '../images.lock.json' if kind == 'path' else 'images.lock.json'
                entry = zipfile.ZipInfo(name)
                if kind == 'symlink': entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(entry, b'{}')
                if kind == 'duplicate':
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore')
                        archive.writestr(name, b'{}')
            with self.subTest(kind=kind), patch.object(resume, 'MAX_ARCHIVE', 1 if kind == 'oversize' else resume.MAX_ARCHIVE), self.assertRaises(resume.BuildError):
                resume.read_archive(stream.getvalue())

    def test_safe_complete_json_archive_is_read_without_extracting_paths(self):
        files, _ = publication()
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            for name, value in files.items(): archive.writestr(name, value)
        self.assertEqual(resume.read_archive(stream.getvalue()), files)


if __name__ == '__main__':
    unittest.main()
