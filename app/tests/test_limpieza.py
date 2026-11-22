import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
import equipo


class LimpiezaTest(unittest.TestCase):
    def test_borra_restos_y_respeta_lo_vigente(self):
        with tempfile.TemporaryDirectory() as base:
            tools, tmp = Path(base, 'tools'), Path(base, 'tmp')
            for d in (tools / '__pycache__', tmp / 'gta6-trabajo' / 'c1', tmp / 'gta6-trabajo-nuevo', tmp / 'otra-app'):
                d.mkdir(parents=True)
            for f in ('equipo.json', '.escucha.lock', 'escucha.log', 'escucha.log.1', 'procesar.py.nuevo', 'consumo_statusline.py',
                      '.turno_pendiente.json.nuevo', '__pycache__/x.pyc'):
                (tools / f).write_text('x')
            (tmp / 'gta6-trabajo' / 'c1' / 'fuente.mp4').write_bytes(b'0' * 1000)
            viejo = time.time() - 8 * 3600
            os.utime(tmp / 'gta6-trabajo', (viejo, viejo))
            with patch.object(equipo, 'AQUI', str(tools)), patch('tempfile.gettempdir', return_value=str(tmp)):
                equipo.limpiar_restos()
            self.assertEqual(sorted(os.listdir(tools)), ['.escucha.lock', '.turno_pendiente.json.nuevo', 'equipo.json', 'escucha.log'])
            self.assertEqual(sorted(os.listdir(tmp)), ['gta6-trabajo-nuevo', 'otra-app'])


if __name__ == '__main__':
    unittest.main()
