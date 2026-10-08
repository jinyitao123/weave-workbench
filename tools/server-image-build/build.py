#!/usr/bin/env python3
"""Build locked Linux server images; publish only after explicit private checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

# Share this module with resume.py when invoked as a script, including BuildError.
if __name__ == '__main__':
    sys.modules.setdefault('build', sys.modules[__name__])

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'sha256:[0-9a-f]{64}')
VERSION = re.compile(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?')
REPOSITORY = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+')
EXPECTED_PATHS = {'forge': 'platform/forge', 'weave': 'platform/weave'}


class BuildError(RuntimeError):
    pass


def digest_file(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def write_json(file, value):
    Path(file).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def run(args, cwd=ROOT, env=None, capture=True):
    result = subprocess.run([str(item) for item in args], cwd=cwd, env=env,
                            text=True, stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None, check=False)
    if result.returncode:
        # Do not echo credentials, environment, or arbitrary server error bodies.
        raise BuildError(f'{Path(str(args[0])).name} failed with exit {result.returncode}')
    return result.stdout.strip() if capture else ''


def git(*args, cwd=ROOT):
    return run(['git', '--no-optional-locks', '-C', cwd, *args])


def source_plan(repository, revision, version):
    if not REPOSITORY.fullmatch(repository):
        raise BuildError('Use a GitHub owner/repository name')
    if not SHA.fullmatch(revision) or git('rev-parse', 'HEAD') != revision:
        raise BuildError('The checkout must equal the requested full source SHA')
    if not VERSION.fullmatch(version):
        raise BuildError('Use an explicit semantic bundle version')
    lock = json.loads((ROOT / 'components.lock.json').read_text())
    if lock.get('schemaVersion') != 1:
        raise BuildError('Unsupported components lock')
    components = {}
    for name, import_path in EXPECTED_PATHS.items():
        item = lock.get('components', {}).get(name, {})
        source = item.get('source', '')
        if (item.get('importPath') != import_path or not SHA.fullmatch(item.get('revision', ''))
                or not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', source)):
            raise BuildError(f'Invalid locked component: {name}')
        git('cat-file', '-e', item['revision'] + '^{commit}')
        if git('rev-parse', item['revision'] + '^{tree}') != git('rev-parse', 'HEAD:' + import_path):
            raise BuildError(f'{name} source objects and integrated tree differ')
        components[name] = dict(item)
    console_file = ROOT / EXPECTED_PATHS['forge'] / 'apps/forge-objectstack/console94.lock.json'
    console = json.loads(console_file.read_text())
    source = console.get('source', {})
    match = re.fullmatch(r'https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\.git', source.get('repository', ''))
    if (console.get('schemaVersion') != 1 or not match or not SHA.fullmatch(source.get('revision', ''))
            or source.get('nodeVersion') != '24.19.0' or source.get('pnpmVersion') != '10.31.0'
            or not re.fullmatch(r'[0-9a-f]{64}', console.get('artifact', {}).get('packagedTreeSha256', ''))):
        raise BuildError('Invalid Console source/toolchain lock')
    runtime = console.get('forge', {}).get('runtimeImageReference', '')
    validate_digest_reference(runtime)
    weave_version = git('show', components['weave']['revision'] + ':VERSION').strip()
    if not VERSION.fullmatch(weave_version):
        raise BuildError('Locked Weave source has an invalid VERSION')
    prefix = 'ghcr.io/' + repository.lower()
    suffix = version + '-' + revision[:12]
    tags = {name: f'{prefix}-{ending}:{suffix}' for name, ending in
            [('forge', 'forge-app'), ('forgeProxy', 'forge-proxy'), ('weave', 'weave')]}
    return {
        'schemaVersion': 1, 'repository': repository, 'sourceRevision': revision,
        'bundleVersion': version, 'weaveVersion': weave_version,
        'platform': 'linux/amd64', 'components': components,
        'componentsLockSha256': digest_file(ROOT / 'components.lock.json'),
        'consoleLockSha256': digest_file(console_file), 'console': console,
        'objectuiRepository': match.group(1), 'tags': tags,
    }


def validate_digest_reference(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}', value):
        raise BuildError('An immutable image repository@sha256 digest is required')
    name = value.split('@')[0]
    if '://' in name or any(part in ('', '.', '..') for part in name.split('/')):
        raise BuildError('Invalid image repository')
    if name.rsplit('/', 1)[-1].partition(':')[2].lower() in ('latest', 'unknown'):
        raise BuildError('latest and unknown image tags are prohibited')
    return value


def postgres_reference(value):
    if not re.fullmatch(r'(?:docker\.io/library/)?postgres:16(?:\.[0-9]+)?(?:-[a-z0-9.-]+)?(?:@sha256:[0-9a-f]{64})?', value):
        raise BuildError('PostgreSQL input must be an explicit official major-16 tag, optionally with a digest')
    return value


def build_environment(profile):
    # The builder needs software download and registry access, never model or
    # business credentials. GitHub's API token is used by Github below only.
    allowed = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot',
               'DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY',
               'DOCKER_CERT_PATH', 'BUILDX_BUILDER', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
               'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    profile.mkdir()
    for name in ('user.npmrc', 'global.npmrc'):
        (profile / name).write_text('')
    env.update({'NPM_CONFIG_USERCONFIG': str(profile / 'user.npmrc'),
                'NPM_CONFIG_GLOBALCONFIG': str(profile / 'global.npmrc'),
                'NPM_CONFIG_REGISTRY': 'https://registry.npmjs.org',
                'CI': 'true', 'BUILDX_METADATA_PROVENANCE': 'max'})
    return env


class Github:
    def __init__(self, repository, token=None):
        self.repository = repository
        self.token = token or os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
        if not self.token:
            raise BuildError('Private publication requires a GitHub API token')
        self.owner_kind = None

    def get(self, route, missing=False):
        request = urllib.request.Request('https://api.github.com/' + route, headers={
            'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'weave-server-image-build',
        })
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise BuildError(f'GitHub visibility verification failed (HTTP {error.code})') from None

    def repository_verified(self):
        value = self.get('repos/' + self.repository)
        visibility = value.get('visibility')
        if visibility not in ('private', 'public') or value.get('private') is not (visibility == 'private'):
            raise BuildError('Source repository visibility could not be verified')
        self.repository_is_private = value['private']
        if value.get('full_name', '').lower() != self.repository.lower():
            raise BuildError('Unexpected repository identity')
        if type(value.get('id')) is not int or value['id'] < 1:
            raise BuildError('Repository identity is missing')
        self.repository_id = value['id']
        self.owner_kind = 'orgs' if value['owner']['type'] == 'Organization' else 'users'

    def package_private(self, image, missing=False):
        self.repository_verified()
        match = re.fullmatch(r'ghcr\.io/([^/]+)/([^:@]+)(?::[^@]+)?(?:@sha256:[0-9a-f]{64})?', image)
        owner = self.repository.split('/')[0]
        if not match or match.group(1).lower() != owner.lower():
            raise BuildError('Image owner differs from the source repository')
        route = f'{self.owner_kind}/{owner}/packages/container/{urllib.parse.quote(match.group(2), safe="")}'
        value = self.get(route, missing=missing)
        if value is None:
            if missing:
                return 'new-package'
            raise BuildError('Published container package visibility could not be read back')
        if value.get('visibility') != 'private' or value.get('package_type') != 'container':
            raise BuildError('Refusing to push to a non-private container package')
        linked = value.get('repository')
        # GitHub's package schema explicitly permits an absent/null repository.
        # Keep that metadata truthful; source is independently bound through the
        # actual OCI configuration and its verified registry manifest below.
        if linked is None:
            return 'private-association-not-reported'
        if (not isinstance(linked, dict) or linked.get('full_name', '').lower() != self.repository.lower()
                or linked.get('id') != self.repository_id or linked.get('private') is not self.repository_is_private):
            observed = {key: linked.get(key) for key in ('id', 'full_name', 'private')} if isinstance(linked, dict) else None
            raise BuildError('Container package must be linked to this source repository; observed association: ' + json.dumps(observed, sort_keys=True))
        return 'private'


def archive_source(revision, destination, work, env):
    destination.mkdir()
    archive = work / (destination.name + '.tar')
    run(['git', '-C', ROOT, 'archive', '--format=tar', '--output', archive, revision], env=env)
    run(['tar', '-xf', archive, '-C', destination], env=env)
    archive.unlink()


def build_command(plan, name, context, console, metadata):
    revision = plan['components']['weave' if name == 'weave' else 'forge']['revision']
    args = ['docker', 'buildx', 'build', '--platform', plan['platform'], '--load',
            '--provenance=false', '--metadata-file', str(metadata), '--tag', plan['tags'][name],
            '--label', 'org.opencontainers.image.source=https://github.com/' + plan['repository'],
            '--label', 'org.opencontainers.image.revision=' + revision,
            '--label', 'io.weave-workbench.source-revision=' + plan['sourceRevision'],
            '--label', 'org.opencontainers.image.version=' + plan['bundleVersion']]
    if name == 'weave':
        args += ['--target', 'server', '--build-arg', 'BUILD_COMMIT=' + revision,
                 '--build-arg', 'WEAVE_VERSION=' + plan['weaveVersion']]
    else:
        args += ['--target', 'app' if name == 'forge' else 'proxy',
                 '--build-context', 'console94=' + str(console),
                 '--build-arg', 'FORGE_SOURCE_REVISION=' + revision,
                 '--build-arg', 'CONSOLE_SOURCE_REVISION=' + plan['console']['source']['revision'],
                 '--build-arg', 'CONSOLE_TREE_SHA256=' + plan['console']['artifact']['packagedTreeSha256'],
                 '--build-arg', 'OBJECTSTACK_RUNTIME_IMAGE=' + plan['console']['forge']['runtimeImageReference']]
    return args + ['--file', str(context / 'Dockerfile'), str(context)]


def inspect_image(image, env, revision=None, repository=None, product_revision=None):
    value = json.loads(run(['docker', 'image', 'inspect', image], env=env))[0]
    if value.get('Os') != 'linux' or value.get('Architecture') != 'amd64':
        raise BuildError('Built image is not Linux amd64')
    if revision and value.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != revision:
        raise BuildError('Built image source label differs from components.lock')
    labels = value.get('Config', {}).get('Labels', {})
    if repository and labels.get('org.opencontainers.image.source') != 'https://github.com/' + repository:
        raise BuildError('Built OCI configuration names another source repository')
    if product_revision and labels.get('io.weave-workbench.source-revision') != product_revision:
        raise BuildError('Built OCI configuration names another product source revision')
    if not DIGEST.fullmatch(value.get('Id', '')):
        raise BuildError('Docker did not return a content-addressed image ID')
    return value


def verify_registry_config(manifest, image_id):
    config = manifest.get('config') if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or manifest.get('schemaVersion') != 2 or not isinstance(config, dict) or config.get('digest') != image_id:
        raise BuildError('Registry manifest does not bind the verified OCI configuration')


def verify_build_metadata(file, image_id):
    value = json.loads(Path(file).read_text())
    if value.get('containerimage.config.digest') != image_id:
        raise BuildError('BuildKit configuration digest differs from the loaded image')
    if not DIGEST.fullmatch(value.get('containerimage.digest', '')):
        raise BuildError('BuildKit manifest digest is missing')
    return value['containerimage.digest']


def image_lock(plan, references, postgres):
    components = {}
    for name in ('forge', 'forgeProxy', 'weave'):
        components[name] = {
            'image': validate_digest_reference(references[name]),
            'sourceRevision': plan['components']['weave' if name == 'weave' else 'forge']['revision'],
        }
    components['postgres'] = {'image': validate_digest_reference(postgres), 'major': 16}
    return {'version': 1, 'bundleVersion': plan['bundleVersion'], 'components': components}


def reusable_lock(plan, files):
    original = json.loads(files['build-manifest.json'])
    old_plan = original.get('plan', {})
    if (original.get('schemaVersion') != 1 or original.get('status') != 'published-private'
            or original.get('published') is not True or old_plan.get('repository') != plan['repository']
            or old_plan.get('bundleVersion') != plan['bundleVersion']
            or old_plan.get('components', {}).get('forge') != plan['components']['forge']
            or old_plan.get('console') != plan['console']):
        raise BuildError('Only unchanged Forge and Console from an original publication may be reused')
    return json.loads(files['images.lock.json'])


def validate_server_evidence(value, revision, loom_tree, postgres):
    if (value.get('target') != 'server' or value.get('cliExecutablesAbsent') is not True
            or value.get('cliPackagesAbsent') is not True or value.get('loomBinaryModulePresent') is not True
            or value.get('health', {}).get('build_commit') != revision
            or value.get('health', {}).get('status') != 'ok' or value.get('ready', {}).get('status') != 'ready'
            or value.get('loomTree') != loom_tree or value.get('loomModulePath') != './third_party/loom'
            or value.get('postgresImage') != postgres):
        raise BuildError('Actual server/CLI/Loom/health proof does not match the locked source')


def write_probe_diagnostic(path, containers, env, private_values):
    """Only failed probes emit this bounded, sanitized, separate artifact."""
    def sanitize(text):
        for value in sorted(private_values, key=len, reverse=True):
            if value:
                text = text.replace(value, '<redacted>')
        text = re.sub(r'https?://[^\s\"<>]+', '<redacted-url>', text)
        text = re.sub(r'postgres(?:ql)?://[^\s\"<>]+', '<redacted-database-url>', text)
        return text[-16384:]
    records = []
    for container in containers:
        record = {'container': container}
        for field, command in [('state', ['docker', 'inspect', '--format', '{{json .State}}', container]),
                               ('logs', ['docker', 'logs', '--tail', '60', container])]:
            with tempfile.TemporaryFile() as capture:
                try:
                    result = subprocess.run(command, env=env, stdout=capture, stderr=subprocess.STDOUT, timeout=10)
                    record[field + 'ExitCode'] = result.returncode
                except subprocess.TimeoutExpired:
                    record[field + 'ExitCode'] = 'timeout'
                length = capture.seek(0, 2)
                # Include overlap before redaction so a secret crossing the final
                # byte boundary cannot expose a suffix after output truncation.
                overlap = max((len(v.encode()) for v in private_values), default=0)
                capture.seek(max(0, length - 65536 - overlap))
                text = capture.read().decode('utf-8', errors='replace')
                record[field] = sanitize(text)
                record[field + 'Truncated'] = length > 16384
        records.append(record)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps({'schemaVersion': 1, 'status': 'failed-probe', 'containers': records}, indent=2) + '\n'
    with path.open('x', encoding='utf-8') as output:
        os.chmod(path, 0o600)
        output.write(data)


def verify_weave_server(plan, image, postgres, work, env, diagnostic_path=None):
    revision = plan['components']['weave']['revision']
    loom_tree = git('rev-parse', revision + ':third_party/loom')
    go_mod = git('show', revision + ':go.mod')
    if not re.search(r'(?m)^replace github\.com/jinyitao123/loom => \./third_party/loom\s*$', go_mod):
        raise BuildError('Weave must use its exact in-tree Loom module')
    # Inspect the actual runtime filesystem, not merely Dockerfile strings.
    run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'sh', image, '-ec',
         'for tool in opencode codex claude; do if command -v "$tool" >/dev/null 2>&1; then exit 1; fi; done; '
         'root=$(npm root -g); for package in opencode-ai @openai/codex @anthropic-ai/claude-code; '
         'do test ! -e "$root/$package"; done'], env=env)
    run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'node', image, '-e',
         "const b=require('fs').readFileSync('/usr/local/bin/weave');"
         "if(!b.includes(Buffer.from('github.com/jinyitao123/loom'))||!b.includes(Buffer.from('./third_party/loom')))process.exit(1)"], env=env)
    # Use the product's exact official PG16 image, never a pgvector substitute.
    if not re.fullmatch(r'(?:docker\.io/library/)?postgres@sha256:[0-9a-f]{64}', postgres):
        raise BuildError('Server probe requires the product-locked official PostgreSQL digest')
    run(['docker', 'pull', '--platform', 'linux/amd64', postgres], env=env)
    pg = inspect_image(postgres, env)
    if postgres.removeprefix('docker.io/library/') not in [x.removeprefix('docker.io/library/') for x in pg.get('RepoDigests', [])]:
        raise BuildError('Probe database registry digest differs')
    version = run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'postgres', postgres, '--version'], env=env)
    if not re.search(r'PostgreSQL\) 16\.', version):
        raise BuildError('Probe database is not PostgreSQL 16')
    name = 'weave-image-proof-' + secrets.token_hex(6)
    database, service = name + '-db', name + '-server'
    password = secrets.token_hex(24)
    jwt_secret, encryption_key = secrets.token_hex(32), secrets.token_hex(32)
    pg_env, app_env = work / 'probe-pg.env', work / 'probe-server.env'
    inputs = {
        pg_env: 'POSTGRES_PASSWORD=' + password + '\nPOSTGRES_DB=weave\n',
        app_env: 'DATABASE_URL=postgres://postgres:' + password + '@' + database + ':5432/weave?sslmode=disable\nJWT_SECRET=' + jwt_secret + '\nWEAVE_SECRET_KEY=' + encryption_key + '\nWEAVE_LOCAL_RUNTIME_ENABLED=false\n',
    }
    for path, content in inputs.items():
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
            output.write(content)
    created_network = False
    try:
        run(['docker', 'network', 'create', '--internal', name], env=env)
        created_network = True
        run(['docker', 'run', '-d', '--name', database, '--network', name, '--env-file', pg_env,
             '--tmpfs', '/var/lib/postgresql/data', postgres], env=env)
        for attempt in range(60):
            result = subprocess.run(['docker', 'exec', database, 'pg_isready', '-U', 'postgres', '-d', 'weave'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0: break
            time.sleep(1)
        else: raise BuildError('Isolated official PostgreSQL did not become ready')
        run(['docker', 'run', '-d', '--name', service, '--network', name, '--env-file', app_env, image], env=env)
        script = "Promise.all(['/v1/health','/v1/ready'].map(async p=>{const r=await fetch('http://127.0.0.1:8080'+p);if(!r.ok)throw Error('not ready');return r.json()})).then(([health,ready])=>console.log(JSON.stringify({health,ready}))).catch(()=>process.exit(1))"
        for attempt in range(90):
            result = subprocess.run(['docker', 'exec', service, 'node', '-e', script], env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
            if result.returncode == 0:
                response = json.loads(result.stdout)
                break
            time.sleep(1)
        else: raise BuildError('Server failed its empty official PostgreSQL health/readiness probe')
        proof = {'target': 'server', 'cliExecutablesAbsent': True, 'cliPackagesAbsent': True,
                 'loomBinaryModulePresent': True, 'loomTree': loom_tree, 'loomModulePath': './third_party/loom',
                 'postgresImage': postgres, **response}
        validate_server_evidence(proof, revision, loom_tree, postgres)
        return proof
    except Exception:
        if diagnostic_path is not None:
            try:
                write_probe_diagnostic(diagnostic_path, (service, database), env, (password, jwt_secret, encryption_key))
            except (OSError, subprocess.SubprocessError, ValueError):
                # Diagnostic collection must never suppress the original failure
                # or prevent this probe's containers and inputs being removed.
                print('Isolated server probe failed; bounded diagnostics could not be collected.', file=sys.stderr)
        raise
    finally:
        for container in (service, database):
            subprocess.run(['docker', 'rm', '-f', '-v', container], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if created_network:
            subprocess.run(['docker', 'network', 'rm', name], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pg_env.unlink(missing_ok=True); app_env.unlink(missing_ok=True)


def replace_weave(plan, base_revision, base_run, output, push):
    from resume import fetch_publication, REQUIRED
    if not push:
        raise BuildError('Weave replacement requires explicit private publication; no partial local combination')
    if git('status', '--porcelain=v1', '--untracked-files=all'):
        raise BuildError('Build from a committed clean checkout')
    if output.exists() and any(output.iterdir()):
        raise BuildError('Choose an empty output directory')
    base_files, old_lock, provenance = fetch_publication(plan['repository'], base_revision, plan['bundleVersion'], base_run, allow_replacement=False)
    lock = reusable_lock(plan, base_files)
    output.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED:
        (output / ('base-' + name)).write_bytes(base_files[name])
    identity = ('publicationRunId', 'publicationRevision', 'artifactId', 'archiveDigest', 'archiveBytes')
    origins = {name: base_revision for name in ('forge', 'forgeProxy', 'postgres')}
    origins['weave'] = plan['sourceRevision']
    manifest = {'schemaVersion': 2, 'kind': 'weave-replacement', 'status': 'building', 'published': False,
                'plan': plan, 'basePublication': {key: provenance[key] for key in identity},
                'componentBuildSources': origins, 'images': {}, 'builderSha256': digest_file(__file__)}
    write_json(output / 'build-manifest.json', manifest)
    api = Github(plan['repository'])
    try:
        api.repository_verified()
        with tempfile.TemporaryDirectory(prefix='work-', dir=output) as temporary:
            work = Path(temporary); env = build_environment(work / 'profile')
            run(['make', 'component-check'], env=env, capture=False)
            weave = work / 'weave'
            source = plan['components']['weave']['revision']
            archive_source(source, weave, work, env)
            metadata = output / 'weave-buildkit.json'; tag = plan['tags']['weave']
            run(build_command(plan, 'weave', weave, None, metadata), env=env, capture=False)
            image = inspect_image(tag, env, source, plan['repository'], plan['sourceRevision'])
            build_digest = verify_build_metadata(metadata, image['Id'])
            proof = verify_weave_server(plan, tag, lock['components']['postgres']['image'], work, env, output / 'failed/weave-server-probe.json')
            write_json(output / 'weave-server-proof.json', proof)
            api.package_private(tag, missing=True)
            run(['docker', 'push', tag], env=env, capture=False)
            api.package_private(tag)
            published = inspect_image(tag, env, source, plan['repository'], plan['sourceRevision'])
            if published['Id'] != image['Id']:
                raise BuildError('Weave changed during publication')
            prefix = tag.rsplit(':', 1)[0] + '@'
            refs = [x for x in published.get('RepoDigests', []) if x.startswith(prefix)]
            if len(refs) != 1: raise BuildError('Weave registry digest is ambiguous')
            ref = validate_digest_reference(refs[0])
            descriptor = json.loads(run(['docker', 'buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'], env=env))
            if descriptor.get('digest') != ref.split('@')[1]: raise BuildError('Weave registry readback differs')
            verify_registry_config(json.loads(run(['docker', 'buildx', 'imagetools', 'inspect', ref, '--raw'], env=env)), image['Id'])
            manifest['images']['weave'] = {'image': ref, 'tag': tag, 'target': 'server', 'sourceRevision': source,
                'localImageId': image['Id'], 'registryConfigDigest': image['Id'], 'visibility': 'private',
                'buildManifestDigest': build_digest, 'dockerfileSha256': digest_file(weave / 'Dockerfile'),
                'buildkitMetadataSha256': digest_file(metadata), 'serverProofSha256': digest_file(output / 'weave-server-proof.json')}
            lock['components']['weave'] = {'image': ref, 'sourceRevision': source}
            api.repository_verified()
            write_json(output / 'images.lock.json', lock)
            manifest.update(status='published-private', published=True)
            write_json(output / 'build-manifest.json', manifest)
    except Exception:
        manifest['status'] = 'failed'; write_json(output / 'build-manifest.json', manifest)
        raise
    print('Verified server-only Weave published; original Forge/proxy/PostgreSQL evidence retained unchanged.')


def execute(plan, objectui, output, postgres, push):
    if git('status', '--porcelain=v1', '--untracked-files=all'):
        raise BuildError('Build from a committed clean checkout; existing WIP is preserved')
    if not objectui:
        raise BuildError('--objectui-source must name the read-only locked ObjectUI checkout')
    objectui = Path(objectui).resolve()
    git('cat-file', '-e', plan['console']['source']['revision'] + '^{commit}', cwd=objectui)
    if output.exists() and any(output.iterdir()):
        raise BuildError('Choose an empty output directory; previous evidence is never overwritten')
    output.mkdir(parents=True, exist_ok=True)
    api = Github(plan['repository']) if push or os.environ.get('GITHUB_ACTIONS') == 'true' else None
    if api:
        api.repository_verified()
        if push:
            for image in plan['tags'].values():
                api.package_private(image, missing=True)
    manifest = {'schemaVersion': 1, 'status': 'building', 'plan': plan, 'images': {},
                'builderSha256': digest_file(__file__), 'published': False}
    write_json(output / 'build-manifest.json', manifest)
    try:
        with tempfile.TemporaryDirectory(prefix='work-', dir=output) as temporary:
            work = Path(temporary)
            env = build_environment(work / 'profile')
            if run(['node', '--version'], env=env) != 'v' + plan['console']['source']['nodeVersion']:
                raise BuildError('Node differs from the locked Console toolchain')
            if run(['pnpm', '--version'], env=env) != plan['console']['source']['pnpmVersion']:
                raise BuildError('pnpm differs from the locked Console toolchain')
            run(['make', 'component-check'], env=env, capture=False)
            manifest['dockerVersion'] = run(['docker', 'version', '--format', '{{.Server.Version}}'], env=env)
            manifest['buildxVersion'] = run(['docker', 'buildx', 'version'], env=env)
            for name in ('forge', 'weave'):
                archive_source(plan['components'][name]['revision'], work / name, work, env)
            forge = work / 'forge/apps/forge-objectstack'
            weave = work / 'weave'
            console = work / 'console94'
            console_env = dict(env, OBJECTUI_SOURCE_DIR=str(objectui), FORGE_CONSOLE_BUILD_CONTEXT=str(console))
            run(['node', forge / 'scripts/build-console94.mjs'], env=console_env, capture=False)
            run(['node', ROOT / 'tools/server-image-build/verify-console.mjs', forge, console], env=env, capture=False)
            manifest['consoleBuild'] = json.loads((console / 'console94-build.json').read_text())
            for name in ('console94-build.json', 'console94.lock.json'):
                shutil.copyfile(console / name, output / name)
            for name in ('forge', 'forgeProxy', 'weave'):
                context = weave if name == 'weave' else forge
                metadata = output / (name + '-buildkit.json')
                run(build_command(plan, name, context, console, metadata), env=env, capture=False)
                revision = plan['components']['weave' if name == 'weave' else 'forge']['revision']
                image = inspect_image(plan['tags'][name], env, revision, plan['repository'], plan['sourceRevision'])
                build_digest = verify_build_metadata(metadata, image['Id'])
                manifest['images'][name] = {'tag': plan['tags'][name], 'localImageId': image['Id'],
                                            'sourceRevision': revision, 'dockerfileSha256': digest_file(context / 'Dockerfile'),
                                            'buildManifestDigest': build_digest,
                                            'buildkitMetadataSha256': digest_file(metadata)}
                write_json(output / 'build-manifest.json', manifest)
            # Check the actual loaded Forge image using the same native CLI
            # resolver and tree verification used by its Dockerfile.
            run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'node',
                 '--mount', f'type=bind,src={ROOT / "tools/server-image-build"},dst=/image-proof,readonly',
                 '--mount', f'type=bind,src={forge / "scripts"},dst=/forge-proof,readonly',
                 '--mount', f'type=bind,src={console},dst=/console-proof,readonly',
                 plan['tags']['forge'], '/image-proof/verify-console.mjs', '/srv/app', '/console-proof', '/forge-proof'],
                env=env, capture=False)
            postgres_reference(postgres)
            run(['docker', 'pull', '--platform', plan['platform'], postgres], env=env, capture=False)
            pg_image = inspect_image(postgres, env)
            pg_version = run(['docker', 'run', '--rm', '--network=none', '--entrypoint', 'postgres', postgres, '--version'], env=env)
            if not re.search(r'PostgreSQL\) 16\.', pg_version):
                raise BuildError('PostgreSQL executable is not major 16')
            pg_digests = [ref for ref in pg_image.get('RepoDigests', []) if re.fullmatch(r'(?:docker\.io/library/)?postgres@sha256:[0-9a-f]{64}', ref)]
            if len(pg_digests) != 1:
                raise BuildError('Cannot determine the official PostgreSQL registry digest')
            pg_ref = validate_digest_reference(pg_digests[0])
            manifest['postgres'] = {'requestedImage': postgres, 'image': pg_ref, 'version': pg_version, 'localImageId': pg_image['Id']}
            if push:
                references = {}
                for name, tag in plan['tags'].items():
                    api.package_private(tag, missing=True)
                    run(['docker', 'push', tag], env=env, capture=False)
                    # New GHCR packages default private. Confirm the actual
                    # linked package, rather than assuming repository privacy.
                    association = api.package_private(tag)
                    image = inspect_image(tag, env, manifest['images'][name]['sourceRevision'], plan['repository'], plan['sourceRevision'])
                    expected_config = manifest['images'][name]['localImageId']
                    if image['Id'] != expected_config:
                        raise BuildError('The local image changed after its build verification')
                    prefix = tag.rsplit(':', 1)[0] + '@'
                    refs = [ref for ref in image.get('RepoDigests', []) if ref.startswith(prefix)]
                    if len(refs) != 1:
                        raise BuildError('Registry digest missing after private push')
                    references[name] = validate_digest_reference(refs[0])
                    remote = json.loads(run(['docker', 'buildx', 'imagetools', 'inspect', references[name], '--format', '{{json .Manifest}}'], env=env))
                    if remote.get('digest') != references[name].split('@')[1]:
                        raise BuildError('Published registry digest could not be read back')
                    remote_manifest = json.loads(run(['docker', 'buildx', 'imagetools', 'inspect', references[name], '--raw'], env=env))
                    verify_registry_config(remote_manifest, expected_config)
                    manifest['images'][name]['image'] = references[name]
                    manifest['images'][name]['visibility'] = 'private'
                    manifest['images'][name]['repositoryAssociation'] = 'not_reported' if association == 'private-association-not-reported' else 'linked'
                    manifest['images'][name]['registryConfigDigest'] = expected_config
                    write_json(output / 'build-manifest.json', manifest)
                api.repository_verified()
                write_json(output / 'images.lock.json', image_lock(plan, references, pg_ref))
                manifest['published'] = True
            if api:
                api.repository_verified()
            manifest['status'] = 'published-private' if push else 'built-local'
            write_json(output / 'build-manifest.json', manifest)
    except Exception:
        manifest['status'] = 'failed'
        write_json(output / 'build-manifest.json', manifest)
        raise
    print('Server image build complete:', manifest['status'])
    if not push:
        print('No installer image lock emitted: local images have not been published.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--bundle-version', required=True)
    parser.add_argument('--objectui-source')
    parser.add_argument('--replace-weave-from-run', type=int)
    parser.add_argument('--base-revision')
    parser.add_argument('--postgres-image', default='postgres:16-bookworm')
    parser.add_argument('--output', default=str(ROOT / '.build/server-image-build/output'))
    parser.add_argument('--plan', action='store_true', help='Read-only source validation; no downloads or Docker calls')
    parser.add_argument('--github-output', help='Append validated checkout/toolchain outputs for GitHub Actions')
    parser.add_argument('--push-private', action='store_true', help='Explicitly publish to verified private GHCR packages')
    args = parser.parse_args()
    plan = source_plan(args.repository, args.revision, args.bundle_version)
    postgres_reference(args.postgres_image)
    if args.plan:
        if args.push_private:
            raise BuildError('--plan cannot publish')
        print(json.dumps(plan, indent=2))
        if args.github_output:
            with open(args.github_output, 'a', encoding='utf-8') as file:
                for key, value in {'objectui_repository': plan['objectuiRepository'],
                                   'objectui_revision': plan['console']['source']['revision'],
                                   'node_version': plan['console']['source']['nodeVersion'],
                                   'pnpm_version': plan['console']['source']['pnpmVersion']}.items():
                    file.write(f'{key}={value}\n')
        return
    if args.github_output:
        raise BuildError('--github-output is only for --plan')
    if args.replace_weave_from_run is not None:
        if not args.base_revision or not SHA.fullmatch(args.base_revision) or args.replace_weave_from_run < 1:
            raise BuildError('Replacement requires the exact original publication run and source')
        replace_weave(plan, args.base_revision, args.replace_weave_from_run, Path(args.output).resolve(), args.push_private)
    else:
        if args.base_revision:
            raise BuildError('--base-revision requires --replace-weave-from-run')
        execute(plan, args.objectui_source, Path(args.output).resolve(), args.postgres_image, args.push_private)


if __name__ == '__main__':
    try:
        main()
    except (BuildError, OSError, ValueError, KeyError) as error:
        print('Server image build failed:', str(error), file=sys.stderr)
        sys.exit(1)
