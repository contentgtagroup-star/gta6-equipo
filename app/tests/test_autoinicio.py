import os
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
import equipo


class AutoinicioTest(unittest.TestCase):
    def test_arranque_de_windows_mac_y_linux_con_ruta_absoluta(self):
        opciones = ['--con', 'claude', '--exe', '/tools/claude']
        with tempfile.TemporaryDirectory() as casa:
            ruta, contenido, _ = equipo.plan_autoinicio('win32', casa, '/python/python.exe', opciones)
            self.assertTrue(ruta.endswith('gta6-equipo.cmd'))
            self.assertIn(b'vigilar', contenido)
            self.assertIn(b'--exe', contenido)

            ruta, contenido, _ = equipo.plan_autoinicio('darwin', casa, '/python/python3', opciones)
            self.assertTrue(ruta.endswith('.plist'))
            datos = plistlib.loads(contenido)
            self.assertTrue(datos['RunAtLoad'])
            self.assertEqual(datos['ProgramArguments'][-1], '/tools/claude')

            ruta, contenido, _ = equipo.plan_autoinicio('linux', casa, '/python/python3', opciones)
            self.assertTrue(ruta.endswith('.service'))
            self.assertIn(b'Restart=always', contenido)
            self.assertIn(b'/tools/claude', contenido)

    @unittest.skipIf(os.name == 'nt', 'el test de flock corre en Linux/Mac')
    def test_una_sola_instancia_puede_tomar_el_motor(self):
        with tempfile.TemporaryDirectory() as carpeta, patch.object(equipo, 'AQUI', carpeta):
            primera = equipo.lock_motor()
            self.assertIsNotNone(primera)
            self.assertIsNone(equipo.lock_motor())
            primera.close()
            otra = equipo.lock_motor()
            self.assertIsNotNone(otra)
            otra.close()

    def test_linux_sin_systemd_usa_autostart_del_escritorio(self):
        with tempfile.TemporaryDirectory() as casa:
            plan = (str(Path(casa) / 'gta6-equipo.service'), b'[Unit]\n', 'linux')
            with patch.object(equipo, 'plan_autoinicio', return_value=plan), \
                 patch.object(equipo, 'opciones_motor', return_value=['--con', 'claude', '--exe', '/tools/claude']), \
                 patch('os.path.expanduser', return_value=casa), \
                 patch('subprocess.run', side_effect=FileNotFoundError):
                self.assertTrue(equipo.instalar_autoinicio())
            self.assertTrue((Path(casa) / '.config/autostart/gta6-equipo.desktop').exists())

    def test_listener_manual_pasa_a_segundo_plano_tras_actualizar(self):
        bloqueo = MagicMock()
        with patch('sys.argv', ['equipo.py', 'escuchar', '--con', 'claude', '--exe', '/tools/claude']), \
             patch.object(equipo, 'ampliar_path'), \
             patch.object(equipo, 'lock_motor', return_value=bloqueo), \
             patch.object(equipo, 'instalar_autoinicio', return_value=True), \
             patch.object(equipo, 'iniciar_motor', return_value=True) as iniciar, \
             patch('os.path.isfile', return_value=True):
            equipo.main()
        bloqueo.close.assert_called_once()
        iniciar.assert_called_once_with(['--con', 'claude', '--exe', '/tools/claude'])

    def test_supervisor_reinicia_el_motor_si_se_detiene(self):
        con = [subprocess.CompletedProcess([], 1), KeyboardInterrupt]
        with patch('sys.argv', ['equipo.py', 'vigilar', '--con', 'claude', '--exe', '/tools/claude']), \
             patch.object(equipo, 'lock_motor', return_value=MagicMock()), \
             patch('subprocess.run', side_effect=con) as ejecutar, \
             patch('time.sleep') as pausa:
            with self.assertRaises(KeyboardInterrupt):
                equipo.main()
        self.assertEqual(ejecutar.call_count, 2)
        self.assertIn('escuchar', ejecutar.call_args_list[0].args[0])
        pausa.assert_called_once_with(30)

    def test_instalacion_arranca_el_supervisor_en_segundo_plano(self):
        with tempfile.TemporaryDirectory() as carpeta, patch.object(equipo, 'AQUI', carpeta), \
             patch.object(equipo, 'opciones_motor', return_value=['--con', 'codex', '--exe', '/tools/codex']), \
             patch('subprocess.Popen') as abrir:
            self.assertTrue(equipo.iniciar_motor())
        self.assertIn('vigilar', abrir.call_args.args[0])
        self.assertIn('codex', abrir.call_args.args[0])

    def test_pedido_se_consulta_antes_de_la_proxima_revision_completa(self):
        def pedir(metodo, ruta, cuerpo=None):
            if ruta == '/api/estado':
                return {'yo': 'Cuervo'}
            return {'docs': []}
        with patch('sys.argv', ['equipo.py', 'escuchar', '--con', 'claude', '--exe', '/tools/claude']), \
             patch.object(equipo, 'ampliar_path'), \
             patch.object(equipo, 'instalar_autoinicio', return_value=False), \
             patch.object(equipo, 'lock_motor', return_value=MagicMock()), \
             patch.object(equipo, 'actualizar', return_value=False) as actualizar, \
             patch.object(equipo, 'reenviar_cierre'), \
             patch.object(equipo, 'pedir', side_effect=pedir), \
             patch.object(equipo, 'escribir'), \
             patch.object(equipo, 'ejecutar_turno') as turnos, \
             patch('os.path.isfile', return_value=True), \
             patch('time.monotonic', side_effect=[100, 100, 120]), \
             patch('time.sleep', side_effect=[None, KeyboardInterrupt]) as pausa:
            with self.assertRaises(KeyboardInterrupt):
                equipo.main()
        self.assertEqual(actualizar.call_count, 1)
        self.assertEqual(turnos.call_count, 2)
        self.assertEqual(pausa.call_args_list[0].args, (30,))


if __name__ == '__main__':
    unittest.main()
