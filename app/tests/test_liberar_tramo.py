import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
import equipo


class LiberarTramoTest(unittest.TestCase):
    def test_libera_solo_la_reserva_propia_del_pedido_y_clip(self):
        propio = {'estado': 'reservado', 'por': 'Eze', 'pedido_id': 'p1', 'clip': 'c1'}
        resto = [dict(propio, por='Luis'), dict(propio, pedido_id='p2'), dict(propio, clip='c2'), dict(propio, estado='usado')]
        datos = {'tramos': [propio, *resto]}
        def modificar(col, id_, fn):
            self.assertEqual((col, id_), ('usados', 'v1'))
            return fn(datos)
        with patch('sys.argv', ['equipo.py', 'liberar-tramo', 'v1', '--clip', 'c1']), \
             patch.dict(os.environ, GTA6_TURNO_ID='p1'), patch.object(equipo, 'pedir', return_value={'yo': 'Eze'}), \
             patch.object(equipo, 'modificar', side_effect=modificar):
            equipo.main()
        self.assertEqual(datos['tramos'], resto)

    def test_python_homebrew_absoluto_esta_permitido(self):
        self.assertIn('Bash(' + sys.executable + ':*)', equipo.PERMISOS_CLAUDE)
