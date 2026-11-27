#!/usr/bin/env python3
"""Procesa un trabajo editorial y un paso de publicación con las claves locales del equipo."""
import json
import os
import subprocess
import sys
import tempfile
import time
import equipo


# El mismo motor devuelve una propuesta, material preparado o un error de la fuente.
ESQUEMA_EDITORIAL = {
    'type': 'object',
    'properties': {
        **{campo: {'type': 'string'} for campo in (
            'titulo', 'descripcion', 'media', 'video_path', 'motivo', 'recorte',
            'instrucciones_media', 'fuente_url', 'error',
        )},
        **{campo: {'type': 'array', 'items': {'type': 'string'}}
           for campo in ('hashtags', 'plataformas', 'imagenes')},
    },
    'additionalProperties': False,
}


def leer_json(texto, mensaje):
    try:
        return json.loads(texto)
    except json.JSONDecodeError:
        raise ValueError(mensaje) from None


def extraer_resultado(texto, con):
    if con == 'claude':
        envoltorio = leer_json(texto, 'Claude no devolvió una respuesta JSON. Volvé a intentar la generación.')
        if not isinstance(envoltorio, dict) or envoltorio.get('is_error'):
            raise ValueError('Claude no completó el trabajo editorial.')
        estructurado = envoltorio.get('structured_output')
        if isinstance(estructurado, dict) and estructurado:
            return estructurado
        texto = envoltorio.get('result') or ''
    texto = texto.strip()
    if texto.startswith('```') and '\n' in texto:
        texto = texto.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    datos = leer_json(texto, 'La IA devolvió una propuesta sin JSON válido. Volvé a intentar la generación.')
    if not isinstance(datos, dict) or not datos:
        raise ValueError('La IA no devolvió una propuesta válida.')
    return datos


def ejecutar(yo, con, exe):
    equipo.pedir('POST', '/api/publicacion', {'op': 'procesar'})
    equipo.pedir('POST', '/api/publicacion', {'op': 'programar_fuentes'})
    t = equipo.pedir('POST', '/api/publicacion', {'op': 'tomar_trabajo'}).get('trabajo')
    if not t:
        return
    cierre = {'op': 'cerrar_trabajo', 'id': t['id'], 'run_id': t['run_id']}
    try:
        with tempfile.TemporaryDirectory(prefix='gta6_editorial_') as carpeta, tempfile.TemporaryFile(mode='w+t', encoding='utf-8') as log:
            prompt = 'GTA6_TOOLS = ' + equipo.AQUI + '\n' + t['prompt'].replace('GTA6_TOOLS/', equipo.AQUI + os.sep)
            comando = equipo.comando_claude(exe, prompt) if con == 'claude' else equipo.comando_codex(exe, prompt)
            ruta_resultado = os.path.join(carpeta, 'resultado.json')
            if con == 'claude':
                comando += ['--json-schema', json.dumps(ESQUEMA_EDITORIAL)]
            else:
                comando += ['--output-last-message', ruta_resultado]
            ruta_avance = os.path.join(carpeta, '.avance-editorial.json')
            entorno = {**os.environ, 'GTA6_AVANCE_EDITORIAL': ruta_avance, 'GTA6_TIPO_EDITORIAL': t.get('tipo', '')}
            p = subprocess.Popen(comando, cwd=carpeta, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.DEVNULL,
                                 env=entorno, text=True, encoding='utf-8', **equipo.grupo_propio())
            inicio = ultimo_latido = time.monotonic()
            ultima_escucha = inicio
            ultimo_porcentaje = 10
            latido = {'op': 'latido_trabajo', 'id': t['id'], 'run_id': t['run_id']}
            try:
                while p.poll() is None:
                    try:
                        p.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        ahora = time.monotonic()
                        if ahora - inicio > 15 * 60:
                            raise TimeoutError('La propuesta tardó más de 15 minutos.')
                        avance = {}
                        try:
                            with open(ruta_avance, encoding='utf-8') as archivo:
                                datos_avance = json.load(archivo)
                            if isinstance(datos_avance, dict) and type(datos_avance.get('porcentaje')) is int:
                                avance = datos_avance
                        except (OSError, ValueError):
                            pass
                        porcentaje = avance.get('porcentaje', 0)
                        toca_latido = ahora - ultimo_latido >= 30
                        if porcentaje > ultimo_porcentaje or toca_latido:
                            try:
                                equipo.pedir('POST', '/api/publicacion', {**latido, 'avance': avance})
                            except (SystemExit, equipo.ConflictoError):
                                if toca_latido:
                                    raise
                                continue
                            ultimo_porcentaje = max(ultimo_porcentaje, porcentaje)
                            if ahora - ultima_escucha >= 30:
                                equipo.escribir('set', 'escucha', yo, {'ultima': equipo.ahora_ms(), 'version': equipo.version_local()})
                                ultima_escucha = ahora
                            ultimo_latido = ahora
            finally:
                if p.poll() is None:
                    equipo.cortar_todo(p)
            if p.returncode:
                raise ValueError(f'La CLI de {con} terminó con código {p.returncode}. Revisá si puede iniciar sesión y usar el modelo editorial.')
            if con == 'claude':
                log.seek(0)
                datos = extraer_resultado(log.read(), con)
            else:
                if not os.path.isfile(ruta_resultado):
                    raise ValueError('Codex no devolvió el resultado editorial. Volvé a intentar la generación.')
                with open(ruta_resultado, encoding='utf-8') as archivo:
                    datos = extraer_resultado(archivo.read(), con)
            if datos.get('error'):
                cierre['error'] = str(datos['error'])[:1000]
            else:
                try:
                    equipo.pedir('POST', '/api/publicacion', {**latido, 'avance': {'porcentaje': 98, 'etapa': 'guardando'}})
                except (SystemExit, equipo.ConflictoError):
                    pass
                cierre['resultado'] = datos
    except (Exception, SystemExit) as e:
        cierre['error'] = str(e)[:1000] or 'Se interrumpió el trabajo editorial.'
    equipo.pedir('POST', '/api/publicacion', cierre)


if __name__ == '__main__':
    import shutil
    con = sys.argv[1] if len(sys.argv) > 1 else ('claude' if shutil.which('claude') else 'codex')
    exe = shutil.which(con)
    if not exe:
        equipo.fail('No encuentro ' + con + ' en esta compu.')
    ejecutar(equipo.pedir('GET', '/api/estado')['yo'], con, exe)
