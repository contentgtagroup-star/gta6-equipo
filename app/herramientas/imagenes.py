#!/usr/bin/env python3
"""Modela imágenes para publicar y les pone el sello del equipo.

Toma una o varias imágenes (por ejemplo las que bajó capturar.py), las lleva al
formato de la red, les aplica el sello discreto en la esquina inferior y, opcional,
una barra de título con la tipografía del equipo. Con --subir las sube a la
biblioteca y devuelve los paths para la cola de publicación.

  python3 imagenes.py --entrada cap_0.jpg,cap_1.jpg [--formato 4:5] [--sello si]
                      [--texto "TÍTULO"] [--dir CARPETA] [--subir]

Reglas del equipo (ver generador-publicaciones-links.md):
  - El sello va SOLO cuando se modela/regenera el material (media = modificar/regenerar).
    Si una imagen se reusa tal cual, no pasa por acá.
  - Formato por defecto 4:5 (1080x1350). El sello va chico, abajo a la derecha.

Solo necesita Python 3 y ffmpeg.
"""
import argparse
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
SELLO = os.path.join(AQUI, 'SELLO.png')
FUENTE = os.path.join(AQUI, 'BowlbyOne-Regular.ttf')
FORMATOS = {'4:5': (1080, 1350), '1:1': (1080, 1080), '9:16': (1080, 1920), '16:9': (1920, 1080)}


def fail(msg):
    print(json.dumps({'error': msg[:500]}, ensure_ascii=False))
    sys.exit(1)


def fpath(p):
    # ffmpeg (filtros) necesita las barras y los dos puntos escapados
    return p.replace('\\', '/').replace(':', '\\:')


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        fail('ffmpeg falló: ' + (r.stderr or r.stdout)[-300:])


def escapar_texto(t):
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", "’").replace('%', '\\%')


def modelar(entrada, salida, w, h, con_sello, texto):
    # 1) cubrir el formato sin deformar y recortar al centro
    filtros = [f'scale={w}:{h}:force_original_aspect_ratio=increase',
               f'crop={w}:{h}', 'setsar=1']
    entradas = ['-i', entrada]
    mapa = '[0:v]' + ','.join(filtros) + '[base]'
    cadena = [mapa]
    ultimo = 'base'
    # 2) barra de título opcional, con la tipografía del equipo.
    #    El cuerpo se achica según el largo para que entre sin cortarse.
    if texto:
        limpio = texto.upper().strip()[:70]
        t = escapar_texto(limpio)
        fs = 56 if len(limpio) <= 22 else 46 if len(limpio) <= 34 else 36
        alto = 176
        barra = (f'[{ultimo}]drawbox=x=0:y={h}-{alto}:w={w}:h={alto}:color=0x0E0320@0.80:t=fill,'
                 f"drawtext=fontfile='{fpath(FUENTE)}':text='{t}':fontcolor=white:fontsize={fs}:"
                 f'borderw=5:bordercolor=black:x=(w-text_w)/2:y={h}-{alto}+(({alto}-text_h)/2)[txt]')
        cadena.append(barra)
        ultimo = 'txt'
    # 3) sello discreto (ancho ~ 32% del formato). Con barra de título va arriba a
    #    la derecha para no taparla; si no, abajo a la derecha.
    if con_sello:
        entradas += ['-i', SELLO]
        sw = int(w * 0.32)
        pos = 'W-w-26:26' if texto else 'W-w-26:H-h-26'
        cadena.append(f'[1:v]scale={sw}:-1[sel]')
        cadena.append(f'[{ultimo}][sel]overlay={pos}[out]')
        ultimo = 'out'
    filtro = ';'.join(cadena)
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *entradas,
         '-filter_complex', filtro, '-map', f'[{ultimo}]', '-frames:v', '1', salida])


def subir(archivo):
    import importlib
    sys.path.insert(0, AQUI)
    equipo = importlib.import_module('equipo')
    d = equipo.pedir('POST', '/api/publicacion', {
        'op': 'subir_media', 'tipo': 'image/jpeg', 'peso': os.path.getsize(archivo)})
    import urllib.request
    with open(archivo, 'rb') as f:
        req = urllib.request.Request(d['url'], data=f.read(), method='PUT',
                                     headers={'Content-Type': 'image/jpeg'})
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()
    return d['path']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--entrada', required=True, help='imágenes separadas por coma')
    ap.add_argument('--formato', default='4:5', choices=list(FORMATOS))
    ap.add_argument('--sello', default='si', choices=['si', 'no'])
    ap.add_argument('--texto', default='')
    ap.add_argument('--dir', default='.')
    ap.add_argument('--subir', action='store_true')
    a = ap.parse_args()
    if a.sello == 'si' and not os.path.exists(SELLO):
        fail('Falta SELLO.png. Actualizá las herramientas: python3 equipo.py herramientas.')
    w, h = FORMATOS[a.formato]
    carpeta = os.path.abspath(a.dir)
    os.makedirs(carpeta, exist_ok=True)
    entradas = [e.strip() for e in a.entrada.split(',') if e.strip()]
    if not entradas:
        fail('No pasaste ninguna imagen.')
    archivos, paths = [], []
    for i, e in enumerate(entradas[:10]):
        origen = e if os.path.isabs(e) else os.path.join(carpeta, e)
        if not os.path.exists(origen):
            fail('No encuentro la imagen ' + e)
        salida = os.path.join(carpeta, f'pub_{i}.jpg')
        modelar(origen, salida, w, h, a.sello == 'si', a.texto if i == 0 else '')
        archivos.append(salida)
        if a.subir:
            paths.append(subir(salida))
    out = {'ok': True, 'formato': a.formato, 'archivos': archivos, 'n': len(archivos)}
    if a.subir:
        out['imagenes'] = paths
    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
