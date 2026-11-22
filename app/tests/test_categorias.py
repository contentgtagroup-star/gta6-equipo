import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

H = Path(__file__).resolve().parents[1] / 'herramientas'
source = (H / 'procesar.py').read_text()
P = {'__file__': str(H / 'procesar.py'), '__name__': 'procesar'}
exec(compile(source[:source.index('\nap = argparse.ArgumentParser()')], 'procesar.py', 'exec'), P)
sys.path.insert(0, str(H))
import radar


class CategoriasTest(unittest.TestCase):
    def test_registro_compartido_y_legacy(self):
        self.assertIsNone(P['categoria_config'](''))
        self.assertEqual(P['categoria_config']('guias')['name'], 'Guías')
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
            P['categoria_config']('inventada')

    def test_radar_usa_consultas_especializadas_sin_red(self):
        with patch.dict(os.environ, {'GTA6_CATEGORIA': ''}):
            self.assertEqual(radar.consultas_categoria(), radar.QUERIES)
        with patch.dict(os.environ, {'GTA6_CATEGORIA': 'easter-eggs'}):
            self.assertIn('GTA 6 easter egg', radar.consultas_categoria())
        with patch.dict(os.environ, {'GTA6_CATEGORIA': 'guias'}):
            self.assertNotIn('GTA 6 easter egg', radar.consultas_categoria())
        with patch.dict(os.environ, {'GTA6_CATEGORIA': 'invalida'}), self.assertRaises(ValueError):
            radar.consultas_categoria()

    def test_cli_rechaza_categoria_antes_de_usar_red(self):
        r = subprocess.run([sys.executable, str(H / 'procesar.py'), 'momentos', '--url', 'https://example.invalid', '--categoria', 'invalida'], capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('categoría inválida', r.stdout)
