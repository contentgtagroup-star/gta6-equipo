import subprocess
import os
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'herramientas' / 'procesar.py'
src = SCRIPT.read_text(encoding='utf-8')
P = {'__file__': str(SCRIPT), '__name__': 'procesar'}
exec(compile(src[:src.index('\nap = argparse.ArgumentParser()')], str(SCRIPT), 'exec'), P)


class SubtitulosExtranjerosTest(unittest.TestCase):
    def test_revisar_detecta_overlay_faltante(self):
        real = os.path.exists
        with patch('os.path.exists', side_effect=lambda p: False if str(p).endswith('OVERLAY.png') else real(p)):
            self.assertIn('OVERLAY.png', P['revisar'](False))

    def test_subtitulos_una_palabra_por_vez_con_blanco_y_borde_negro(self):
        receta = {'dur': 8, 'g0': 2, 'cortes': [], 'subs': [
            {'t': 0, 'f': 2, 'original': 'La policía vuelve'}], 'campo': 'original',
            'con_subs': True, 'con_gancho': False}
        ass = P['armar_ass'](receta, 0, 10.5)
        self.assertIn('Style: Sub,Bowlby One,88,&H00FFFFFF,&H00FFFFFF,&H00000000', ass)
        self.assertIn('\\pos(540,1370)', ass)
        self.assertEqual(ass.count('Dialogue: 1,'), 3)
        self.assertIn('}POLICÍA', ass)

    def test_baja_idioma_original_y_prefiere_espanol_si_existe(self):
        with tempfile.TemporaryDirectory() as carpeta:
            def fake_run(cmd, **kwargs):
                Path(carpeta, 'subs.ru.json3').write_text('{}')
                Path(carpeta, 'subs.es.json3').write_text('{}')
                return subprocess.CompletedProcess(cmd, 0, stdout='', stderr='')
            with patch('subprocess.run', side_effect=fake_run) as run:
                archivo = P['bajar_subs']('https://ejemplo.test/video', carpeta, 'ru')
            self.assertTrue(archivo.endswith('subs.es.json3'))
            cmd = run.call_args.args[0]
            self.assertIn('ru', cmd[cmd.index('--sub-langs') + 1])

    def test_no_renderiza_video_extranjero_sin_traduccion_visible(self):
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = Path(carpeta, 'subs_es.json')
            ruta.write_text('[]')
            def error(msg):
                raise ValueError(msg)
            P['fail'] = error
            with self.assertRaisesRegex(ValueError, 'traducción'):
                P['validar_subs_extranjeros']('ru', str(ruta), [], True)
            with self.assertRaisesRegex(ValueError, '--con-subs'):
                P['validar_subs_extranjeros']('ru', str(ruta), [{'es': 'Hola'}], False)
            P['validar_subs_extranjeros']('ru', str(ruta), [{'es': 'Hola'}], True)

    def test_detecta_enojo_y_puteadas_en_varios_idiomas(self):
        enojo = P['ENOJO']
        self.assertIsNotNone(enojo.search('¡Qué mierda!'))
        self.assertIsNotNone(enojo.search('what the fuck'))
        self.assertIsNotNone(enojo.search('блять'))
        self.assertIsNone(enojo.search('computadora'))

    def test_pausa_impide_empezar_otra_descarga(self):
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'pedido-1'}), \
             patch('subprocess.run', return_value=subprocess.CompletedProcess([], 75, stdout='PAUSA_SOLICITADA', stderr='')):
            P['fail'] = lambda msg: (_ for _ in ()).throw(ValueError(msg))
            with self.assertRaisesRegex(ValueError, 'PAUSA_SOLICITADA'):
                P['revisar_pausa']()

    def test_reporta_etapa_sin_interferir_con_el_render(self):
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p1', 'GTA6_RUN_ID': 'r1'}), \
             patch('subprocess.run', return_value=subprocess.CompletedProcess([], 0)) as run:
            P['reportar_avance']('renderizando')
        self.assertEqual(run.call_args.args[0][-2:], ['progreso', 'renderizando'])
        self.assertEqual(run.call_args.kwargs['stdin'], subprocess.DEVNULL)

    def test_no_baja_un_clip_sin_reserva_del_tramo(self):
        a = SimpleNamespace(video_id='video-1', desde='10', hasta='40', dir='/tmp/gta6-trabajo/c1')
        P['fail'] = lambda msg: (_ for _ in ()).throw(ValueError(msg))
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p1'}), \
             patch('subprocess.run', return_value=subprocess.CompletedProcess([], 1, stdout='ERROR: sin reserva', stderr='')):
            with self.assertRaisesRegex(ValueError, 'sin reserva'):
                P['revisar_reserva'](a)


if __name__ == '__main__':
    unittest.main()
