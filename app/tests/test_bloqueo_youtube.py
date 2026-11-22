import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
import equipo


class BloqueoYoutubeTest(unittest.TestCase):
    def test_un_bloqueo_de_youtube_queda_marcado_para_el_motor(self):
        with tempfile.TemporaryDirectory() as d:
            marca = os.path.join(d, '.youtube_bloqueado')
            with patch.object(equipo, 'BLOQUEO_YOUTUBE', marca):
                self.assertIsNone(equipo.youtube_bloqueado_desde())
                # procesar.py marca la constancia junto a sí mismo: se simula con su función real
                ns = {'__file__': os.path.join(d, 'procesar.py'), '__name__': 'x'}
                src = Path(__file__).resolve().parents[1].joinpath('herramientas', 'procesar.py').read_text(encoding='utf-8')
                exec(compile(src[:src.index('\nap = argparse')], 'procesar.py', 'exec'), ns)
                bloqueo = subprocess.CompletedProcess([], 1, '', 'ERROR: Sign in to confirm you’re not a bot')
                with self.assertRaises(SystemExit):
                    ns['youtube_bloqueo'](bloqueo)
                self.assertLess(equipo.youtube_bloqueado_desde(), 5)


if __name__ == '__main__':
    unittest.main()
