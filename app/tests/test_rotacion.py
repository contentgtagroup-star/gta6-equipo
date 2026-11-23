import os
import subprocess
import sys
import tempfile
import unittest
import contextlib
import io
import json
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'herramientas'))
import equipo


class RotacionVideosTest(unittest.TestCase):
    def test_correcciones_solo_del_solicitante_incluso_vencidas(self):
        docs = [
            {'id': 'mia', 'datos': {'estado': 'corregir', 'responsable': 'Luis', 'corrige_por': 'Cuervo'}},
            {'id': 'ajena', 'datos': {'estado': 'corregir', 'responsable': 'Cuervo', 'corrige_por': 'Luis'}},
            {'id': 'vencida-ajena', 'datos': {'estado': 'corrigiendo', 'corrige_por': 'Luis', 'corrigiendo_el': 1}},
            {'id': 'vencida-mia', 'datos': {'estado': 'corrigiendo', 'corrige_por': 'Cuervo', 'corrigiendo_el': 1}},
            {'id': 'sin-dueno', 'datos': {'estado': 'corregir'}},
        ]
        self.assertEqual([d['id'] for d in equipo.correcciones_pendientes(docs, 'Cuervo')], ['mia', 'vencida-mia'])

    def test_prefiere_otro_streamer_aunque_el_link_sea_de_otra_persona(self):
        radar = {'canales_recientes': ['Streamer A'], 'ultimo_canal_por': {'Cuervo': 'Streamer A'}, 'videos': [
            {'id': 'uno', 'canal': 'Streamer A', 'para': 'Cuervo'},
            {'id': 'dos', 'canal': 'Streamer B', 'para': 'Eze'},
        ]}
        self.assertEqual(equipo.elegir_video(radar, 'Cuervo')['id'], 'dos')

    def test_no_reutiliza_un_video_tomado(self):
        radar = {'videos': [
            {'id': 'uno', 'canal': 'A', 'para': 'Cuervo', 'estado': 'tomado', 'tomado_el': equipo.ahora_ms()},
            {'id': 'dos', 'canal': 'B', 'para': 'Cuervo', 'estado': 'libre'},
        ]}
        self.assertEqual(equipo.elegir_video(radar, 'Cuervo')['id'], 'dos')

    def test_video_de_otro_pedido_activo_no_vence_a_las_tres_horas(self):
        video = {'estado': 'tomado', 'tomado_el': equipo.ahora_ms() - 4 * 3600_000,
                 'tomado_pedido': 'pedido-luis'}
        self.assertFalse(equipo.libre(video, {'pedido-luis'}))

    def test_usa_el_unico_canal_disponible(self):
        radar = {'canales_recientes': ['A'], 'videos': [{'id': 'uno', 'canal': 'A', 'para': 'Cuervo'}]}
        self.assertEqual(equipo.elegir_video(radar, 'Cuervo')['id'], 'uno')

    def test_entre_canales_nuevos_prioriza_mas_vistas(self):
        radar = {'videos': [
            {'id': 'pocas', 'canal': 'A', 'para': 'Cuervo', 'vistas': 1000, 'vph': 200},
            {'id': 'muchas', 'canal': 'B', 'para': 'Eze', 'vistas': 50000, 'vph': 150},
        ]}
        self.assertEqual(equipo.elegir_video(radar, 'Cuervo')['id'], 'muchas')

    def test_dos_recopilaciones_no_pueden_reservar_un_mismo_clip(self):
        datos = {}
        def ejecutar(id_, clips, pedido):
            salida = io.StringIO()
            def modificar(col, clave, fn):
                self.assertEqual((col, clave), ('recop_reservas', 'global'))
                return fn(datos)
            with patch.object(sys, 'argv', ['equipo.py', 'reservar-recop', id_, '--clips', clips]), \
                 patch.object(equipo, 'pedidos_activos', return_value={'p-cuervo', 'p-luis'}), \
                 patch.object(equipo, 'modificar', side_effect=modificar), \
                 patch.dict(os.environ, {'GTA6_TURNO_ID': pedido}), contextlib.redirect_stdout(salida):
                equipo.main()
            return json.loads(salida.getvalue())
        self.assertTrue(ejecutar('rc-uno', 'a,b,c,d', 'p-cuervo')['ok'])
        self.assertEqual(ejecutar('rc-otro', 'd,e,f,g', 'p-luis'), {'ok': False, 'duplicado': True})
        self.assertTrue(ejecutar('rc-nuevo', 'e,f,g,h', 'p-luis')['ok'])


class TurnoAutomaticoTest(unittest.TestCase):
    def test_comando_codex_usa_el_modo_compatible_con_exec(self):
        self.assertEqual(equipo.comando_codex('codex', 'Crear clips'),
                         ['codex', 'exec', '--approve-for-me', '--skip-git-repo-check', 'Crear clips'])

    def test_cambia_a_codex_si_claude_se_queda_sin_creditos(self):
        comandos = []
        entradas = []
        def pedir(metodo, ruta, datos):
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p5', 'run_id': 'r5', 'cantidad': 3, 'prompt': 'Crear clips'}
            if datos['op'] == 'cerrar':
                self.assertTrue(datos['ok'])
                return {'ok': True, 'estado': 'terminado'}
            return {'ok': True}
        class Proceso:
            def __init__(self, cmd, **kwargs):
                comandos.append(cmd)
                entradas.append(kwargs['stdin'])
                kwargs['stdout'].write('{"result":"You\'ve hit your weekly limit · resets 10am (America/Argentina/Cordoba) · out of usage credits"}' if cmd[0] == 'claude' else 'Clips listos')
                self.codigo = 0
            def wait(self, timeout=None):
                return self.codigo
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': 'Eze', 'pedido_id': 'p5'}}
        with patch.object(equipo, 'get', return_value=turno), patch.object(equipo, 'pedir', side_effect=pedir), \
             patch('subprocess.Popen', Proceso), patch('shutil.which', return_value='codex'):
            equipo.ejecutar_turno('Eze', 'claude', 'claude')
        self.assertEqual([c[0] for c in comandos], ['claude', 'codex'])
        self.assertEqual(comandos[1], ['codex', 'exec', '--approve-for-me', '--skip-git-repo-check', 'Crear clips'])
        self.assertEqual(entradas, [subprocess.DEVNULL, subprocess.DEVNULL])

    def test_no_cambia_de_motor_por_un_error_ajeno_a_los_creditos(self):
        self.assertFalse(equipo.sin_creditos_claude(1, '{"is_error":true,"result":"Archivo no encontrado"}'))
        self.assertFalse(equipo.sin_creditos_claude(0, '{"result":"Usage limit reached en un comentario"}'))
        self.assertTrue(equipo.sin_creditos_claude(0, '{"is_error":true,"result":"Credit balance is too low"}'))
        self.assertTrue(equipo.sin_creditos_claude(0, "You've hit your weekly limit · resets 10am (America/Argentina/Cordoba) · out of usage credits"))

    def test_solo_la_compu_asignada_abre_claude_y_cierra_el_turno(self):
        llamadas = []
        entornos = []
        def pedir(metodo, ruta, datos):
            llamadas.append(datos)
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p1', 'run_id': 'r1', 'cantidad': 3, 'prompt': 'Crear tres clips'}
            return {'ok': True}
        class Proceso:
            def __init__(self, cmd, **kwargs):
                llamadas.append(cmd)
                entornos.append(kwargs['env']['GTA6_TURNO_ID'])
                kwargs['stdout'].write('{"result":"Tres clips listos"}')
            def wait(self, timeout=None):
                return 0
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': 'Eze', 'pedido_id': 'p1'}}
        with patch.object(equipo, 'get', return_value=turno), patch.object(equipo, 'pedir', side_effect=pedir), patch('subprocess.Popen', Proceso):
            equipo.ejecutar_turno('Cuervo', 'claude', 'claude')
            self.assertEqual(llamadas, [])
            equipo.ejecutar_turno('Eze', 'claude', 'claude')
        self.assertEqual([x['op'] for x in llamadas if isinstance(x, dict)], ['tomar', 'cerrar'])
        self.assertEqual(llamadas[1][0], 'claude')
        self.assertEqual(entornos, ['p1'])
        self.assertTrue(llamadas[2]['ok'])

    def test_otra_compu_recupera_un_pedido_viejo_antes_de_tomarlo(self):
        operaciones = []
        def pedir(metodo, ruta, datos):
            operaciones.append(datos['op'])
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p2', 'run_id': 'r2', 'cantidad': 2, 'prompt': 'Crear clips'}
            return {'ok': True}
        class Proceso:
            def __init__(self, cmd, **kwargs):
                kwargs['stdout'].write('{"result":"Listo"}')
            def wait(self, timeout=None):
                return 0
        viejo = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': 'Luis',
                 'pedido_id': 'p2', 'asignado_el': equipo.ahora_ms() - 9 * 60000}}
        with patch.object(equipo, 'get', return_value=viejo), patch.object(equipo, 'pedir', side_effect=pedir), patch('subprocess.Popen', Proceso):
            equipo.ejecutar_turno('Cuervo', 'claude', 'claude')
        self.assertEqual(operaciones, ['recuperar', 'tomar', 'cerrar'])

    def test_luis_toma_su_pedido_mientras_cuervo_sigue_trabajando(self):
        operaciones = []
        def pedir(metodo, ruta, datos):
            operaciones.append(datos['op'])
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p-luis', 'run_id': 'r-luis', 'cantidad': 2, 'prompt': 'Crear clips'}
            return {'ok': True}
        class Proceso:
            def __init__(self, cmd, **kwargs):
                kwargs['stdout'].write('{"result":"Listo"}')
            def wait(self, timeout=None):
                return 0
        global_ = {'existe': True, 'datos': {'estado': 'ejecutando', 'asignado': 'Cuervo', 'pedido_id': 'p-cuervo',
                   'pedidos': [{'estado': 'pendiente', 'asignado': 'Luis', 'pedido_id': 'p-luis'}]}}
        with patch.object(equipo, 'get', return_value=global_), patch.object(equipo, 'pedir', side_effect=pedir), \
             patch('subprocess.Popen', Proceso):
            equipo.ejecutar_turno('Luis', 'claude', 'claude')
        self.assertEqual(operaciones, ['tomar', 'cerrar'])

    def test_compu_actualizada_toma_enseguida_un_pedido_sin_asignar(self):
        operaciones = []
        def pedir(metodo, ruta, datos):
            operaciones.append(datos['op'])
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p-sin', 'run_id': 'r-sin', 'cantidad': 2, 'prompt': 'Crear clips'}
            return {'ok': True}
        class Proceso:
            def __init__(self, cmd, **kwargs):
                kwargs['stdout'].write('{"result":"Listo"}')
            def wait(self, timeout=None):
                return 0
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': None,
                 'pedido_id': 'p-sin', 'asignado_el': equipo.ahora_ms()}}
        with patch.object(equipo, 'get', return_value=turno), patch.object(equipo, 'pedir', side_effect=pedir), patch('subprocess.Popen', Proceso):
            equipo.ejecutar_turno('Cuervo', 'claude', 'claude')
        self.assertEqual(operaciones, ['recuperar', 'tomar', 'cerrar'])

    def test_no_toma_pedido_ajeno_aunque_figure_asignado(self):
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': 'Cuervo',
                 'pedido_por': 'Luis', 'pedido_id': 'p-luis'}}
        with patch.object(equipo, 'get', return_value=turno), patch.object(equipo, 'pedir') as red:
            equipo.ejecutar_turno('Cuervo', 'claude', 'claude')
        red.assert_not_called()

    def test_no_recupera_pedido_sin_asignar_de_otra_persona(self):
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': None,
                 'pedido_por': 'Luis', 'pedido_id': 'p-luis'}}
        with patch.object(equipo, 'get', return_value=turno), patch.object(equipo, 'pedir') as red:
            equipo.ejecutar_turno('Cuervo', 'claude', 'claude')
        red.assert_not_called()

    def test_guarda_y_reenvia_el_cierre_si_se_corta_internet(self):
        class Proceso:
            def __init__(self, cmd, **kwargs):
                kwargs['stdout'].write('{"result":"Listo"}')
            def wait(self, timeout=None):
                return 0
        turno = {'existe': True, 'datos': {'estado': 'pendiente', 'asignado': 'Eze', 'pedido_id': 'p3'}}
        enviados = []
        def pedir(metodo, ruta, datos):
            if datos['op'] == 'tomar':
                return {'pedido_id': 'p3', 'run_id': 'r3', 'cantidad': 2, 'prompt': 'Crear clips'}
            enviados.append(datos)
            if len(enviados) <= 3:
                raise SystemExit(1)
            return {'ok': True}
        with tempfile.TemporaryDirectory() as carpeta:
            archivo = Path(carpeta) / 'cierre.json'
            with patch.object(equipo, 'CIERRE_PENDIENTE', str(archivo)), patch.object(equipo, 'get', return_value=turno), \
                 patch.object(equipo, 'pedir', side_effect=pedir), patch('subprocess.Popen', Proceso), patch('time.sleep'):
                equipo.ejecutar_turno('Eze', 'claude', 'claude')
                self.assertTrue(archivo.exists())
                equipo.reenviar_cierre()
                self.assertFalse(archivo.exists())
        self.assertEqual([x['op'] for x in enviados], ['cerrar'] * 4)

    def test_comprobar_turno_frena_un_nuevo_clip_si_piden_pausa(self):
        pausado = {'existe': True, 'datos': {'pedido_id': 'p4', 'estado': 'pausa_solicitada'}}
        activo = {'existe': True, 'datos': {'pedido_id': 'p4', 'estado': 'ejecutando'}}
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p4'}), patch.object(equipo, 'get', return_value=pausado):
            with self.assertRaises(SystemExit) as error:
                equipo.comprobar_turno()
            self.assertEqual(error.exception.code, 75)
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p4'}), patch.object(equipo, 'get', return_value=activo):
            equipo.comprobar_turno()
        with patch.dict(os.environ, {'GTA6_TURNO_ID': ''}), patch.object(equipo, 'get', return_value=pausado):
            with self.assertRaises(SystemExit) as error:
                equipo.comprobar_turno('p4')
            self.assertEqual(error.exception.code, 75)

    def test_reporta_etapa_solo_en_el_pedido_y_ejecucion_actual(self):
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p7', 'GTA6_RUN_ID': 'r7'}), \
             patch.object(equipo, 'pedir', return_value={'ok': True}) as red:
            equipo.reportar_avance('renderizando')
        self.assertEqual(red.call_args.args[2], {'op': 'avance', 'pedido_id': 'p7',
                                                  'run_id': 'r7', 'fase': 'renderizando'})
        self.assertEqual(red.call_args.kwargs['timeout'], 5)

    def test_tomar_link_no_reserva_nada_durante_la_pausa(self):
        pausado = {'existe': True, 'datos': {'pedido_id': 'p4', 'estado': 'pausa_solicitada'}}
        with patch.dict(os.environ, {'GTA6_TURNO_ID': 'p4'}), patch('sys.argv', ['equipo.py', 'tomar-link']), \
             patch.object(equipo, 'get', return_value=pausado), patch.object(equipo, 'pedir') as red:
            with self.assertRaises(SystemExit) as error:
                equipo.main()
            self.assertEqual(error.exception.code, 75)
        red.assert_not_called()

    def test_tramos_solapados_se_descartan_antes_de_descargar(self):
        datos = {}
        def modificar(col, video_id, fn):
            self.assertEqual(col, 'usados')
            return fn(datos)
        def reservar(pedido, clip, desde, hasta):
            salida = io.StringIO()
            with patch.dict(os.environ, {'GTA6_TURNO_ID': pedido}), \
                 patch('sys.argv', ['equipo.py', 'reservar-tramo', 'video-1', '--desde', str(desde), '--hasta', str(hasta), '--clip', clip]), \
                 patch.object(equipo, 'pedir', return_value={'yo': 'Cuervo'}), \
                 patch.object(equipo, 'pedidos_activos', return_value={'p1', 'p2'}), \
                 patch.object(equipo, 'modificar', side_effect=modificar), contextlib.redirect_stdout(salida):
                equipo.main()
            return json.loads(salida.getvalue())
        import json
        self.assertTrue(reservar('p1', 'c1', 10, 40)['ok'])
        self.assertEqual(reservar('p2', 'c2', 30, 55), {'ok': False, 'duplicado': True})
        self.assertTrue(reservar('p2', 'c3', 45, 70)['ok'])


class PedidoDirectoTest(unittest.TestCase):
    def ejecutar(self, turno, radar, usados=None, activos=None):
        salida = io.StringIO()
        modificar_llamado = []
        def get(col, id_):
            if col == 'turnos':
                return {'existe': True, 'datos': turno}
            if col == 'usados':
                return {'existe': usados is not None, 'datos': usados or {}}
            raise AssertionError(f'lectura inesperada: {col}/{id_}')
        def modificar(col, clave, fn):
            modificar_llamado.append((col, clave))
            self.assertEqual((col, clave), ('radar', 'actual'))
            return fn(radar)
        with patch.dict(os.environ, {'GTA6_TURNO_ID': turno['pedido_id']}), \
             patch('sys.argv', ['equipo.py', 'tomar-link']), \
             patch.object(equipo, 'get', side_effect=get), \
             patch.object(equipo, 'pedir', side_effect=lambda m, r, d=None: {'yo': 'Cuervo'} if r == '/api/estado' else {'ok': True}), \
             patch.object(equipo, 'pedidos_activos', return_value=activos or set()), \
             patch.object(equipo, 'modificar', side_effect=modificar), contextlib.redirect_stdout(salida):
            equipo.main()
        return json.loads(salida.getvalue()), modificar_llamado

    def turno_directo(self, video_id='vid-directo'):
        return {'estado': 'ejecutando', 'pedido_id': 'p1', 'video_id': video_id,
                'video_url': 'https://www.youtube.com/watch?v=' + video_id,
                'video_plataforma': 'youtube'}

    def test_toma_solo_el_enlace_vinculado(self):
        turno = self.turno_directo()
        radar = {'videos': [
            {'id': 'otro', 'url': 'https://www.youtube.com/watch?v=otro', 'estado': 'libre', 'canal': 'B'},
            {'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'libre', 'canal': 'A'},
        ]}
        res, _ = self.ejecutar(turno, radar)
        self.assertEqual(res['link']['id'], 'vid-directo')
        self.assertTrue(res['directo'])
        directo = next(v for v in radar['videos'] if v['id'] == 'vid-directo')
        otro = next(v for v in radar['videos'] if v['id'] == 'otro')
        self.assertEqual(directo['estado'], 'tomado')
        self.assertEqual(directo['tomado_pedido'], 'p1')
        self.assertEqual(directo['tomado_por'], 'Cuervo')
        self.assertEqual(otro['estado'], 'libre')

    def test_no_cae_a_otro_video_si_el_suyo_esta_tomado(self):
        turno = self.turno_directo()
        radar = {'videos': [
            {'id': 'otro', 'url': 'https://www.youtube.com/watch?v=otro', 'estado': 'libre'},
            {'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'tomado',
             'tomado_por': 'Luis', 'tomado_pedido': 'p-otro', 'tomado_el': equipo.ahora_ms()},
        ]}
        res, _ = self.ejecutar(turno, radar, activos={'p-otro'})
        self.assertIsNone(res['link'])
        self.assertIn('otra compu o pedido', res['error'])
        self.assertEqual(next(v for v in radar['videos'] if v['id'] == 'otro')['estado'], 'libre')
        self.assertEqual(next(v for v in radar['videos'] if v['id'] == 'vid-directo')['tomado_pedido'], 'p-otro')

    def test_reintento_del_mismo_pedido_recupera_su_reserva(self):
        turno = self.turno_directo()
        radar = {'videos': [
            {'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'tomado',
             'tomado_por': 'Cuervo', 'tomado_pedido': 'p1', 'tomado_el': equipo.ahora_ms()},
        ]}
        res, _ = self.ejecutar(turno, radar, activos={'p1'})
        self.assertEqual(res['link']['id'], 'vid-directo')
        self.assertEqual(radar['videos'][0]['tomado_pedido'], 'p1')

    def test_rechaza_un_video_ya_hecho(self):
        turno = self.turno_directo()
        radar = {'videos': [
            {'id': 'otro', 'url': 'https://www.youtube.com/watch?v=otro', 'estado': 'libre'},
            {'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'hecho'},
        ]}
        res, _ = self.ejecutar(turno, radar)
        self.assertIsNone(res['link'])
        self.assertIn('ya se usó', res['error'])
        self.assertEqual(next(v for v in radar['videos'] if v['id'] == 'otro')['estado'], 'libre')

    def test_agrega_el_enlace_si_no_estaba_en_radar(self):
        turno = self.turno_directo()
        radar = {'videos': [{'id': 'otro', 'url': 'https://www.youtube.com/watch?v=otro', 'estado': 'libre'}]}
        res, _ = self.ejecutar(turno, radar)
        self.assertEqual(res['link']['id'], 'vid-directo')
        self.assertEqual(radar['videos'][0]['id'], 'vid-directo')
        self.assertEqual(radar['videos'][0]['estado'], 'tomado')
        self.assertEqual(radar['videos'][0]['tomado_pedido'], 'p1')

    def test_rechaza_un_enlace_usado_por_otro_pedido_sin_tocar_el_radar(self):
        turno = self.turno_directo()
        radar = {'videos': [{'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'libre'}]}
        res, llamados = self.ejecutar(turno, radar, usados={'tramos': [{'pedido_id': 'p-otro', 'clip': 'c1'}]})
        self.assertIsNone(res['link'])
        self.assertIn('ya se usó', res['error'])
        self.assertEqual(llamados, [])
        self.assertEqual(radar['videos'][0]['estado'], 'libre')

    def test_una_reserva_vencida_ajena_no_bloquea_el_enlace(self):
        turno = self.turno_directo()
        radar = {'videos': [{'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'libre'}]}
        res, _ = self.ejecutar(turno, radar, usados={'tramos': [
            {'pedido_id': 'p-viejo', 'estado': 'reservado', 'reservado_el': equipo.ahora_ms() - 6 * 60 * 1000}
        ]})
        self.assertEqual(res['link']['id'], 'vid-directo')

    def test_una_reserva_de_un_pedido_activo_bloquea_el_enlace(self):
        turno = self.turno_directo()
        radar = {'videos': [{'id': 'vid-directo', 'url': 'https://www.youtube.com/watch?v=vid-directo', 'estado': 'libre'}]}
        res, llamados = self.ejecutar(turno, radar, usados={'tramos': [
            {'pedido_id': 'p-otro', 'estado': 'reservado', 'reservado_el': equipo.ahora_ms()}
        ]}, activos={'p-otro'})
        self.assertIsNone(res['link'])
        self.assertIn('ya se usó', res['error'])
        self.assertEqual(llamados, [])

    def test_el_flujo_normal_sigue_eligiendo_del_radar(self):
        turno = {'estado': 'ejecutando', 'pedido_id': 'p-normal'}
        radar = {'videos': [{'id': 'libre', 'url': 'https://www.youtube.com/watch?v=libre', 'estado': 'libre', 'canal': 'A'}]}
        res, _ = self.ejecutar(turno, radar)
        self.assertEqual(res['link']['id'], 'libre')
        self.assertNotIn('directo', res)
        self.assertEqual(radar['videos'][0]['tomado_pedido'], 'p-normal')


if __name__ == '__main__':
    unittest.main()
