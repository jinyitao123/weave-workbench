"""Private installation state and immutable image/connection validation."""
from contextlib import contextmanager
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import tempfile
from urllib.parse import urlsplit
import uuid


class ConfigurationError(ValueError):
    pass


def normalize_origin(value):
    if not isinstance(value, str) or len(value) > 2048 or re.search(r'[\s\\]', value):
        raise ConfigurationError('An origin must be an HTTP(S) address without whitespace or backslashes.')
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
    except ValueError as error:
        raise ConfigurationError('Invalid origin host or port.') from error
    if (parsed.scheme not in ('http', 'https') or not host or '@' in parsed.netloc
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or '?' in value or '#' in value or '%' in host):
        raise ConfigurationError('An origin cannot contain credentials, a path, query, or fragment.')
    if not host.isascii():
        raise ConfigurationError('Use an ASCII/Punycode hostname for the shared server origin.')
    try:
        address = ipaddress.ip_address(host)
        host = '[' + address.compressed + ']' if address.version == 6 else str(address)
    except ValueError:
        labels = host.rstrip('.').split('.')
        if (len(host.rstrip('.')) > 253 or any(not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label) for label in labels)
                or re.fullmatch(r'(?:0x[0-9a-fA-F]+|[0-9.]+)', host)
                or re.fullmatch(r'(?:[0-9]+|0x[0-9a-fA-F]+)', host.rstrip('.').split('.')[-1])):
            raise ConfigurationError('Use a valid hostname or a canonical IP address.')
        host = host.lower()
    if port is not None and not 1 <= port <= 65535:
        raise ConfigurationError('Origin port must be between 1 and 65535.')
    default = 80 if parsed.scheme == 'http' else 443
    return parsed.scheme + '://' + host + (f':{port}' if port and port != default else '')


def image_reference(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[0-9a-f]{64}', value):
        raise ConfigurationError('Image lock is incomplete: use repository@sha256:<64 lowercase hex characters>.')
    name = value.split('@')[0]
    if '://' in name or any(part in ('.', '..', '') for part in name.split('/')):
        raise ConfigurationError('Invalid image repository.')
    tag = name.rsplit('/', 1)[-1].partition(':')[2]
    if tag.lower() in ('latest', 'unknown'):
        raise ConfigurationError('Floating latest/unknown image tags are not allowed.')
    return value


def validate_images(data):
    if (not isinstance(data, dict) or set(data) != {'version', 'bundleVersion', 'components'}
            or type(data['version']) is not int or data['version'] != 1
            or not isinstance(data['bundleVersion'], str)
            or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', data['bundleVersion'])):
        raise ConfigurationError('Provide a completed version 1 image lock, not images.template.json.')
    components = data['components']
    if not isinstance(components, dict) or set(components) != {'forge', 'forgeProxy', 'weave', 'postgres'}:
        raise ConfigurationError('The lock must name Forge, its proxy, Weave, and PostgreSQL.')
    for name, item in components.items():
        expected = {'image', 'major'} if name == 'postgres' else {'image', 'sourceRevision'}
        if not isinstance(item, dict) or set(item) != expected:
            raise ConfigurationError(f'Unexpected image lock fields for {name}.')
        image_reference(item['image'])
        if name == 'postgres':
            if type(item['major']) is not int or item['major'] != 16:
                raise ConfigurationError('This bundle requires PostgreSQL 16.')
        elif not isinstance(item['sourceRevision'], str) or not re.fullmatch(r'[0-9a-f]{40}', item['sourceRevision']):
            raise ConfigurationError(f'{name} requires its full source revision.')
    if components['forge']['sourceRevision'] != components['forgeProxy']['sourceRevision']:
        raise ConfigurationError('Forge and its transport must come from the same source revision.')
    return data


def private_read(path, maximum=8192):
    path = Path(path)
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ConfigurationError('Cannot open the selected private input file.') from error
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid()
                or metadata.st_mode & 0o077 or metadata.st_size > maximum):
            raise ConfigurationError('Private inputs must be owned by the current administrator, regular, size-bounded, and mode 0600 or stricter.')
        content = stream.read(maximum + 1)
        if len(content) > maximum:
            raise ConfigurationError('The private input exceeds its size limit.')
        return content.decode('utf-8')


def read_model_key(path):
    if not path:
        return ''
    value = private_read(path).strip()
    if not value or len(value) > 4096 or any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise ConfigurationError('The selected model key must be a non-empty single-line private value.')
    return value


def write_private(path, data):
    path = Path(path)
    if path.is_symlink():
        raise ConfigurationError('Refusing a symlink destination.')
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def installation_lock(directory):
    directory = Path(directory).absolute()
    if not directory.exists():
        directory.mkdir(parents=True, mode=0o700)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077:
        raise ConfigurationError('The installation directory must be administrator-owned, private (0700), and not a symlink.')
    descriptor = os.open(directory / '.lock', os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077:
            raise ConfigurationError('The installation lock must be a private administrator-owned regular file.')
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield directory
    finally:
        os.close(descriptor)


def load_state(directory):
    data = json.loads(private_read(Path(directory) / 'state.json', 65536))
    if not isinstance(data, dict) or type(data.get('formatVersion')) is not int or data['formatVersion'] != 1:
        raise ConfigurationError('Unsupported installation state.')
    validate_images(data['images'])
    if (not isinstance(data['connection'], dict) or set(data['connection']) != {'version', 'forgeOrigin', 'weaveOrigin'}
            or type(data['connection']['version']) is not int or data['connection']['version'] != 1):
        raise ConfigurationError('Invalid stored connection.')
    for name in ('forgeOrigin', 'weaveOrigin'):
        if normalize_origin(data['connection'][name]) != data['connection'][name]:
            raise ConfigurationError('Stored origins are not canonical.')
    for name, pattern in [('projectName', r'weave-workbench-[0-9a-f]{8}'),
                          ('forgeDbUser', r'fg_[0-9a-f]{8}'), ('weaveDbUser', r'wv_[0-9a-f]{8}'),
                          ('operatorUser', r'ops_[0-9a-f]{8}'),
                          ('forgeIdentityIssuer', r'urn:weave-workbench:[0-9a-f-]{36}')]:
        if not isinstance(data.get(name), str) or not re.fullmatch(pattern, data[name]):
            raise ConfigurationError('Invalid stored installation identity.')
    if data['organizationId'] is not None and (not isinstance(data['organizationId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', data['organizationId'])):
        raise ConfigurationError('Invalid stored native organization.')
    for name in ('forgeDbPassword', 'weaveDbPassword', 'forgeAuthSecret', 'forgeSecretKey',
                 'weaveJwtSecret', 'weaveSecretKey', 'eventSecret', 'operatorPassword'):
        value = data['secrets'][name]
        if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{64}', value):
            raise ConfigurationError('Invalid generated installation secret; it was not replaced.')
    return data


def initialize(directory, images, forge_origin, weave_origin, forge_port=8080,
               weave_port=8081, bind_address='0.0.0.0', gateway_host=None,
               external_ingress=False, model_key_file=None):
    validate_images(images)
    connection = {'version': 1, 'forgeOrigin': normalize_origin(forge_origin), 'weaveOrigin': normalize_origin(weave_origin)}
    if type(forge_port) is not int or type(weave_port) is not int or not 1 <= forge_port <= 65535 or not 1 <= weave_port <= 65535 or forge_port == weave_port:
        raise ConfigurationError('Use distinct published ports between 1 and 65535.')
    try:
        bind_address = str(ipaddress.IPv4Address(bind_address))
    except ValueError as error:
        raise ConfigurationError('The host bind address must be an IPv4 address.') from error
    if not external_ingress:
        for name, port in [('forgeOrigin', forge_port), ('weaveOrigin', weave_port)]:
            parsed = urlsplit(connection[name])
            if parsed.scheme != 'http' or (parsed.port or 80) != port:
                raise ConfigurationError('Direct HTTP origins must match the published ports. An existing reverse proxy requires --external-ingress.')
    host = urlsplit(connection['forgeOrigin']).hostname
    if gateway_host and (gateway_host.lower() != host or not re.fullmatch(r'[a-zA-Z][a-zA-Z0-9.-]*', gateway_host) or host == 'localhost'):
        raise ConfigurationError('--host-gateway-host must be the canonical Forge DNS hostname, not localhost or an IP literal.')
    network = {'forgePort': forge_port, 'weavePort': weave_port, 'bindAddress': bind_address,
               'gatewayHost': gateway_host.lower() if gateway_host else None, 'externalIngress': external_ingress}
    path = Path(directory) / 'state.json'
    if path.exists():
        existing = load_state(directory)
        if existing['images'] != images or existing['connection'] != connection or existing['network'] != network:
            raise ConfigurationError('Existing installation configuration differs. It was preserved; upgrade/origin changes require a separately reviewed operation.')
        if model_key_file and read_model_key(model_key_file) != existing['secrets']['deepseekApiKey']:
            raise ConfigurationError('The model key differs from the existing private state; it was preserved.')
        return existing, False
    sensitive = {name: secrets.token_hex(32) for name in [
        'forgeDbPassword', 'weaveDbPassword', 'forgeAuthSecret', 'forgeSecretKey',
        'weaveJwtSecret', 'weaveSecretKey', 'eventSecret', 'operatorPassword']}
    sensitive.update(deepseekApiKey=read_model_key(model_key_file), weaveApiKey='')
    state = {'formatVersion': 1, 'projectName': 'weave-workbench-' + secrets.token_hex(4),
             'connection': connection, 'network': network, 'images': images, 'secrets': sensitive,
             'forgeDbUser': 'fg_' + secrets.token_hex(4), 'weaveDbUser': 'wv_' + secrets.token_hex(4),
             'operatorUser': 'ops_' + secrets.token_hex(4), 'organizationId': None,
             'forgeIdentityIssuer': 'urn:weave-workbench:' + str(uuid.uuid4())}
    write_private(path, state)
    return state, True


def compose_environment(state):
    s, n, c, images = state['secrets'], state['network'], state['connection'], state['images']['components']
    return {
        'WW_PROJECT': state['projectName'], 'WW_POSTGRES_IMAGE': images['postgres']['image'],
        'WW_FORGE_IMAGE': images['forge']['image'], 'WW_FORGE_PROXY_IMAGE': images['forgeProxy']['image'],
        'WW_WEAVE_IMAGE': images['weave']['image'], 'WW_FORGE_DB_USER': state['forgeDbUser'],
        'WW_WEAVE_DB_USER': state['weaveDbUser'], 'WW_FORGE_DB_PASSWORD': s['forgeDbPassword'],
        'WW_WEAVE_DB_PASSWORD': s['weaveDbPassword'],
        'WW_FORGE_DATABASE_URL': f"postgres://{state['forgeDbUser']}:{s['forgeDbPassword']}@forge-db:5432/forge",
        'WW_WEAVE_DATABASE_URL': f"postgres://{state['weaveDbUser']}:{s['weaveDbPassword']}@weave-db:5432/weave",
        'WW_FORGE_AUTH_SECRET': s['forgeAuthSecret'], 'WW_FORGE_SECRET_KEY': s['forgeSecretKey'],
        'WW_WEAVE_JWT_SECRET': s['weaveJwtSecret'], 'WW_WEAVE_SECRET_KEY': s['weaveSecretKey'],
        'WW_EVENT_SECRET': s['eventSecret'], 'WW_OPERATOR_USER': state['operatorUser'],
        'WW_OPERATOR_PASSWORD': s['operatorPassword'], 'WW_DEEPSEEK_API_KEY': s['deepseekApiKey'],
        'WW_FORGE_IDENTITY_ISSUER': state['forgeIdentityIssuer'], 'WW_FORGE_ORIGIN': c['forgeOrigin'],
        'WW_FORGE_TRUSTED_ORIGINS': ','.join(dict.fromkeys((c['forgeOrigin'], c['weaveOrigin']))),
        'WW_WEAVE_ADMIN_FORGE_URL': c['forgeOrigin'],
        'WW_FORGE_SESSION_URL': c['forgeOrigin'] + '/api/v1/auth/get-session',
        'WW_FORGE_EVENT_URL': c['forgeOrigin'] + '/api/v1/apps/forge/weave-events/team-runs',
        'WW_ORGANIZATION_ID': state['organizationId'] or '', 'WW_BIND_ADDRESS': n['bindAddress'],
        'WW_FORGE_PORT': str(n['forgePort']), 'WW_WEAVE_PORT': str(n['weavePort']),
        'WW_GATEWAY_ALIAS': n['gatewayHost'] or 'host.docker.internal',
    }
