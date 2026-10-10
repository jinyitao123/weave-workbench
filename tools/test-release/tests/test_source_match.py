import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'publish.py'
spec = importlib.util.spec_from_file_location('test_publisher', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceMatchTests(unittest.TestCase):
    def test_equivalent_locked_server_sources_allow_distinct_product_commits(self):
        def read(*args):
            return b'lock' if args[0] == 'show' else b'tree:' + args[1].split(':', 1)[1].encode()
        with patch.object(module, 'git', side_effect=read):
            module.validate_server_source('a' * 40, 'b' * 40)

    def test_changed_lock_or_either_component_is_refused(self):
        for altered in ('components.lock.json', 'platform/weave', 'platform/forge'):
            def read(*args):
                revision, path = args[1].split(':', 1)
                value = b'lock' if path.endswith('.json') else b'tree:' + path.encode()
                return value + b'changed' if revision == 'b' * 40 and path == altered else value
            with self.subTest(component=altered), patch.object(module, 'git', side_effect=read), self.assertRaises(AssertionError):
                module.validate_server_source('a' * 40, 'b' * 40)
