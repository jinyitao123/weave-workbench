#!/usr/bin/env python3
"""A single-host installer that composes existing Forge and Weave entrypoints."""
import argparse
import getpass
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from configuration import (ConfigurationError, compose_environment, initialize,
                           installation_lock, load_state, private_read,
                           read_model_key, write_private)

HERE = Path(__file__).resolve().parent
DEFAULT_STATE = '/var/lib/weave-workbench'
MODEL = 'deepseek-flash'


class OperationError(RuntimeError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(origin, path, token=None, method='GET', body=None):
    headers = {'Accept': 'application/json', 'Origin': origin, 'Referer': origin + '/'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    payload = json.dumps(body).encode() if body is not None else None
    request = Request(origin + path, data=payload, headers=headers, method=method)
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            data = response.read(1048577)
            if len(data) > 1048576:
                raise OperationError('The service response exceeded the allowed size.')
            return json.loads(data)
    except HTTPError as error:
        status = error.code
        error.close()
        raise OperationError(f'Service request {path} returned HTTP {status}; no response body was logged.') from None
    except (URLError, TimeoutError, OSError, UnicodeError, json.JSONDecodeError):
        raise OperationError(f'Service request {path} did not return a valid response.') from None


def object_response(value, label):
    if not isinstance(value, dict):
        raise OperationError(f'{label} returned an unrecognized response.')
    return value


class Docker:
    def __init__(self, state, runner=subprocess.run):
        self.state = state
        self.runner = runner

    def run(self, command, label, env=None):
        print(label + '...', file=sys.stderr, flush=True)
        environment = {k: v for k, v in os.environ.items() if not k.startswith(('COMPOSE_', 'WW_'))}
        if env:
            environment.update(env)
        try:
            result = self.runner(command, env=environment, capture_output=True, text=True, check=False)
        except OSError:
            raise OperationError(f'{label} could not start.') from None
        if result.returncode:
            # Docker/bootstrap errors can include substituted credentials.
            raise OperationError(f'{label} failed (exit {result.returncode}); private service logs require administrator inspection.')
        return result.stdout

    def preflight(self, install_missing=False):
        if platform.system() != 'Linux':
            raise OperationError('Server operations require Linux; local logic validation does not install services.')
        if not shutil.which('docker'):
            if not install_missing:
                raise OperationError('Docker is missing. Run install --install-docker on Ubuntu 22.04/24.04/26.04, or install Docker Engine and Compose first.')
            self.run(['sh', str(HERE / 'bootstrap-docker.sh')], 'Docker prerequisite installation')
        host = os.environ.get('DOCKER_HOST', '')
        if host and not host.startswith('unix://'):
            raise OperationError('This single-host installer refuses a remote DOCKER_HOST.')
        context = json.loads(self.run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], 'Docker context inspection'))
        if not isinstance(context, str) or not context.startswith('unix://'):
            raise OperationError('Select a local Unix-socket Docker context before installing.')
        version = self.run(['docker', 'compose', 'version', '--short'], 'Compose version check').strip()
        match = re.match(r'^v?(\d+)\.(\d+)\.(\d+)', version)
        if not match or tuple(map(int, match.groups())) < (2, 20, 0):
            raise OperationError('Docker Compose 2.20 or newer is required.')
        if self.run(['docker', 'info', '--format', '{{.OSType}}'], 'Docker daemon check').strip() != 'linux':
            raise OperationError('The Docker daemon must run Linux containers.')

    def compose(self, arguments, label):
        compose_directory = Path(self.state.get('composeDirectory', HERE))
        return self.run(['docker', 'compose', '--env-file', '/dev/null',
                         '--project-name', self.state['projectName'],
                         '--project-directory', str(compose_directory), '-f', str(compose_directory / 'compose.yaml'),
                         *arguments], label, compose_environment(self.state))

    def start(self):
        self.compose(['config', '--quiet'], 'Compose validation')
        self.compose(['pull', '--policy', 'missing'], 'Pull missing pinned images (authenticate with docker login when required)')
        self.compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'forge-db', 'weave-db'], 'Database startup')
        for name in ('forge-db', 'weave-db'):
            version = self.compose(['exec', '-T', name, 'postgres', '--version'], 'PostgreSQL version check')
            if not re.search(r'PostgreSQL\) 16\.', version):
                raise OperationError('A database image is not PostgreSQL 16. Application startup was refused; volumes were preserved.')
        self.compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '300'], 'Application startup')

    def refresh_weave(self):
        self.compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '180', 'weave'], 'Weave configuration activation')

    def stop(self):
        self.compose(['stop'], 'Service stop')

    def forge_from_container(self):
        # No session or model credential is placed on the command line.
        code = """(async()=>{const u=new URL('/api/v1/workbench/identity-source',process.env.WEAVE_FORGE_SESSION_URL);const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('unavailable');const v=await r.json();console.log(JSON.stringify({version:v.version,issuer:v.issuer}));})().catch(()=>{console.error('Canonical Forge origin is unreachable from Weave');process.exit(1)})"""
        return json.loads(self.compose(['exec', '-T', 'weave', 'node', '-e', code], 'Container-to-Forge identity check'))


def bootstrap_weave(state, directory, docker):
    if not state['organizationId']:
        raise OperationError('Complete native Forge setup and attach its organization before Weave bootstrap.')
    if not state['secrets']['weaveApiKey']:
        output = docker.compose(['exec', '-T', 'weave', '/usr/local/bin/weave', 'bootstrap',
                                 '--workspace', state['organizationId'], '--username', state['operatorUser'],
                                 '--api-url', state['connection']['weaveOrigin']], 'Weave operator bootstrap')
        try:
            result = json.loads(output)
            key = result.get('api_key')
            if (result.get('workspace_id') != state['organizationId'] or not isinstance(key, str)
                    or not key.startswith('wv_sk_')):
                raise ValueError()
        except (ValueError, AttributeError):
            raise OperationError('Bootstrap did not return a new operator key for this organization. Restore the installation state if a key was already created; no key was replaced.') from None
        state['secrets']['weaveApiKey'] = key
        write_private(Path(directory) / 'state.json', state)
    identity = object_response(request_json(state['connection']['weaveOrigin'], '/v1/auth/me', state['secrets']['weaveApiKey']), 'Operator verification')
    if identity.get('tenant_id') != state['organizationId'] or identity.get('source') != 'apikey' or identity.get('role') != 'admin':
        raise OperationError('The saved operator key does not belong to this organization administrator.')


def sign_in_native(state, credentials_file=None, email=None):
    if credentials_file:
        credentials = json.loads(private_read(credentials_file))
        if not isinstance(credentials, dict) or set(credentials) != {'email', 'password'}:
            raise ConfigurationError('The private administrator input must contain only email and password.')
        email, password = credentials['email'], credentials['password']
    else:
        if not sys.stdin.isatty():
            raise ConfigurationError('Interactive administrator login requires a terminal; otherwise use a private --admin-credentials-file.')
        email = email or input('Existing Forge administrator email: ').strip()
        password = getpass.getpass('Forge administrator password (not saved): ')
    if not isinstance(email, str) or not email.strip() or not isinstance(password, str) or not password:
        raise ConfigurationError('Provide the existing native Forge administrator credentials.')
    origin = state['connection']['forgeOrigin']
    signed = request_json(origin, '/api/v1/auth/sign-in/email', method='POST', body={'email': email.strip(), 'password': password})
    password = None
    token = signed.get('token') if isinstance(signed, dict) else None
    user = signed.get('user', {}) if isinstance(signed, dict) else {}
    if not isinstance(token, str) or not token or not isinstance(user, dict) or not isinstance(user.get('id'), str) or not user['id']:
        raise OperationError('Native sign-in returned no recognized account session.')
    return token, user['id']


def attach_organization(state, directory, docker, forge_token, expected_user):
    origin = state['connection']['forgeOrigin']
    verify_identity_source(state, docker)
    session = object_response(request_json(origin, '/api/v1/auth/get-session', forge_token), 'Native session')
    native_user = object_response(session.get('user'), 'Native account').get('id')
    native_session = object_response(session.get('session'), 'Native session')
    organization = native_session.get('activeOrganizationId')
    if (native_user != expected_user or native_session.get('userId') != expected_user
            or not isinstance(organization, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', organization)):
        raise OperationError('Choose the intended native organization in Forge Setup before continuing.')
    permissions = object_response(request_json(origin, '/api/v1/auth/me/permissions', forge_token), 'Native permissions')
    permission_sets = permissions.get('permissionSets')
    if permissions.get('authenticated') is not True or not isinstance(permission_sets, list) or 'admin_full_access' not in permission_sets:
        raise OperationError('This step requires the existing Forge platform administrator.')
    if state['organizationId'] and state['organizationId'] != organization:
        raise OperationError('This installation is bound to another native organization; it was not changed.')
    if not state['organizationId']:
        state['organizationId'] = organization
        write_private(Path(directory) / 'state.json', state)
    # Reconcile a previous interrupted activation too; never alter the binding.
    docker.refresh_weave()
    exchanged = object_response(request_json(state['connection']['weaveOrigin'], '/v1/auth/external/exchange', forge_token, 'POST'), 'Identity exchange')
    exchanged_org = object_response(exchanged.get('organization'), 'Exchanged organization')
    exchanged_subject = object_response(exchanged.get('subject'), 'Exchanged account')
    if (not isinstance(exchanged.get('token'), str) or not exchanged['token']
            or exchanged_org.get('id') != organization
            or exchanged_subject.get('externalId') != expected_user
            or exchanged.get('issuer') != state['forgeIdentityIssuer']
            or not isinstance(exchanged.get('permissions'), list) or 'teams:admin' not in exchanged['permissions']):
        raise OperationError('The native administrator exchange did not preserve organization, identity, and role.')
    return exchanged['token']


def configure_shared_model(state, weave_token):
    if not state['secrets']['deepseekApiKey']:
        return {'state': 'unconfigured', 'model': MODEL, 'executionVerified': False}
    catalog = object_response(request_json('https://api.deepseek.com', '/models', state['secrets']['deepseekApiKey']), 'Model catalogue')
    if not isinstance(catalog.get('data'), list) or MODEL not in [item.get('id') for item in catalog['data'] if isinstance(item, dict)]:
        raise OperationError('The configured DeepSeek credential did not expose deepseek-flash.')
    origin = state['connection']['weaveOrigin']
    providers = request_json(origin, '/v1/providers/system', weave_token)
    if not isinstance(providers, list) or not any(isinstance(p, dict) and p.get('id') == 'deepseek' and isinstance(p.get('models'), list) and MODEL in p['models'] for p in providers):
        raise OperationError('The Weave system provider is not configured with deepseek-flash.')
    mirrored = object_response(request_json(origin, '/v1/providers/system/deepseek/mirror', weave_token, 'POST', {'reason': 'Administrator completed initial server setup'}), 'Shared model binding')
    if (mirrored.get('provider_id') != 'system/deepseek' or type(mirrored.get('revision')) is not int or mirrored['revision'] < 1
            or mirrored.get('outcome') not in ('created', 'functional_updated', 'credential_rotated', 'noop')):
        raise OperationError('The shared model binding returned no recognized provider revision.')
    pending = {'state': 'mirror_committed_readback_unverified', 'model': MODEL,
               'mirrorReceipt': {key: mirrored[key] for key in ('provider_id', 'revision', 'outcome')},
               'executionVerified': False}
    try:
        stored = request_json(origin, '/v1/providers/system', weave_token)
    except OperationError as error:
        return {**pending, 'readbackReason': str(error)}
    matches = [p for p in stored if isinstance(p, dict) and p.get('id') == 'deepseek'] if isinstance(stored, list) else []
    if not matches:
        return {**pending, 'readbackReason': 'The system provider catalogue did not expose the committed mirror; its revision remains unverified.'}
    if len(matches) != 1:
        raise OperationError('The shared model binding could not be read back.')
    head = matches[0]
    if (head.get('mirrored') is not True or head.get('mirrored_as') != mirrored['provider_id']
            or type(head.get('mirror_revision')) is not int or head['mirror_revision'] != mirrored['revision']
            or not isinstance(head.get('models'), list) or MODEL not in head['models']):
        raise OperationError('The model is not an enabled service revision for this organization.')
    return {'state': 'catalog_verified_and_mirrored', 'model': MODEL, 'revision': mirrored['revision'], 'executionVerified': False}


def configured_workflows(state, token):
    if not token:
        return {'state': 'not_checked', 'reason': 'Native administrator login is required.'}
    origin = state['connection']['weaveOrigin']
    teams = request_json(origin, '/v1/teams', token)
    if not isinstance(teams, list):
        raise OperationError('Unrecognized team list response.')
    published = 0
    for team in teams:
        identity = object_response(team, 'Team record').get('id')
        if not isinstance(identity, str) or not identity:
            raise OperationError('Unrecognized team record.')
        response = object_response(request_json(origin, '/v1/teams/' + quote(identity, safe='') + '/workflows', token), 'Workflow list')
        workflows = response.get('workflows')
        if not isinstance(workflows, list):
            raise OperationError('Unrecognized workflow list response.')
        published += sum(type(object_response(item, 'Workflow record').get('published_version')) is int and item['published_version'] > 0 for item in workflows)
    return {'state': 'published_configuration_present' if published else 'unconfigured',
            'teamCount': len(teams), 'publishedWorkflowCount': published, 'businessExecutionVerified': False}


def verify_identity_source(state, docker):
    outside = object_response(request_json(state['connection']['forgeOrigin'], '/api/v1/workbench/identity-source'), 'Forge identity')
    inside = object_response(docker.forge_from_container(), 'Container Forge identity')
    if any(v.get('version') != '1' or v.get('issuer') != state['forgeIdentityIssuer'] for v in (outside, inside)):
        raise OperationError('Forge identity differs from this installation.')


def check_installation(state, docker, weave_token=None, model_result=None):
    result = {'services': {}, 'identity': {}, 'model': model_result or {'state': 'private_key_present' if state['secrets']['deepseekApiKey'] else 'unconfigured', 'executionVerified': False},
              'teams': {'state': 'not_checked'}, 'desktopLogin': {'state': 'not_verified'}, 'businessReady': False}
    for label, origin, path in [('forge', state['connection']['forgeOrigin'], '/api/v1/health'),
                                ('weave', state['connection']['weaveOrigin'], '/v1/health'),
                                ('weaveDependencies', state['connection']['weaveOrigin'], '/v1/ready')]:
        try:
            response = object_response(request_json(origin, path), 'Service health')
            if label == 'forge' and response.get('success') is not True:
                raise OperationError('Forge did not return its native healthy response.')
            if label == 'weave' and (response.get('status') != 'ok' or response.get('build_commit') != state['images']['components']['weave']['sourceRevision']):
                raise OperationError('The Weave build revision differs from the image lock.')
            if label == 'weaveDependencies' and response.get('status') != 'ready':
                raise OperationError('Weave dependencies are not ready.')
            result['services'][label] = {'state': 'healthy'}
        except OperationError as error:
            result['services'][label] = {'state': 'failed', 'reason': str(error)}
    try:
        verify_identity_source(state, docker)
        result['identity'] = {'state': 'authenticated' if weave_token else 'organization_bound_not_authenticated' if state['organizationId'] else 'awaiting_native_setup',
                              'canonicalOriginReachableFromContainer': True, 'organizationBound': bool(state['organizationId'])}
    except (OperationError, ValueError) as error:
        result['identity'] = {'state': 'failed', 'reason': str(error)}
    try:
        result['teams'] = configured_workflows(state, weave_token)
    except OperationError as error:
        result['teams'] = {'state': 'failed', 'reason': str(error)}
    result['eventBridge'] = {'state': 'configured_not_delivered', 'deliveryVerified': False}
    result['baseHealthy'] = all(v['state'] == 'healthy' for v in result['services'].values()) and result['identity']['state'] != 'failed'
    result['outcome'] = 'base_installed_business_pending' if result['baseHealthy'] else 'base_not_ready'
    return result


def export_connection(state, destination):
    path = Path(destination).absolute()
    content = {name: state['connection'][name] for name in ('version', 'forgeOrigin', 'weaveOrigin')}
    if path.exists():
        if json.loads(private_read(path)) != content:
            raise ConfigurationError('A different connection file already exists; it was preserved.')
        return False
    if not path.parent.is_dir():
        raise ConfigurationError('The connection destination directory must already exist.')
    write_private(path, content)
    return True


def parser():
    result = argparse.ArgumentParser(description='Install the private Linux Forge + Weave server bundle.')
    sub = result.add_subparsers(dest='command', required=True)
    for command in ['configure', 'install', 'init', 'start', 'stop', 'check', 'attach-organization', 'bootstrap-weave', 'export-connection', 'set-model-key']:
        p = sub.add_parser(command)
        p.add_argument('--state-dir', default=DEFAULT_STATE)
        if command == 'configure':
            p.add_argument('--config', required=True)
            p.add_argument('--compose-dir', default='.')
        if command in ('install', 'init'):
            p.add_argument('--images', required=True)
            p.add_argument('--forge-origin', required=True)
            p.add_argument('--weave-origin', required=True)
            p.add_argument('--forge-port', type=int, default=8080)
            p.add_argument('--weave-port', type=int, default=8081)
            p.add_argument('--bind-address', default='0.0.0.0')
            p.add_argument('--host-gateway-host')
            p.add_argument('--external-ingress', action='store_true')
            p.add_argument('--model-key-file')
        if command == 'install':
            p.add_argument('--install-docker', action='store_true')
            p.add_argument('--non-interactive', action='store_true')
        if command in ('install', 'attach-organization'):
            p.add_argument('--admin-credentials-file')
            p.add_argument('--admin-email')
        if command in ('install', 'export-connection'):
            p.add_argument('--output', required=True)
        if command == 'set-model-key':
            p.add_argument('--key-file', required=True)
    return result


def main(arguments=None):
    args = parser().parse_args(arguments)
    if args.command == 'configure':
        from compose_entry import check_destination, read_settings
        destination = Path(args.compose_dir).absolute()
        check_destination(destination)
        settings = read_settings(args.config)
        with installation_lock(args.state_dir) as directory:
            state, created = initialize(directory, **settings)
            if state.get('composeDirectory') and state['composeDirectory'] != str(destination):
                raise ConfigurationError('The managed Compose directory differs; existing files were preserved.')
            state['composeDirectory'] = str(destination)
            write_private(directory / 'state.json', state)
            print(json.dumps({'composeFiles': 'saved', 'installation': 'initialized' if created else 'unchanged', 'servicesStarted': False}))
        return 0
    with installation_lock(args.state_dir) as directory:
        if args.command in ('init', 'install'):
            images = json.loads(Path(args.images).read_text())
            state, created = initialize(directory, images, args.forge_origin, args.weave_origin,
                                        args.forge_port, args.weave_port, args.bind_address,
                                        args.host_gateway_host, args.external_ingress, args.model_key_file)
            if args.command == 'init':
                print(json.dumps({'state': 'initialized' if created else 'unchanged', 'servicesStarted': False}))
                return 0
        else:
            state = load_state(directory)
        if args.command == 'export-connection':
            changed = export_connection(state, args.output)
            print(json.dumps({'connection': 'saved' if changed else 'unchanged', 'serviceReadinessClaimed': False}))
            return 0
        if args.command == 'set-model-key':
            state['secrets']['deepseekApiKey'] = read_model_key(args.key_file)
            write_private(directory / 'state.json', state)
            print(json.dumps({'modelKey': 'saved', 'activation': 'Run start, then attach-organization as the native administrator.'}))
            return 0
        docker = Docker(state)
        docker.preflight(getattr(args, 'install_docker', False))
        if args.command == 'stop':
            docker.stop()
            print(json.dumps({'services': 'stopped', 'volumes': 'preserved'}))
            return 0
        if args.command in ('start', 'install'):
            docker.start()
        if args.command == 'bootstrap-weave':
            bootstrap_weave(state, directory, docker)
            print(json.dumps({'operatorBootstrap': 'verified', 'credentials': 'kept in private state'}))
            return 0
        token, model_result = None, None
        if args.command in ('install', 'attach-organization'):
            if args.command == 'install' and not args.admin_credentials_file:
                if args.non_interactive:
                    print(json.dumps({'outcome': 'native_setup_required', 'setupUrl': state['connection']['forgeOrigin'] + '/_console/setup', 'services': 'started', 'businessReady': False}))
                    return 2
                print('Complete the existing Forge native Setup/signup in your browser: ' + state['connection']['forgeOrigin'] + '/_console/setup')
                input('After the administrator has selected the native organization, press Enter to continue: ')
            forge_token, user = sign_in_native(state, args.admin_credentials_file, args.admin_email)
            session_closed = False
            try:
                token = attach_organization(state, directory, docker, forge_token, user)
                bootstrap_weave(state, directory, docker)
                try:
                    model_result = configure_shared_model(state, token)
                except OperationError as error:
                    model_result = {'state': 'failed', 'reason': str(error), 'executionVerified': False}
                report = check_installation(state, docker, token, model_result)
            finally:
                try:
                    request_json(state['connection']['forgeOrigin'], '/api/v1/auth/sign-out', forge_token, 'POST', {})
                    session_closed = True
                except OperationError:
                    # The token is never persisted, but failed server revocation
                    # must not be reported as a closed native session.
                    pass
                forge_token = None
            report['installerSession'] = {'state': 'closed' if session_closed else 'remote_close_unconfirmed', 'stored': False}
            report['operatorBootstrap'] = {'state': 'verified', 'credentials': 'kept in private state'}
        else:
            report = check_installation(state, docker, token, model_result)
        if args.command == 'install':
            export_connection(state, args.output)
            report['connectionFile'] = str(Path(args.output).absolute())
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report['baseHealthy'] and report['model']['state'] not in ('failed', 'mirror_committed_readback_unverified') else 2


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ConfigurationError, OperationError, OSError, ValueError, KeyError, EOFError) as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error) if isinstance(error, (ConfigurationError, OperationError)) else 'Invalid or unavailable installation input; existing state and volumes were preserved.'}), file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        print('Installation interrupted; existing state and volumes were preserved.', file=sys.stderr)
        sys.exit(130)
