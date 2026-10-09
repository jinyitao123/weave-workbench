#!/usr/bin/env python3
"""Verify an existing private Weave image, test isolated Compose, and append one release asset."""
from pathlib import Path
import gzip
import hashlib
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/server-image-build'))
from build import Github, BuildError
sys.path.insert(0, str(ROOT / 'tools/server-bundle'))
from configuration import ConfigurationError
from resume import fetch_publication


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def load_deployment(directory):
    sys.path.insert(0, str(ROOT / 'tools/weave-bundle'))
    from weave_bundle import Deployment
    return Deployment(directory)


def test_startup(directory, source):
    deployment = load_deployment(directory)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    settings = {'origin': f'http://127.0.0.1:{port}', 'port': port, 'bindAddress': '127.0.0.1'}
    input_file = directory / 'installation.json'
    write_json(input_file, settings)
    deployment.configure(input_file)
    started = False
    try:
        print('Checking isolated Compose configuration.', flush=True)
        raw = deployment.compose(['config', '--format', 'json'])
        doc = json.loads(raw)
        assert set(doc['services']) == {'db', 'weave'} and set(doc['volumes']) == {'database', 'workspaces'}
        assert 'ports' not in doc['services']['db'] and all('@sha256:' in s['image'] and 'build' not in s for s in doc['services'].values())
        started = True
        print('Starting isolated Weave and PostgreSQL.', flush=True)
        deployment.compose(['up', '-d', '--wait', '--wait-timeout', '240'])
        scripts = "Promise.all(['/v1/health','/v1/ready','/admin/','/v1/admin/config'].map(async p=>{const r=await fetch('http://127.0.0.1:8080'+p);if(!r.ok)throw Error();return p==='/admin/'?{html:(await r.text()).includes('<html')}:r.json()})).then(v=>console.log(JSON.stringify(v))).catch(()=>process.exit(1))"
        health, ready, admin, config = json.loads(deployment.compose(['exec', '-T', 'weave', 'node', '-e', scripts]))
        assert health['status'] == 'ok' and health['build_commit'] == source and admin['html'] is True
        report = deployment.bootstrap()
        state = deployment.load()
        first_key = state['apiKey']
        database_id = deployment.compose(['ps', '-q', 'db']).strip()
        assert database_id and report['operator'] == 'verified'
        deployment.compose(['stop'])
        deployment.compose(['up', '-d', '--wait', '--wait-timeout', '240'])
        repeated = deployment.bootstrap()
        assert repeated['operator'] == 'verified' and deployment.load()['apiKey'] == first_key
        assert deployment.compose(['ps', '-q', 'db']).strip() == database_id
        return {'services': ['weave', 'postgres'], 'exactSourceVerified': source, 'healthReady': True,
                'adminPageServed': True, 'nativeOperatorVerified': True, 'sameKeyAfterRestart': True,
                'sameDatabaseContainerAfterRestart': True, 'businessExecutionVerified': False, 'modelExecutionVerified': False}
    finally:
        # Only this fresh isolated test project, never a customer deployment.
        try:
            if started:
                deployment.compose(['down', '--volumes', '--remove-orphans'])
        finally:
            for n in ('.env', '.weave-state.local.json', '.weave-state.local.json.lock', 'operator-key.local', 'installation.json'):
                (directory / n).unlink(missing_ok=True)


def main():
    repo, target = os.environ['GITHUB_REPOSITORY'], os.environ['RELEASE_TAG']
    product = os.environ['IMAGE_PRODUCT_REVISION']
    version, run_id = os.environ['BUNDLE_VERSION'], int(os.environ['IMAGE_RUN_ID'])
    assert re.fullmatch(r'[0-9a-f]{40}', product) and re.fullmatch(r'\d+\.\d+\.\d+-rc\.\d+', version)
    api = Github(repo)
    files, full_lock, provenance = fetch_publication(repo, product, version, run_id)
    publication = json.loads(files['build-manifest.json'])
    assert publication['kind'] == 'full-server-probed'
    source = full_lock['components']['weave']['sourceRevision']
    server = api.get(f'repos/{repo}/actions/runs/{run_id}')
    assert server['conclusion'] in ('success', 'failure')
    steps = [s for j in api.get(f'repos/{repo}/actions/runs/{run_id}/jobs')['jobs'] for s in j['steps']]
    assert sum(s['name'] == 'Build, verify and optionally publish the locked images' and s['conclusion'] == 'success' for s in steps) == 1
    assert all(s['name'] == 'Stage exact private image digests on the explicitly prepared host' for s in steps if s['conclusion'] == 'failure')
    release = api.get(f'repos/{repo}/releases/tags/{target}')
    assert release['draft'] is False and release['prerelease'] is True
    ref = api.get(f'repos/{repo}/git/ref/tags/{target}')
    target_sha = ref['object']['sha']
    out = ROOT / '.build/weave-standalone'
    out.mkdir(parents=True, exist_ok=False)
    bundle = out / 'weave-standalone'
    bundle.mkdir()
    for n in ('compose.yaml', 'weave_bundle.py', 'installation.example.json', 'README.md'):
        shutil.copyfile(ROOT / 'tools/weave-bundle' / n, bundle / n)
    shutil.copyfile(ROOT / 'tools/server-bundle/configuration.py', bundle / 'configuration.py')
    import posixpath
    def doc_link(match):
        label, path = match.groups()
        if path.startswith(('http:', 'https:', '#')):
            return match.group(0)
        path = posixpath.normpath(posixpath.join('tools/weave-bundle', path))
        return '[' + label + '](https://github.com/' + repo + '/blob/' + os.environ['GITHUB_SHA'] + '/' + path + ')'
    readme = bundle / 'README.md'
    readme.write_text(re.sub(r'\[([^\]]*)\]\(([^)]+)\)', doc_link, readme.read_text()))
    lock = {'version': 1, 'kind': 'weave-standalone', 'bundleVersion': version,
            'components': {k: full_lock['components'][k] for k in ('weave', 'postgres')}}
    write_json(bundle / 'images.lock.json', lock)
    proof = bundle / 'build-evidence'
    proof.mkdir()
    for n in ('build-manifest.json', 'weave-server-proof.json', 'weave-buildkit.json'):
        (proof / n).write_bytes(files[n])
    print('Verified private source image and original startup proof.', flush=True)
    # Registry authentication is temporary and stays outside the distribution.
    with tempfile.TemporaryDirectory(prefix='standalone-docker-auth-') as docker_config:
        previous = os.environ.get('DOCKER_CONFIG')
        os.environ['DOCKER_CONFIG'] = docker_config
        plugins = Path(previous or str(Path.home() / '.docker')) / 'cli-plugins'
        if plugins.is_dir():
            (Path(docker_config) / 'cli-plugins').symlink_to(plugins.resolve(), target_is_directory=True)
        version = subprocess.run(['docker', 'compose', 'version'], capture_output=True, text=True)
        if version.returncode != 0:
            raise BuildError('Docker Compose plugin unavailable in the isolated credential profile')
        try:
            subprocess.run(['docker', 'login', 'ghcr.io', '--username', os.environ['GITHUB_ACTOR'], '--password-stdin'], input=os.environ['GH_TOKEN'], text=True, check=True, stdout=subprocess.DEVNULL)
            validation = test_startup(bundle, source)
        finally:
            if previous is None:
                os.environ.pop('DOCKER_CONFIG', None)
            else:
                os.environ['DOCKER_CONFIG'] = previous
    write_json(bundle / 'deployment-proof.json', validation)
    manifest = {'schemaVersion': 1, 'kind': 'weave-standalone-compose', 'version': version, 'sourceRevision': source,
                'imageProductRevision': product, 'installerSourceRevision': os.environ['GITHUB_SHA'],
                'publicationWorkflowRun': int(os.environ['GITHUB_RUN_ID']), 'imagePublication': provenance,
                'imagePublicationWorkflowConclusion': server['conclusion'], 'images': lock, 'validation': validation,
                'runtimeSource': 'existing-verified-private-image', 'credentialsIncluded': False}
    write_json(bundle / 'composition-manifest.json', manifest)
    name = f'weave-standalone-{version}-linux-x64.tar.gz'
    assets = out / 'assets'
    assets.mkdir()
    (bundle / 'SHA256SUMS.txt').write_text(''.join(digest(p) + '  ' + p.relative_to(bundle).as_posix() + '\n' for p in sorted(bundle.rglob('*')) if p.is_file()))
    archive = assets / name
    with archive.open('wb') as f, gzip.GzipFile(filename='', mode='wb', fileobj=f, mtime=0) as gz, tarfile.open(fileobj=gz, mode='w') as tar:
        for p in sorted(bundle.rglob('*')):
            info = tar.gettarinfo(str(p), arcname=bundle.name + '/' + p.relative_to(bundle).as_posix())
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            if p.is_file():
                with p.open('rb') as payload:
                    tar.addfile(info, payload)
            else:
                tar.addfile(info)
    with tarfile.open(archive) as tar:
        assert not any(Path(n).name in ('.env', '.weave-state.local.json', 'operator-key.local', 'installation.json') for n in tar.getnames())
        for line in tar.extractfile(bundle.name + '/SHA256SUMS.txt').read().decode().splitlines():
            h, n = line.split('  ', 1)
            assert hashlib.sha256(tar.extractfile(bundle.name + '/' + n).read()).hexdigest() == h
    old = {a['name']: a for a in release['assets']}
    assert name not in old
    for n in ('composition-manifest.json', 'SHA256SUMS.txt'):
        subprocess.run(['gh', 'release', 'download', target, '--repo', repo, '--pattern', n, '--dir', str(assets)], check=True)
        assert 'sha256:' + digest(assets / n) == old[n]['digest']
    composition = json.loads((assets / 'composition-manifest.json').read_text())
    descriptor = {**manifest, 'file': name, 'bytes': archive.stat().st_size, 'sha256': digest(archive)}
    composition['standaloneWeave'] = descriptor
    composition['assetRevision'] = composition.get('assetRevision', 1) + 1
    write_json(assets / 'composition-manifest.json', composition)
    checks = {n: h for line in (assets / 'SHA256SUMS.txt').read_text().splitlines() for h, n in [line.split('  ', 1)]}
    checks[name] = digest(archive)
    checks['composition-manifest.json'] = digest(assets / 'composition-manifest.json')
    (assets / 'SHA256SUMS.txt').write_text(''.join(h + '  ' + n + '\n' for n, h in sorted(checks.items())))
    latest = api.get(f'repos/{repo}/releases/{release["id"]}')
    assert {(a['name'], a['digest']) for a in latest['assets']} == {(a['name'], a['digest']) for a in release['assets']}
    subprocess.run(['gh', 'release', 'upload', target, str(archive), '--repo', repo], check=True)
    subprocess.run(['gh', 'release', 'upload', target, str(assets / 'composition-manifest.json'), str(assets / 'SHA256SUMS.txt'), '--repo', repo, '--clobber'], check=True)
    body = out / 'release-notes.md'
    body.write_text(release['body'] + f'\n新增Weave独立Compose包 `{name}`，仅部署Weave与PostgreSQL，采用独立标注的{version}镜像及准确来源。配置后运行`docker compose up -d --wait`，再执行`python3 weave_bundle.py bootstrap`；运维Key只保存到私有文件。冷启动、运维身份与同库重启已实际验证；模型执行与业务验收仍独立进行。\n')
    subprocess.run(['gh', 'release', 'edit', target, '--repo', repo, '--notes-file', str(body)], check=True)
    final = api.get(f'repos/{repo}/releases/{release["id"]}')
    result = {a['name']: a for a in final['assets']}
    assert set(result) == set(old) | {name} and not final['draft'] and final['prerelease']
    for n, a in old.items():
        if n not in ('composition-manifest.json', 'SHA256SUMS.txt'):
            assert result[n]['id'] == a['id'] and result[n]['digest'] == a['digest']
    for p in assets.iterdir():
        assert result[p.name]['digest'] == 'sha256:' + digest(p) and result[p.name]['size'] == p.stat().st_size
    assert api.get(f'repos/{repo}/git/ref/tags/{target}')['object']['sha'] == target_sha
    write_json(out / 'release-readback.json', final)
    print('Independent Compose cold start, operator and restart verified; release addition read back:', name)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        frame, line = error.__traceback__, None
        while frame:
            if frame.tb_frame.f_code.co_filename == __file__:
                line = frame.tb_lineno
            frame = frame.tb_next
        print('Standalone publication incomplete; no private response or credential logged. Error type:', type(error).__name__, 'publisher line:', line, file=sys.stderr)
        if isinstance(error, (ConfigurationError, BuildError)):
            print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
