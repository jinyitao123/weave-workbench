"""Generate native Compose files from the existing private installer state."""
import json
import os
from pathlib import Path
import tempfile

from configuration import ConfigurationError, compose_environment, private_read

HERE = Path(__file__).resolve().parent
HEADER = '# Managed by Weave Workbench; configure through installation.json.\n'
FIELDS = {'images', 'forgeOrigin', 'weaveOrigin', 'forgePort', 'weavePort',
          'bindAddress', 'hostGatewayHost', 'externalIngress', 'modelKeyFile'}


def read_settings(path):
    path = Path(path).resolve()
    if path.stat().st_size > 8192:
        raise ConfigurationError('Installation settings exceed 8192 bytes.')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ConfigurationError('Duplicate installation setting.')
            result[key] = value
        return result
    data = json.loads(path.read_text(), object_pairs_hook=unique)
    if not isinstance(data, dict) or set(data) - FIELDS or not {'forgeOrigin', 'weaveOrigin'} <= set(data):
        raise ConfigurationError('Use only the documented installation settings and provide both origins.')
    if type(data.get('externalIngress', False)) is not bool:
        raise ConfigurationError('externalIngress must be a JSON boolean.')
    def selected(key, default=None):
        value = data.get(key, default)
        if value in (None, ''):
            return None
        if not isinstance(value, str):
            raise ConfigurationError('Selected installation file paths must be strings.')
        return path.parent / value
    images = selected('images', 'images.lock.json')
    if images is None:
        raise ConfigurationError('Provide a completed image lock path.')
    if data.get('hostGatewayHost') is not None and not isinstance(data['hostGatewayHost'], str):
        raise ConfigurationError('hostGatewayHost must be a hostname string or null.')
    return {'images': json.loads(images.read_text()),
            'forge_origin': data['forgeOrigin'], 'weave_origin': data['weaveOrigin'],
            'forge_port': data.get('forgePort', 8080), 'weave_port': data.get('weavePort', 8081),
            'bind_address': data.get('bindAddress', '0.0.0.0'),
            'gateway_host': data.get('hostGatewayHost') or None,
            'external_ingress': data.get('externalIngress', False),
            'model_key_file': selected('modelKeyFile')}


def check_destination(directory):
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ConfigurationError('Select an existing regular Compose directory.')
    env = directory / '.env'
    if env.exists() or env.is_symlink():
        if not private_read(env, 65536).startswith(HEADER):
            raise ConfigurationError('An unrelated .env exists; it was preserved.')
    compose = directory / 'compose.yaml'
    if compose.is_symlink():
        raise ConfigurationError('Refusing a symlink Compose destination.')
    if compose.exists() and compose.read_bytes() != (HERE / 'compose.yaml').read_bytes() and not env.exists():
        raise ConfigurationError('An unrelated compose.yaml exists; it was preserved.')


def write_text(path, content, mode):
    if path.is_symlink():
        raise ConfigurationError('Refusing a symlink Compose destination.')
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def export_compose(state):
    directory = Path(state['composeDirectory'])
    check_destination(directory)
    values = compose_environment(state)
    # Compose expands double quoted dotenv values; escape dollars as well as JSON quotes/backslashes.
    lines = [key + '=' + json.dumps(value).replace('$', r'\$') + '\n' for key, value in sorted(values.items())]
    write_text(directory / '.env', HEADER + ''.join(lines), 0o600)
    destination = directory / 'compose.yaml'
    if not destination.exists():
        write_text(destination, (HERE / 'compose.yaml').read_text(), 0o644)
