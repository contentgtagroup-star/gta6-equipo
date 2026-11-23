import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'herramientas' / 'procesar.py'
P = {'__file__': str(SCRIPT), '__name__': 'procesar'}
exec(SCRIPT.read_text().split('ap = argparse.ArgumentParser()')[0], P)


class WhisperEntornoTest(unittest.TestCase):
    def test_turno_sin_whisper_no_instala_paquetes(self):
        with patch.dict(P, _tiene_whisper=lambda py: False), patch('subprocess.run') as run:
            self.assertIsNone(P['python_whisper']())
        run.assert_not_called()

    def test_preparacion_elige_python_312_y_no_el_homebrew_315(self):
        calls = []
        def run(args, **kw):
            calls.append(args)
            if args[1:2] == ['-c']:
                version = [3, 12] if args[0] == '/brew/python3.12' else [3, 15]
                return subprocess.CompletedProcess(args, 0, __import__('json').dumps(version), '')
            return subprocess.CompletedProcess(args, 0, '', '')
        with tempfile.TemporaryDirectory() as d, patch.dict(P, WHISPER_DIR=d, _tiene_whisper=lambda py: '/py312/' in py), \
             patch('shutil.which', side_effect=lambda name: '/brew/python3.12' if name == 'python3.12' else None), \
             patch('subprocess.run', side_effect=run):
            result = P['python_whisper'](instalar=True)
        self.assertIn('py312', result)
        self.assertIn(['/brew/python3.12', '-m', 'venv', os.path.join(d, 'py312')], calls)
        self.assertTrue(any('--only-binary=:all:' in c for c in calls))


if __name__ == '__main__':
    unittest.main()
