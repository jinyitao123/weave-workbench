#!/usr/bin/env python3
"""Publish one immutable, unsigned test composition after official artifact checks."""
from pathlib import Path
import concurrent.futures
import gzip
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/server-image-build'))
from build import Github, BuildError
from resume import fetch_publication, NoRedirect, FULL_REQUIRED


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def download(api, artifact, output):
    size = artifact['size_in_bytes']
    assert 0 < size < 2 * 1024**3 and re.fullmatch(r'sha256:[0-9a-f]{64}', artifact['digest'])
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(f'https://api.github.com/repos/{api.repository}/actions/artifacts/{artifact["id"]}/zip', headers={
        'Authorization': 'Bearer ' + api.token, 'Accept': 'application/vnd.github+json'})
    try:
        opener.open(request, timeout=30)
        raise BuildError('Official archive redirect missing')
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise BuildError(f'Official archive API failed (HTTP {error.code})') from None
        location = error.headers.get('Location', '')
    u = urllib.parse.urlsplit(location)
    assert u.scheme == 'https' and u.hostname and not u.username and not u.password
    assert u.hostname.endswith(('.blob.core.windows.net', '.actions.githubusercontent.com'))
    # Only the GitHub API receives Authorization, never the signed storage URL.
    try:
        with opener.open(urllib.request.Request(location), timeout=120) as response, output.open('wb') as f:
            count = 0
            while chunk := response.read(8 * 1024 * 1024):
                count += len(chunk)
                assert count <= size
                f.write(chunk)
    except urllib.error.URLError:
        raise BuildError('Official archive transport failed') from None
    assert count == size and 'sha256:' + digest(output) == artifact['digest']
    print('Official archive verified:', artifact['name'], flush=True)


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    revision, version = os.environ['PRODUCT_REVISION'], os.environ['RELEASE_VERSION']
    assert re.fullmatch(r'[0-9a-f]{40}', revision) and re.fullmatch(r'\d+\.\d+\.\d+-rc\.[1-9]\d*', version)
    desktop_run, server_run = int(os.environ['DESKTOP_RUN']), int(os.environ['SERVER_RUN'])
    api = Github(repo)
    api.repository_verified()
    out = ROOT / '.build/test-release'
    assets = out / 'assets'
    assets.mkdir(parents=True, exist_ok=False)
    blob = lambda p: git('show', revision + ':' + p)
    config = json.loads(blob('desktop/package.json'))
    assert config['version'] == version
    run = api.get(f'repos/{repo}/actions/runs/{desktop_run}')
    assert run['status'] == 'completed' and run['conclusion'] == 'success'
    assert run['path'].split('@')[0] == '.github/workflows/desktop-ci.yml'
    assert run['repository']['id'] == api.repository_id and run['head_repository']['id'] == api.repository_id
    desktop_source = run['head_sha']
    assert re.fullmatch(r'[0-9a-f]{40}', desktop_source)
    assert git('rev-parse', revision + ':desktop') == git('rev-parse', desktop_source + ':desktop')
    desktop_workflows = git('ls-tree', '-r', '--name-only', '-z', revision, '.github/workflows').decode().strip('\0').split('\0')
    for path in desktop_workflows:
        if Path(path).name.startswith('desktop-'):
            assert blob(path) == git('show', desktop_source + ':' + path)
    jobs = api.get(f'repos/{repo}/actions/runs/{desktop_run}/jobs?per_page=100')['jobs']
    for name in ('quality', 'hermetic-e2e', 'windows-state-migration', 'Production dependency audit'):
        assert sum(j['name'] == name and j['conclusion'] == 'success' for j in jobs) == 1
    packages = [j for j in jobs if j['name'].startswith('local-qa-package')]
    assert len(packages) == 3 and all(j['conclusion'] == 'success' for j in packages)
    source_files, image_lock, server_provenance = fetch_publication(repo, revision, version, server_run)
    assert FULL_REQUIRED.issubset(source_files)
    build_manifest = json.loads(source_files['build-manifest.json'])
    assert build_manifest['kind'] == 'full-server-probed'
    server_state = api.get(f'repos/{repo}/actions/runs/{server_run}')
    server_jobs = api.get(f'repos/{repo}/actions/runs/{server_run}/jobs?per_page=100')['jobs']
    steps = [s for j in server_jobs for s in j['steps']]
    build_steps = [s for s in steps if s['name'] == 'Build, verify and optionally publish the locked images']
    assert len(build_steps) == 1 and build_steps[0]['conclusion'] == 'success'
    assert server_state['conclusion'] in ('success', 'failure')
    failures = [s['name'] for s in steps if s['conclusion'] == 'failure']
    assert not failures or failures == ['Stage exact private image digests on the explicitly prepared host']
    names = ('gooeypi-local-qa-macos', 'gooeypi-local-qa-linux', 'gooeypi-local-qa-windows')
    all_artifacts = api.get(f'repos/{repo}/actions/runs/{desktop_run}/artifacts?per_page=100')['artifacts']
    selected = []
    for name in names:
        matches = [a for a in all_artifacts if a['name'] == name and not a['expired']]
        assert len(matches) == 1 and matches[0]['workflow_run']['head_sha'] == desktop_source
        selected.extend(matches)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(download, api, a, out / (a['name'] + '.zip')) for a in selected]
        for f in futures:
            f.result()
    product = config['build']['productName'] + '-' + version
    mapping = {product + suffix: (platform, ext) for suffix, platform, ext in (
        ('-arm64.dmg', 'macos-arm64', 'dmg'), ('-arm64.zip', 'macos-arm64', 'zip'),
        ('-linux-x86_64.AppImage', 'linux-x64', 'AppImage'), ('-linux-amd64.deb', 'linux-x64', 'deb'),
        ('-linux-x86_64.rpm', 'linux-x64', 'rpm'), ('-linux-x64.pacman', 'linux-x64', 'pacman'),
        ('-win-x64.exe', 'windows-x64', 'exe'), ('-win-x64.zip', 'windows-x64', 'zip'), ('-win-x64.msix', 'windows-x64', 'msix'))}
    seen, desktop = set(), []
    for a in selected:
        with zipfile.ZipFile(out / (a['name'] + '.zip')) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            assert len(infos) <= 10 and sum(i.file_size for i in infos) < 3 * 1024**3
            for i in infos:
                name = Path(i.filename).name
                if name == product + '-win-x64.appx':
                    continue
                assert name in mapping and name not in seen
                seen.add(name)
                platform, ext = mapping[name]
                dest = assets / f'weave-workbench-{version}-{platform}.{ext}'
                with z.open(i) as src, dest.open('wb') as dst:
                    shutil.copyfileobj(src, dst)
                assert dest.stat().st_size == i.file_size
                desktop.append({'file': dest.name, 'sourceFile': i.filename, 'platform': platform, 'bytes': i.file_size, 'sha256': digest(dest), 'artifactId': a['id']})
    assert seen == set(mapping)
    bundle = out / f'weave-workbench-server-{version}-linux-x64'
    bundle.mkdir()
    for name in ('install.sh', 'bootstrap-docker.sh', 'compose.yaml', 'configuration.py', 'server_bundle.py'):
        p = bundle / name
        p.write_bytes(blob('tools/server-bundle/' + name))
        p.chmod(0o755 if name.endswith('.sh') else 0o644)
    (bundle / 'images.lock.json').write_bytes(source_files['images.lock.json'])
    (bundle / 'components.lock.json').write_bytes(blob('components.lock.json'))
    proof = bundle / 'build-evidence'
    proof.mkdir()
    for name in sorted(FULL_REQUIRED):
        (proof / name).write_bytes(source_files[name])
    base = f'https://github.com/{repo}/blob/v{version}/'
    for src, dest in (('docs/engineering/安装与初始化.md', '安装与初始化.md'), ('tools/server-bundle/README.md', '安装器说明.md')):
        text = blob(src).decode()
        def link(m):
            label, url = m.groups()
            if url.startswith(('https:', 'http:', '#', 'assets/')):
                return m.group(0)
            return '[' + label + '](' + base + posixpath.normpath(posixpath.join(posixpath.dirname(src), url)) + ')'
        text = re.sub(r'\[([^\]]*)\]\(([^)]+)\)', link, text)
        text = text.replace('最终发行尚未冻结。**总仓来源、各平台桌面安装文件、服务端包及新镜像组合均待最终交付清单确认。**', f'本包固定为 `{version}`；准确来源和产物见本次发行附件 `composition-manifest.json`。')
        (bundle / dest).write_text(text)
    images = bundle / 'assets'
    images.mkdir()
    for path in git('ls-tree', '-r', '--name-only', '-z', revision, 'docs/engineering/assets').decode().strip('\0').split('\0'):
        (images / Path(path).name).write_bytes(blob(path))
    (bundle / 'README.md').write_text(f'# Weave Workbench 服务端测试包\n\n版本 `{version}`，准确来源 `{revision}`，Linux x86_64。\n\n先核对内部SHA256SUMS.txt，阅读[安装与初始化](安装与初始化.md)及[安装器说明](安装器说明.md)，由根目录install.sh启动统一向导。需要固定私有镜像的GHCR Read授权；包内无离线镜像、账号或凭据。\n\nWeave管理端使用安装时的Weave地址加/admin/，安装器配置默认Forge登录；API Key保留在显式运维入口。\n')
    (bundle / 'SHA256SUMS.txt').write_text(''.join(digest(p) + '  ' + p.relative_to(bundle).as_posix() + '\n' for p in sorted(bundle.rglob('*')) if p.is_file()))
    archive = assets / (bundle.name + '.tar.gz')
    with archive.open('wb') as f, gzip.GzipFile(filename='', fileobj=f, mode='wb', mtime=0) as gz, tarfile.open(fileobj=gz, mode='w') as tar:
        for p in sorted(bundle.rglob('*')):
            info = tar.gettarinfo(str(p), arcname=bundle.name + '/' + p.relative_to(bundle).as_posix())
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            if p.is_file():
                with p.open('rb') as src:
                    tar.addfile(info, src)
            else:
                tar.addfile(info)
    (assets / 'images.lock.json').write_bytes(source_files['images.lock.json'])
    manifest = {'schemaVersion': 1, 'product': 'Weave Workbench', 'version': version, 'tag': 'v' + version,
        'releaseType': 'unsigned-test-prerelease', 'sourceRevision': revision,
        'components': json.loads(blob('components.lock.json'))['components'], 'console': json.loads(source_files['console94.lock.json']),
        'desktop': {'sourceRevision': desktop_source, 'sourceTree': git('rev-parse', revision + ':desktop').decode().strip(),
            'treeVerifiedAgainstReleaseSource': True, 'workflowRunId': desktop_run, 'conclusion': 'success',
            'gates': [{'name': j['name'], 'conclusion': j['conclusion']} for j in jobs],
            'artifacts': [{k: a[k] for k in ('id', 'name', 'size_in_bytes', 'digest')} for a in selected],
            'packages': sorted(desktop, key=lambda p: p['file']), 'signed': False, 'notarized': False},
        'server': {'sourceRevision': revision, 'workflowRunId': server_run, 'workflowConclusion': server_state['conclusion'],
            'buildAndPublicationConclusion': 'success', 'failedSteps': failures, 'publicationProof': server_provenance,
            'images': image_lock, 'buildManifest': build_manifest, 'startupProofs': {n: json.loads(source_files[n]) for n in ('forge-server-proof.json', 'weave-server-proof.json')},
            'installationBundle': {'file': archive.name, 'bytes': archive.stat().st_size, 'sha256': digest(archive)}},
        'limits': {'autoUpdate': False, 'offlineImages': False, 'deploymentPerformedByThisRelease': False,
            'businessAcceptance': 'Paused at commercial contract co-review; subsequent business steps remain unverified.'}}
    write_json(assets / 'composition-manifest.json', manifest)
    (assets / 'SHA256SUMS.txt').write_text(''.join(digest(p) + '  ' + p.name + '\n' for p in sorted(assets.iterdir()) if p.name != 'SHA256SUMS.txt'))
    tag = 'v' + version
    exists = subprocess.run(['gh', 'release', 'view', tag, '--repo', repo], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert exists.returncode != 0, 'Existing release must never be overwritten'
    ref = api.get(f'repos/{repo}/git/ref/tags/{tag}', missing=True)
    if ref is None:
        subprocess.run(['gh', 'api', f'repos/{repo}/git/refs', '--method', 'POST', '-f', 'ref=refs/tags/' + tag, '-f', 'sha=' + revision], check=True, stdout=subprocess.DEVNULL)
    else:
        assert ref['object']['type'] == 'commit' and ref['object']['sha'] == revision
    notes = out / 'release-notes.md'
    notes.write_text(os.environ['RELEASE_NOTES'])
    subprocess.run(['gh', 'release', 'create', tag, '--repo', repo, '--target', revision, '--prerelease', '--latest=false', '--draft', '--title', f'Weave Workbench {version} · 三端未签名测试版', '--notes-file', str(notes), *map(str, sorted(assets.iterdir()))], check=True)
    release_id = json.loads(subprocess.check_output(['gh', 'release', 'view', tag, '--repo', repo, '--json', 'databaseId']))['databaseId']
    assert isinstance(release_id, int) and release_id > 0
    def readback():
        # The tag lookup excludes unpublished drafts; the release ID addresses both states.
        release = api.get(f'repos/{repo}/releases/{release_id}')
        actual = {a['name']: a for a in release['assets']}
        assert set(actual) == {p.name for p in assets.iterdir()}
        for p in assets.iterdir():
            a = actual[p.name]
            assert a['state'] == 'uploaded' and a['size'] == p.stat().st_size and a['digest'] == 'sha256:' + digest(p)
        ref = api.get(f'repos/{repo}/git/ref/tags/{tag}')
        assert ref['object']['type'] == 'commit' and ref['object']['sha'] == revision
        return release
    receipt = readback()
    assert receipt['draft'] is True and receipt['prerelease'] is True
    subprocess.run(['gh', 'release', 'edit', tag, '--repo', repo, '--draft=false', '--prerelease', '--latest=false'], check=True)
    receipt = readback()
    assert receipt['draft'] is False and receipt['prerelease'] is True
    write_json(out / 'release-readback.json', receipt)
    print('Published and independently read back', len(receipt['assets']), 'verified release assets:', receipt['html_url'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print a signed storage URL or credentials from transport errors.
        frame = error.__traceback__
        line = None
        while frame:
            if frame.tb_frame.f_code.co_filename == __file__:
                line = frame.tb_lineno
            frame = frame.tb_next
        print('Test release refused or incomplete. Error type:', type(error).__name__, 'publisher line:', line, file=sys.stderr)
        raise SystemExit(1) from None
