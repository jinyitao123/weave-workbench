#!/usr/bin/env python3
"""Restore one verified publication artifact for the existing SSH staging step."""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from build import BuildError, DIGEST, Github, REPOSITORY, ROOT, SHA, VERSION, git, validate_digest_reference, write_json

WORKFLOW = '.github/workflows/server-image-build.yml'
MAX_ARCHIVE = 8 * 1024 * 1024
MAX_EXPANDED = 32 * 1024 * 1024
REQUIRED = {'build-manifest.json', 'images.lock.json', 'console94-build.json', 'console94.lock.json',
            'forge-buildkit.json', 'forgeProxy-buildkit.json', 'weave-buildkit.json'}
ALLOWED = REQUIRED | {'host-staging-receipt.json'}
FULL_REQUIRED = REQUIRED | {'forge-server-proof.json', 'weave-server-proof.json'}
FULL_ALLOWED = FULL_REQUIRED | {'host-staging-receipt.json'}
REPLACEMENT_REQUIRED = {'build-manifest.json', 'images.lock.json', 'weave-buildkit.json', 'weave-server-proof.json'} | {'base-' + name for name in REQUIRED}
REPLACEMENT_ALLOWED = REPLACEMENT_REQUIRED | {'host-staging-receipt.json'}
SUFFIXES = {'forge': 'forge-app', 'forgeProxy': 'forge-proxy', 'weave': 'weave'}


def validate_run(run, workflow, repository, repository_id, run_id, revision):
    if (run.get('id') != run_id or run.get('head_sha') != revision or run.get('status') != 'completed'
            or run.get('workflow_id') != workflow.get('id') or workflow.get('path') != WORKFLOW
            or run.get('path', '').split('@', 1)[0] != WORKFLOW):
        raise BuildError('Publication run is not the completed requested source/workflow')
    for key in ('repository', 'head_repository'):
        value = run.get(key, {})
        if value.get('id') != repository_id or value.get('full_name', '').lower() != repository.lower():
            raise BuildError('Publication run belongs to another repository or fork')


def choose_artifact(items, name, run_id, revision):
    matches = [item for item in items if item.get('name') == name]
    if len(matches) != 1:
        raise BuildError('The exact publication artifact is absent or ambiguous')
    artifact = matches[0]
    if (artifact.get('expired') is not False or type(artifact.get('id')) is not int
            or type(artifact.get('size_in_bytes')) is not int or not 0 < artifact['size_in_bytes'] <= MAX_ARCHIVE
            or not isinstance(artifact.get('digest'), str) or not DIGEST.fullmatch(artifact['digest'])):
        raise BuildError('Publication artifact lacks a bounded official archive digest')
    origin = artifact.get('workflow_run', {})
    if origin.get('id') != run_id or origin.get('head_sha') != revision:
        raise BuildError('Artifact belongs to another publication run/source')
    return artifact


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def download_archive(api, artifact):
    # The API redirect carries a short-lived signed storage URL. Never forward
    # the GitHub Authorization header to that storage host or print the URL.
    url = f'https://api.github.com/repos/{api.repository}/actions/artifacts/{artifact["id"]}/zip'
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + api.token,
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(request, timeout=30)
    except urllib.error.HTTPError as error:
        if error.code != 302:
            raise BuildError(f'Artifact download authorization failed (HTTP {error.code})') from None
        location = error.headers.get('Location', '')
        target = urllib.parse.urlsplit(location)
        if target.scheme != 'https' or not target.hostname or target.username or target.password:
            raise BuildError('Invalid artifact storage redirect')
        try:
            response = opener.open(urllib.request.Request(location), timeout=60)
        except urllib.error.URLError:
            raise BuildError('Signed artifact download failed') from None
    except urllib.error.URLError:
        raise BuildError('Artifact API download failed') from None
    with response:
        data = response.read(MAX_ARCHIVE + 1)
    if len(data) != artifact['size_in_bytes'] or len(data) > MAX_ARCHIVE:
        raise BuildError('Artifact archive size differs from GitHub metadata')
    if 'sha256:' + hashlib.sha256(data).hexdigest() != artifact['digest']:
        raise BuildError('Artifact archive SHA256 differs from GitHub metadata')
    return data


def read_archive(data):
    files = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > len(REPLACEMENT_ALLOWED) or sum(item.file_size for item in entries) > MAX_EXPANDED:
                raise BuildError('Publication archive exceeds its content bounds')
            for item in entries:
                mode = item.external_attr >> 16
                if (item.filename not in ALLOWED | FULL_ALLOWED | REPLACEMENT_ALLOWED or item.orig_filename != item.filename or item.filename in files
                        or item.is_dir() or item.flag_bits & 1 or item.file_size > MAX_ARCHIVE
                        or stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise BuildError('Unsafe or unexpected publication ZIP entry')
                files[item.filename] = archive.read(item)
    except (zipfile.BadZipFile, RuntimeError):
        raise BuildError('Invalid publication ZIP archive') from None
    manifest = json.loads(files.get('build-manifest.json', b'{}'))
    replacement = isinstance(manifest, dict) and manifest.get('kind') == 'weave-replacement'
    if replacement:
        required, allowed = REPLACEMENT_REQUIRED, REPLACEMENT_ALLOWED
    elif isinstance(manifest, dict) and manifest.get('schemaVersion') == 3:
        required, allowed = FULL_REQUIRED, FULL_ALLOWED
    else:
        required, allowed = REQUIRED, ALLOWED
    if not required.issubset(files) or not set(files).issubset(allowed):
        raise BuildError('Publication artifact is incomplete or contains unrelated evidence')
    return files


def validate_publication(files, repository, revision, version, components_bytes, console_bytes, dockerfiles, require_probes=False, loom_tree=None):
    documents = {name: json.loads(value) for name, value in files.items()}
    manifest, lock = documents['build-manifest.json'], documents['images.lock.json']
    plan = manifest.get('plan', {})
    components, console = json.loads(components_bytes), json.loads(console_bytes)
    probed = manifest.get('schemaVersion') == 3 and manifest.get('kind') == 'full-server-probed'
    if require_probes and not probed:
        raise BuildError('This publication source requires actual full-server startup proofs')
    if (manifest.get('schemaVersion') not in (1, 3) or (manifest.get('schemaVersion') == 3 and not probed) or manifest.get('status') != 'published-private'
            or manifest.get('published') is not True or plan.get('schemaVersion') != 1
            or plan.get('repository') != repository or plan.get('sourceRevision') != revision
            or plan.get('bundleVersion') != version or plan.get('platform') != 'linux/amd64'
            or plan.get('componentsLockSha256') != hashlib.sha256(components_bytes).hexdigest()
            or plan.get('consoleLockSha256') != hashlib.sha256(console_bytes).hexdigest()
            or plan.get('console') != console or documents['console94.lock.json'] != console):
        raise BuildError('Artifact is not the exact verified private publication')
    sys.path.insert(0, str(ROOT / 'tools/server-bundle'))
    try:
        from configuration import validate_images
        validate_images(lock)
    finally:
        sys.path.pop(0)
    if lock['bundleVersion'] != version or set(manifest.get('images', {})) != set(SUFFIXES):
        raise BuildError('Published image lock/manifest component set differs')
    if plan.get('components') != {name: components['components'][name] for name in ('forge', 'weave')}:
        raise BuildError('Published components differ from the publication commit lock')
    for name, suffix in SUFFIXES.items():
        item, proof = lock['components'][name], manifest['images'][name]
        source = components['components']['weave' if name == 'weave' else 'forge']['revision']
        image = validate_digest_reference(item['image'])
        expected_repo = f'ghcr.io/{repository.lower()}-{suffix}'
        tag = f'{expected_repo}:{version}-{revision[:12]}'
        local_id = proof.get('localImageId', '')
        if (image.split('@')[0] != expected_repo or item['sourceRevision'] != source
                or proof.get('image') != image or proof.get('sourceRevision') != source
                or proof.get('tag') != tag or plan.get('tags', {}).get(name) != tag
                or proof.get('visibility') != 'private' or not DIGEST.fullmatch(local_id)
                or proof.get('registryConfigDigest') != local_id
                or proof.get('dockerfileSha256') != hashlib.sha256(dockerfiles[name]).hexdigest()):
            raise BuildError('Published immutable image/config/source proof differs')
        metadata_name = name + '-buildkit.json'
        metadata = documents[metadata_name]
        if (proof.get('buildkitMetadataSha256') != hashlib.sha256(files[metadata_name]).hexdigest()
                or metadata.get('containerimage.config.digest') != local_id
                or proof.get('buildManifestDigest') != metadata.get('containerimage.digest')):
            raise BuildError('Published BuildKit proof differs from the verified image')
    pg = manifest.get('postgres', {})
    if (pg.get('image') != lock['components']['postgres']['image']
            or not pg.get('version', '').startswith('postgres (PostgreSQL) 16.')
            or not DIGEST.fullmatch(pg.get('localImageId', ''))):
        raise BuildError('Published PostgreSQL 16 proof differs')
    built_console = documents['console94-build.json']
    if (manifest.get('consoleBuild') != built_console
            or built_console.get('sourceRevision') != console['source']['revision']
            or built_console.get('sourceTreeSha256') != console['artifact']['runtimeSourceTreeSha256']
            or built_console.get('packagedTreeSha256') != console['artifact']['packagedTreeSha256']):
        raise BuildError('Published Console proof differs from its source lock')
    if probed:
        from build import validate_forge_evidence, validate_server_evidence
        if loom_tree is None or not SHA.fullmatch(loom_tree):
            raise BuildError('A full-server proof needs the immutable Loom source tree')
        for name in ('forge', 'weave'):
            file = name + '-server-proof.json'
            if file not in files or manifest['images'][name].get('serverProofSha256') != hashlib.sha256(files[file]).hexdigest():
                raise BuildError('Server startup proof is absent or changed')
        validate_forge_evidence(json.loads(files['forge-server-proof.json']), manifest['images']['forge']['localImageId'],
                                components['components']['forge']['revision'], revision, pg['image'])
        proof = json.loads(files['weave-server-proof.json'])
        if (proof.get('imageConfigDigest') != manifest['images']['weave']['localImageId']
                or proof.get('sourceRevision') != components['components']['weave']['revision']
                or proof.get('productSourceRevision') != revision):
            raise BuildError('Weave startup proof identifies another image or source')
        validate_server_evidence(proof, components['components']['weave']['revision'], loom_tree, pg['image'])
    return lock


def validate_replacement(files, repository, revision, version, components_bytes, console_bytes, dockerfiles,
                         base_files, base_proof, go_mod, loom_tree):
    from build import reusable_lock, validate_server_evidence
    manifest = json.loads(files['build-manifest.json'])
    plan = manifest.get('plan', {})
    components, console = json.loads(components_bytes), json.loads(console_bytes)
    identity = ('publicationRunId', 'publicationRevision', 'artifactId', 'archiveDigest', 'archiveBytes')
    if (manifest.get('schemaVersion') != 2 or manifest.get('kind') != 'weave-replacement'
            or manifest.get('published') is not True or manifest.get('status') != 'published-private'
            or plan.get('repository') != repository or plan.get('sourceRevision') != revision
            or plan.get('bundleVersion') != version or plan.get('platform') != 'linux/amd64'
            or plan.get('schemaVersion') != 1
            or plan.get('components') != {name: components['components'][name] for name in ('forge', 'weave')}
            or plan.get('componentsLockSha256') != hashlib.sha256(components_bytes).hexdigest()
            or plan.get('consoleLockSha256') != hashlib.sha256(console_bytes).hexdigest() or plan.get('console') != console
            or manifest.get('basePublication') != {key: base_proof[key] for key in identity}
            or set(manifest.get('images', {})) != {'weave'}):
        raise BuildError('Replacement source or original publication identity differs')
    for name in REQUIRED:
        if files.get('base-' + name) != base_files[name]:
            raise BuildError('Original publication evidence was rewritten')
    old_lock = reusable_lock(plan, base_files)
    lock = json.loads(files['images.lock.json'])
    sys.path.insert(0, str(ROOT / 'tools/server-bundle'))
    try:
        from configuration import validate_images
        validate_images(lock)
    finally:
        sys.path.pop(0)
    expected_origins = {name: base_proof['publicationRevision'] for name in ('forge', 'forgeProxy', 'postgres')}
    expected_origins['weave'] = revision
    if manifest.get('componentBuildSources') != expected_origins or lock['bundleVersion'] != version:
        raise BuildError('Component build origins differ')
    for name in ('forge', 'forgeProxy', 'postgres'):
        if lock['components'][name] != old_lock['components'][name]:
            raise BuildError('Replacement changed a reused image')
    item, evidence = lock['components']['weave'], manifest['images']['weave']
    source = components['components']['weave']['revision']
    image = validate_digest_reference(item['image'])
    expected_tag = f'ghcr.io/{repository.lower()}-weave:{version}-{revision[:12]}'
    metadata = json.loads(files['weave-buildkit.json'])
    local = evidence.get('localImageId', '')
    if (image.split('@')[0] != f'ghcr.io/{repository.lower()}-weave' or item['sourceRevision'] != source
            or evidence.get('image') != image or evidence.get('sourceRevision') != source
            or evidence.get('tag') != expected_tag or plan.get('tags', {}).get('weave') != expected_tag
            or evidence.get('target') != 'server' or evidence.get('visibility') != 'private'
            or not DIGEST.fullmatch(local) or evidence.get('registryConfigDigest') != local
            or metadata.get('containerimage.config.digest') != local
            or evidence.get('buildManifestDigest') != metadata.get('containerimage.digest')
            or evidence.get('dockerfileSha256') != hashlib.sha256(dockerfiles['weave']).hexdigest()
            or evidence.get('buildkitMetadataSha256') != hashlib.sha256(files['weave-buildkit.json']).hexdigest()
            or evidence.get('serverProofSha256') != hashlib.sha256(files['weave-server-proof.json']).hexdigest()):
        raise BuildError('Replacement Weave image/config/source proof differs')
    if not re.search(rb'(?m)^replace github\.com/jinyitao123/loom => \./third_party/loom\s*$', go_mod):
        raise BuildError('Weave no longer uses the verified in-tree Loom module')
    validate_server_evidence(json.loads(files['weave-server-proof.json']), source, loom_tree,
                             old_lock['components']['postgres']['image'])
    return lock


def fetch_publication(repository, revision, version, run_id, allow_replacement=True):
    if not REPOSITORY.fullmatch(repository) or not SHA.fullmatch(revision) or not VERSION.fullmatch(version) or run_id < 1:
        raise BuildError('Use an exact publication source, version and run ID')
    api = Github(repository)
    api.repository_verified()
    workflow = api.get(f'repos/{repository}/actions/workflows/server-image-build.yml')
    run = api.get(f'repos/{repository}/actions/runs/{run_id}')
    validate_run(run, workflow, repository, api.repository_id, run_id, revision)
    items = []
    for page in range(1, 11):
        value = api.get(f'repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100&page={page}')
        batch, total = value.get('artifacts'), value.get('total_count')
        if not isinstance(batch, list) or type(total) is not int or total > 1000:
            raise BuildError('Incomplete publication artifact listing')
        items.extend(batch)
        if len(items) == total:
            break
        if not batch or len(items) > total:
            raise BuildError('Inconsistent publication artifact pagination')
    else:
        raise BuildError('Publication artifact listing exceeded its bound')
    name = f'server-images-{version}-{revision}'
    artifact = choose_artifact(items, name, run_id, revision)
    files = read_archive(download_archive(api, artifact))
    # The new controller checkout is intentionally NOT the old publication.
    # Read that publication's immutable Git objects, never call source_plan().
    def blob(file):
        try:
            return subprocess.check_output(['git', '--no-optional-locks', '-C', str(ROOT), 'show', revision + ':' + file], stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            raise BuildError('Publication source Git object is unavailable') from None
    components = blob('components.lock.json')
    console = blob('platform/forge/apps/forge-objectstack/console94.lock.json')
    forge_docker = blob('platform/forge/apps/forge-objectstack/Dockerfile')
    dockerfiles = {'forge': forge_docker, 'forgeProxy': forge_docker, 'weave': blob('platform/weave/Dockerfile')}
    manifest = json.loads(files['build-manifest.json'])
    if manifest.get('kind') == 'weave-replacement':
        if not allow_replacement:
            raise BuildError('A replacement must reuse an original full publication, never another replacement')
        base = manifest.get('basePublication', {})
        base_files, base_lock, base_proof = fetch_publication(repository, base.get('publicationRevision', ''), version,
                                                             base.get('publicationRunId', 0), allow_replacement=False)
        lock = validate_replacement(files, repository, revision, version, components, console, dockerfiles,
                                    base_files, base_proof, blob('platform/weave/go.mod'),
                                    git('rev-parse', revision + ':platform/weave/third_party/loom'))
    else:
        builder = blob('tools/server-image-build/build.py')
        require_probes = b'FULL_SERVER_PROBE_SCHEMA = 3' in builder
        lock = validate_publication(files, repository, revision, version, components, console, dockerfiles,
                                    require_probes=require_probes,
                                    loom_tree=git('rev-parse', revision + ':platform/weave/third_party/loom') if require_probes else None)
        if manifest.get('builderSha256') != hashlib.sha256(builder).hexdigest():
            raise BuildError('Publication builder differs from its immutable source')
    states = {name: api.package_private(lock['components'][name]['image']) for name in SUFFIXES}
    api.repository_verified()
    proof = {'schemaVersion': 1, 'publicationRunId': run_id,
        'publicationRevision': revision, 'publicationConclusion': run.get('conclusion'),
        'controllerRevision': git('rev-parse', 'HEAD'), 'artifactId': artifact['id'],
        'artifactName': artifact['name'], 'archiveDigest': artifact['digest'],
        'archiveBytes': artifact['size_in_bytes'], 'packagePrivateReadback': states,
        'rebuilt': False, 'republished': False,
        'fullServerStartupVerified': manifest.get('schemaVersion') == 3 and manifest.get('kind') == 'full-server-probed'}
    return files, lock, proof


def resume(repository, revision, version, run_id, output):
    if output.exists() and any(output.iterdir()):
        raise BuildError('Resume output must be empty; prior evidence is preserved')
    files, lock, proof = fetch_publication(repository, revision, version, run_id)
    output.mkdir(parents=True)
    for name, data in files.items():
        if name != 'host-staging-receipt.json':
            (output / name).write_bytes(data)
    write_json(output / 'resume-proof.json', proof)
    print('Verified publication restored; continuing only to existing host staging.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', required=True)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--bundle-version', required=True)
    parser.add_argument('--published-run-id', required=True, type=int)
    parser.add_argument('--output', type=Path, default=ROOT / '.build/server-image-build/output')
    args = parser.parse_args()
    try:
        resume(args.repository, args.revision, args.bundle_version, args.published_run_id, args.output)
    except (BuildError, OSError, ValueError, KeyError, TypeError):
        print('Published-image resume refused; run, artifact, source or private-state validation failed.', file=sys.stderr)
        sys.exit(1)
