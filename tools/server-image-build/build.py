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
import urllib.error
import urllib.parse
import urllib.request

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


def console_environment(env, objectui, output):
    result = dict(env, OBJECTUI_SOURCE_DIR=str(objectui), FORGE_CONSOLE_BUILD_CONTEXT=str(output))
    # The locked ObjectUI artifact includes gzip/Brotli files. Its Vite config
    # skips them for any nonempty CI/VERCEL value, including the string "false".
    # Match that artifact's build inputs without changing the parent CI process.
    result.pop('CI', None)
    result.pop('VERCEL', None)
    return result


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

    def repository_private(self):
        value = self.get('repos/' + self.repository)
        if value.get('private') is not True or value.get('visibility') != 'private':
            raise BuildError('Publication requires the current repository to be private')
        if value.get('full_name', '').lower() != self.repository.lower():
            raise BuildError('Unexpected repository identity')
        self.owner_kind = 'orgs' if value['owner']['type'] == 'Organization' else 'users'

    def package_private(self, image, missing=False):
        self.repository_private()
        match = re.fullmatch(r'ghcr\.io/([^/]+)/([^:@]+)(?::[^@]+)?(?:@sha256:[0-9a-f]{64})?', image)
        owner = self.repository.split('/')[0]
        if not match or match.group(1).lower() != owner.lower():
            raise BuildError('Image owner differs from the private source repository')
        route = f'{self.owner_kind}/{owner}/packages/container/{urllib.parse.quote(match.group(2), safe="")}'
        value = self.get(route, missing=missing)
        if value is None:
            if missing:
                return 'new-package'
            raise BuildError('Published container package visibility could not be read back')
        if value.get('visibility') != 'private' or value.get('package_type') != 'container':
            raise BuildError('Refusing to push to a non-private container package')
        linked = value.get('repository')
        if not linked or linked.get('full_name', '').lower() != self.repository.lower() or linked.get('private') is not True:
            raise BuildError('Container package must be linked to this private source repository')
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
        args += ['--build-arg', 'BUILD_COMMIT=' + revision,
                 '--build-arg', 'WEAVE_VERSION=' + plan['weaveVersion']]
    else:
        args += ['--target', 'app' if name == 'forge' else 'proxy',
                 '--build-context', 'console94=' + str(console),
                 '--build-arg', 'FORGE_SOURCE_REVISION=' + revision,
                 '--build-arg', 'CONSOLE_SOURCE_REVISION=' + plan['console']['source']['revision'],
                 '--build-arg', 'CONSOLE_TREE_SHA256=' + plan['console']['artifact']['packagedTreeSha256'],
                 '--build-arg', 'OBJECTSTACK_RUNTIME_IMAGE=' + plan['console']['forge']['runtimeImageReference']]
    return args + ['--file', str(context / 'Dockerfile'), str(context)]


def inspect_image(image, env, revision=None):
    value = json.loads(run(['docker', 'image', 'inspect', image], env=env))[0]
    if value.get('Os') != 'linux' or value.get('Architecture') != 'amd64':
        raise BuildError('Built image is not Linux amd64')
    if revision and value.get('Config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != revision:
        raise BuildError('Built image source label differs from components.lock')
    if not DIGEST.fullmatch(value.get('Id', '')):
        raise BuildError('Docker did not return a content-addressed image ID')
    return value


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
        api.repository_private()
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
            console_env = console_environment(env, objectui, console)
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
                image = inspect_image(plan['tags'][name], env, revision)
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
                    api.package_private(tag)
                    image = inspect_image(tag, env, manifest['images'][name]['sourceRevision'])
                    prefix = tag.rsplit(':', 1)[0] + '@'
                    refs = [ref for ref in image.get('RepoDigests', []) if ref.startswith(prefix)]
                    if len(refs) != 1:
                        raise BuildError('Registry digest missing after private push')
                    references[name] = validate_digest_reference(refs[0])
                    remote = json.loads(run(['docker', 'buildx', 'imagetools', 'inspect', references[name], '--format', '{{json .Manifest}}'], env=env))
                    if remote.get('digest') != references[name].split('@')[1]:
                        raise BuildError('Published registry digest could not be read back')
                    manifest['images'][name]['image'] = references[name]
                    manifest['images'][name]['visibility'] = 'private'
                    write_json(output / 'build-manifest.json', manifest)
                api.repository_private()
                write_json(output / 'images.lock.json', image_lock(plan, references, pg_ref))
                manifest['published'] = True
            if api:
                api.repository_private()
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
    execute(plan, args.objectui_source, Path(args.output).resolve(), args.postgres_image, args.push_private)


if __name__ == '__main__':
    try:
        main()
    except (BuildError, OSError, ValueError, KeyError) as error:
        print('Server image build failed:', str(error), file=sys.stderr)
        sys.exit(1)
