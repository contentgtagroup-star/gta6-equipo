import hashlib
import json
import os
import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'herramientas' / 'recopilar.py'
IDS = ['a', 'b', 'c', 'd']
AUTO_ID = 'rc-' + hashlib.sha256(','.join(IDS).encode()).hexdigest()[:16]


class RecopilacionIdempotenteTest(unittest.TestCase):
    def ejecutar(self, respuesta, reserva=None):
        llamadas = []
        def fake_run(cmd, **kwargs):
            llamadas.append(cmd)
            if cmd[2] == 'reservar-recop':
                return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(reserva or {'ok': True}), stderr='')
            self.assertEqual(cmd[2:4], ['get', 'clips'])
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(respuesta(cmd[4])), stderr='')
        with (tempfile.TemporaryDirectory() as carpeta,
              patch.object(sys, 'argv', ['recopilar.py', '--titulo', 'Prueba', '--clips', ','.join(IDS), '--dir', carpeta, '--subir', '--id', 'auto']),
              patch('subprocess.run', side_effect=fake_run)):
            with self.assertRaises(SystemExit) as salida:
                runpy.run_path(str(SCRIPT), run_name='__main__')
        return salida.exception.code, llamadas

    def test_reintento_de_mismo_grupo_no_renderiza_ni_sube(self):
        def respuesta(cid):
            if cid == AUTO_ID:
                return {'existe': True, 'datos': {'momentos': IDS}}
            return {'existe': True, 'datos': {'en_recop': AUTO_ID}}
        codigo, llamadas = self.ejecutar(respuesta)
        self.assertEqual(codigo, 0)
        self.assertEqual(llamadas[0][0], sys.executable)
        self.assertEqual([c[4] for c in llamadas], [AUTO_ID, *IDS])

    def test_no_reutiliza_un_clip_ya_asignado_a_otra_recopilacion(self):
        def respuesta(cid):
            if cid == AUTO_ID:
                return {'existe': False}
            return {'existe': True, 'datos': {'en_recop': 'rc-otra'}}
        codigo, llamadas = self.ejecutar(respuesta)
        self.assertEqual(codigo, 1)
        self.assertEqual([c[2] for c in llamadas], ['get', 'reservar-recop', 'get'])
        self.assertEqual([c[4] for c in llamadas if c[2] == 'get'], [AUTO_ID, 'a'])

    def test_otra_compu_ya_reservo_el_grupo_y_no_renderiza(self):
        codigo, llamadas = self.ejecutar(lambda cid: {'existe': False}, {'ok': False, 'duplicado': True})
        self.assertEqual(codigo, 0)
        self.assertEqual([c[2] for c in llamadas], ['get', 'reservar-recop'])

    def test_no_empieza_otra_recopilacion_durante_la_pausa(self):
        llamadas = []
        def fake_run(cmd, **kwargs):
            llamadas.append(cmd)
            return subprocess.CompletedProcess(cmd, 75, stdout='PAUSA_SOLICITADA', stderr='')
        with tempfile.TemporaryDirectory() as carpeta, \
             patch.object(sys, 'argv', ['recopilar.py', '--titulo', 'Prueba', '--clips', ','.join(IDS), '--dir', carpeta]), \
             patch.dict(os.environ, {'GTA6_TURNO_ID': 'pedido-1'}), patch('subprocess.run', side_effect=fake_run):
            with self.assertRaises(SystemExit) as salida:
                runpy.run_path(str(SCRIPT), run_name='__main__')
        self.assertEqual(salida.exception.code, 1)
        self.assertEqual(llamadas[0][2:4], ['comprobar-turno', '--pedido-id'])


if __name__ == '__main__':
    unittest.main()
