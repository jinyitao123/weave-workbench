"""Parse the real independent Compose files; no registry calls or containers."""
import json
from pathlib import Path
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weave_bundle import Deployment
from test_bundle import image_lock

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    shutil.copyfile(Path(__file__).resolve().parents[1] / 'compose.yaml', root / 'compose.yaml')
    (root / 'images.lock.json').write_text(json.dumps(image_lock()))
    settings = root / 'installation.json'
    settings.write_text(json.dumps({'origin': 'http://weave.example.test:8081'}))
    deployment = Deployment(root)
    deployment.configure(settings)
    doc = json.loads(deployment.compose(['config', '--format', 'json']))
    assert set(doc['services']) == {'db', 'weave'}
    assert set(doc['volumes']) == {'database', 'workspaces'}
    assert doc['services']['weave']['depends_on']['db']['condition'] == 'service_healthy'
    assert 'ports' not in doc['services']['db']
    for service in doc['services'].values():
        assert service['platform'] == 'linux/amd64' and '@sha256:' in service['image'] and 'build' not in service
    assert doc['services']['weave']['environment']['WEAVE_LOCAL_RUNTIME_ENABLED'] == 'false'
    assert doc['services']['weave']['environment']['WEAVE_DISABLE_LOCAL_LOGIN'] == 'true'
print('Independent Weave real Compose interpolation passed; no containers started.')
