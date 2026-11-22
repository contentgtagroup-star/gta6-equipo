#!/usr/bin/env python3
"""Procesa un trabajo editorial y un paso de publicación con las claves locales del equipo."""
import json
import os
import subprocess
import sys
import tempfile
import time
import equipo


def extraer_resultado(texto, con):
    if con == 'claude':
        envoltorio = json.loads(texto)
        if envoltorio.get('is_error'):
            raise ValueError('La IA no completó el trabajo editorial.')
        texto = envoltorio.get('result') or ''
    texto = texto.strip()
    if texto.startswith('```'):
        texto = texto.split('\n', 1)[1].rsplit('```', 1)[0].strip()
    datos = json.loads(texto)
    if not isinstance(datos, dict):
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
            p = subprocess.Popen(comando, cwd=carpeta, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.DEVNULL,
                                 text=True, encoding='utf-8', **equipo.grupo_propio())
            inicio = time.monotonic()
            try:
                while p.poll() is None:
                    try:
                        p.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        if time.monotonic() - inicio > 15 * 60:
                            raise TimeoutError('La propuesta tardó más de 15 minutos.')
                        equipo.pedir('POST', '/api/publicacion', {'op': 'latido_trabajo', 'id': t['id'], 'run_id': t['run_id']})
                        equipo.escribir('set', 'escucha', yo, {'ultima': equipo.ahora_ms(), 'version': equipo.version_local()})
            finally:
                if p.poll() is None:
                    equipo.cortar_todo(p)
            if p.returncode:
                raise ValueError('El motor editorial no pudo terminar. Revisá el acceso de la CLI y de la fuente.')
            log.seek(0)
            datos = extraer_resultado(log.read(200000), con)
            if datos.get('error'):
                cierre['error'] = str(datos['error'])[:1000]
            else:
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
