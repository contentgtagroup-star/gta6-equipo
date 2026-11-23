import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'herramientas' / 'youtube_token_vercel.py'
P = {'__file__': str(SCRIPT), '__name__': 'youtube_token_vercel'}
exec(SCRIPT.read_text(), P)


class YoutubeTokenVercelTest(unittest.TestCase):
    def test_lee_cliente_de_gateway_o_web(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / 'client_secret.json'
            ruta.write_text(json.dumps({'installed': {'client_id': 'id', 'client_secret': 'secreto'}}))
            self.assertEqual(P['leer_cliente'](str(ruta)), ('id', 'secreto'))
            ruta.write_text(json.dumps({'web': {'client_id': 'id2', 'client_secret': 'secreto2'}}))
            self.assertEqual(P['leer_cliente'](str(ruta)), ('id2', 'secreto2'))

    def test_el_valor_va_por_stdin_y_nunca_en_argv(self):
        argv = P['comando_vercel']()
        self.assertEqual(argv[:4], ['vercel', 'env', 'add', 'YT_REFRESH_TOKEN'])
        self.assertIn('-e', argv)
        self.assertIn('production', argv)
        self.assertIn('--force', argv)
        self.assertIn('--sensitive', argv)
        self.assertIn('-p', argv)
        self.assertIn(P['PROYECTO'], argv)
        self.assertIn('--scope', argv)
        self.assertIn(P['EQUIPO'], argv)
        self.assertNotIn('--value', argv)
        self.assertNotIn('YT_REFRESH_TOKEN=', ' '.join(argv))

    def test_ocultar_no_deja_secretos_en_mensajes(self):
        texto = 'falló con refresh-privado y secreto-privado y access-privado'
        limpio = P['ocultar'](texto, ['refresh-privado', 'secreto-privado', 'access-privado'])
        self.assertEqual(limpio, 'falló con *** y *** y ***')

    def test_verifica_canal_y_elige_el_esperado(self):
        items = [{'id': 'otro', 'snippet': {'title': 'Otro'}},
                 {'id': 'canal-correcto', 'snippet': {'title': 'Clips GTA 6'}}]
        self.assertEqual(P['verificar_canal'](items, 'canal-correcto'), ('Clips GTA 6', 'canal-correcto'))
        self.assertEqual(P['verificar_canal'](items, ''), ('Otro', 'otro'))
        with self.assertRaises(SystemExit):
            P['verificar_canal'](items, 'no-existe')

    def test_flujo_completo_no_imprime_ni_pasa_el_token_por_argv(self):
        llamadas = []
        def run(argv, **kw):
            llamadas.append((argv, kw))
            return subprocess.CompletedProcess(argv, 0, 'Environment Variable added', '')
        fake = type('Fake', (), {'run': staticmethod(run)})()
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / 'client_secret.json'
            ruta.write_text(json.dumps({'installed': {'client_id': 'id-publico',
                                                      'client_secret': 'secreto-privado'}}))
            autorizar = lambda cid, csec: ('refresh-privado', [
                {'id': 'canal-correcto', 'snippet': {'title': 'Clips GTA 6'}}])
            salida = io.StringIO()
            with patch.dict(P, autorizar=autorizar, subprocess=fake), \
                 patch.object(sys, 'argv', ['script', str(ruta), '--canal', 'canal-correcto', '--sin-deploy']), \
                 contextlib.redirect_stdout(salida):
                P['main']()
        self.assertEqual(len(llamadas), 1)
        argv, kw = llamadas[0]
        self.assertEqual(kw['input'], 'refresh-privado\n')
        self.assertNotIn('refresh-privado', ' '.join(argv))
        self.assertNotIn('secreto-privado', ' '.join(argv))
        self.assertNotIn('--value', argv)
        self.assertNotIn('refresh-privado', salida.getvalue())
        self.assertNotIn('secreto-privado', salida.getvalue())
        self.assertIn('Clips GTA 6', salida.getvalue())

    def test_despliega_desde_main_si_no_se_pide_sin_deploy(self):
        llamadas = []
        def run(argv, **kw):
            llamadas.append(argv)
            return subprocess.CompletedProcess(argv, 0, 'ok', '')
        fake = type('Fake', (), {'run': staticmethod(run)})()
        with tempfile.TemporaryDirectory() as d:
            ruta = Path(d) / 'client_secret.json'
            ruta.write_text(json.dumps({'installed': {'client_id': 'id', 'client_secret': 'secreto'}}))
            with patch.dict(P, autorizar=lambda cid, csec: ('refresh', [
                    {'id': 'canal', 'snippet': {'title': 'Canal'}}]), subprocess=fake), \
                 patch.object(sys, 'argv', ['script', str(ruta), '--canal', 'canal']), \
                 contextlib.redirect_stdout(io.StringIO()):
                P['main']()
        self.assertEqual(len(llamadas), 2)
        self.assertEqual(llamadas[1][:4], ['gh', 'workflow', 'run', P['WORKFLOW']])
        self.assertIn('main', llamadas[1])


if __name__ == '__main__':
    unittest.main()
