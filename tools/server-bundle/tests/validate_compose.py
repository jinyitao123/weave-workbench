#!/usr/bin/env python3
"""Validate real Compose interpolation without pulling images or starting containers."""
import json
import os
import subprocess
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from configuration import initialize
from server_bundle import Docker
from test_installation import images


with tempfile.TemporaryDirectory() as directory:
    state, _ = initialize(directory, images(), 'http://forge.example.test:8080', 'http://weave.example.test:8081', gateway_host='forge.example.test')
    doc = json.loads(Docker(state).compose(['config', '--format', 'json'], 'Compose interpolation validation'))
    services = doc['services']
    assert set(services) == {'forge-db', 'weave-db', 'app', 'proxy', 'weave'}
    assert set(doc['volumes']) == {'forge_database', 'weave_database', 'forge_uploads', 'weave_workspaces'}
    for service in services.values():
        assert '@sha256:' in service['image']
        assert 'build' not in service
        # Compose 2.40 serializes inherited image defaults as explicit nulls.
        # Empty strings/lists would override them and must still be rejected.
        assert service.get('command') is None and service.get('entrypoint') is None
    for name in ('forge-db', 'weave-db'):
        assert 'ports' not in services[name]
    forge, weave = services['app']['environment'], services['weave']['environment']
    assert forge['OS_BASE_URL'] == state['connection']['forgeOrigin']
    assert weave['WEAVE_FORGE_SESSION_URL'] == forge['OS_BASE_URL'] + '/api/v1/auth/get-session'
    assert weave['WEAVE_ADMIN_FORGE_URL'] == forge['OS_BASE_URL']
    assert forge['OS_TRUSTED_ORIGINS'] == forge['OS_BASE_URL'] + ',' + state['connection']['weaveOrigin']
    assert forge['FORGE_WEAVE_EVENT_SECRET'] == weave['WEAVE_FORGE_EVENT_SECRET']
    assert weave['WEAVE_DISABLE_LOCAL_LOGIN'] == 'true'
    assert weave['WEAVE_DEV_MODE'] == 'false'
    assert weave['WEAVE_LOCAL_RUNTIME_ENABLED'] == 'false'
    assert 'WEAVE_LOCAL_RUNTIME_SHARED_PROVIDERS' not in weave
    assert 'WEAVE_ADMIN_USER' not in weave
    assert weave['DEFAULT_MODEL'] == 'deepseek-flash'
    hosts = services['weave']['extra_hosts']
    if isinstance(hosts, list):
        hosts = dict(value.split('=', 1) for value in hosts)
    assert hosts['forge.example.test'] == 'host-gateway'
    # Exercise native CLI file loading without injected WW_ or COMPOSE_ values.
    from compose_entry import export_compose
    target = Path(directory) / 'compose'
    target.mkdir()
    state['composeDirectory'] = str(target)
    state['organizationId'] = 'test-native-org'
    state['secrets']['deepseekApiKey'] = "test-only-$UNSET-quote'slash\\end"
    export_compose(state)
    environment = {k: v for k, v in os.environ.items() if not k.startswith(('WW_', 'COMPOSE_'))}
    result = subprocess.run(['docker', 'compose', '--project-directory', str(target), 'config', '--format', 'json'], env=environment, text=True, capture_output=True)
    assert result.returncode == 0, 'Native Compose file interpolation failed; no private output was logged.'
    native = json.loads(result.stdout)
    assert native['name'] == state['projectName']
    actual = native['services']['weave']['environment']
    assert actual['WEAVE_FORGE_DEFAULT_WORKSPACE'] == state['organizationId']
    assert actual['DEEPSEEK_API_KEY'] == state['secrets']['deepseekApiKey']
    assert native['services']['app']['environment']['OS_AUTH_SECRET'] == state['secrets']['forgeAuthSecret']
print('Real Compose interpolation passed; no images pulled and no containers started.')
