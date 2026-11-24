#!/usr/bin/env python3
"""Captura el contenido de un link para armar una publicación (no clip).

Dado el link de un post, devuelve de forma determinística el texto, el idioma,
el autor y las imágenes descargadas con su cantidad. No descarga streams enteros
ni hace descargas masivas: solo ese post.

  python3 capturar.py <url> [--dir CARPETA]

Salida JSON:
  { "ok": true, "plataforma": "X", "autor": "...", "texto": "...", "idioma": "es",
    "fecha": "...", "imagenes": ["cap_0.jpg", ...], "n_imagenes": 2, "video": false }
o  { "error": "qué acceso falta" } si el post no es accesible.

Para X/Twitter usa el endpoint público de sindicación (el mismo que alimenta los
tweets embebidos). Para el resto intenta yt-dlp (metadatos + miniatura). Solo
necesita Python 3; yt-dlp es opcional para el camino de respaldo.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')
DIGITOS = '0123456789abcdefghijklmnopqrstuvwxyz'


def fail(msg):
    print(json.dumps({'error': msg[:500]}, ensure_ascii=False))
    sys.exit(1)


def plataforma(host):
    host = host.replace('www.', '').lower()
    return {'x.com': 'X', 'twitter.com': 'X', 'instagram.com': 'Instagram',
            'tiktok.com': 'TikTok', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
            'twitch.tv': 'Twitch', 'kick.com': 'Kick'}.get(host, 'Web')


def pedir(url, binario=False, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if binario else r.read().decode('utf-8', 'replace')


def token_x(tweet_id):
    # Mismo algoritmo que el widget oficial: ((id/1e15)*PI) en base 36, sin ceros ni puntos.
    n = (int(tweet_id) / 1e15) * math.pi
    entero, frac = int(n), n - int(n)
    s = ''
    if entero == 0:
        s = '0'
    while entero > 0:
        s = DIGITOS[entero % 36] + s
        entero //= 36
    s += '.'
    for _ in range(24):
        frac *= 36
        d = int(frac)
        s += DIGITOS[d]
        frac -= d
    return re.sub(r'(0+|\.)', '', s)


def texto_x(d):
    # Texto completo: los posts largos traen el texto entero en note_tweet,
    # y el campo text viene recortado. Expande los t.co y saca el link final al propio medio.
    nota = (((d.get('note_tweet') or {}).get('note_tweet_results') or {}).get('result') or {}).get('text')
    texto = (nota or d.get('text') or '').strip()
    ent = (d.get('note_tweet') or {}).get('note_tweet_results', {}).get('result', {}).get('entity_set') if nota else d.get('entities')
    for u in ((ent or {}).get('urls') or []):
        corto, largo = u.get('url'), u.get('expanded_url')
        if corto and largo:
            texto = texto.replace(corto, largo)
    # El embed agrega al final un t.co que apunta a las fotos/video del propio post: lo quitamos.
    if d.get('mediaDetails'):
        texto = re.sub(r'\s*https://t\.co/\w+\s*$', '', texto)
    return texto.strip()


def bajar_imagenes(urls, carpeta):
    archivos = []
    for i, u in enumerate(urls[:10]):
        ext = '.png' if '.png' in u.lower() else '.jpg'
        destino = os.path.join(carpeta, f'cap_{i}{ext}')
        try:
            with open(destino, 'wb') as f:
                f.write(pedir(u, binario=True, timeout=60))
            archivos.append(os.path.basename(destino))
        except Exception:
            pass
    return archivos


def capturar_x(url, carpeta):
    m = re.search(r'(?:x|twitter)\.com/[^/]+/status(?:es)?/(\d+)', url)
    if not m:
        fail('No pude leer el id del tweet en el link.')
    tid = m.group(1)
    api = (f'https://cdn.syndication.twimg.com/tweet-result?id={tid}'
           f'&token={token_x(tid)}&lang=es')
    try:
        d = json.loads(pedir(api))
    except Exception:
        fail('X no devolvió el post. Puede estar protegido o borrado; probá con otro link.')
    if d.get('__typename') == 'TweetTombstone' or d.get('text') is None and not d.get('mediaDetails'):
        fail('El post no está disponible públicamente (protegido, borrado o solo para seguidores).')
    medios = d.get('mediaDetails') or []
    fotos = [m2['media_url_https'] + '?name=large' for m2 in medios if m2.get('type') == 'photo']
    if not fotos:
        fotos = [p['url'] for p in (d.get('photos') or [])]
    video = any(m2.get('type') in ('video', 'animated_gif') for m2 in medios)
    archivos = bajar_imagenes(fotos, carpeta)
    user = d.get('user') or {}
    return {
        'ok': True, 'plataforma': 'X',
        'autor': user.get('screen_name') or user.get('name') or '',
        'texto': texto_x(d),
        'idioma': d.get('lang') or '?',
        'fecha': d.get('created_at') or '',
        'imagenes': archivos, 'n_imagenes': len(archivos), 'video': video,
    }


def capturar_generico(url, carpeta):
    # Respaldo: metadatos + miniatura con yt-dlp. No baja el video.
    try:
        j = json.loads(subprocess.run(
            ['yt-dlp', '-j', '--skip-download', '--no-warnings', url],
            capture_output=True, text=True, timeout=90).stdout or '{}')
    except Exception:
        j = {}
    if not j:
        fail('No pude leer ese link automáticamente. Pegá el texto y las imágenes a mano o probá un post de X.')
    thumb = j.get('thumbnail')
    archivos = bajar_imagenes([thumb] if thumb else [], carpeta)
    return {
        'ok': True, 'plataforma': plataforma(j.get('webpage_url_domain') or ''),
        'autor': j.get('uploader') or j.get('channel') or '',
        'texto': (j.get('description') or j.get('title') or '').strip(),
        'idioma': j.get('language') or '?',
        'fecha': str(j.get('upload_date') or ''),
        'imagenes': archivos, 'n_imagenes': len(archivos),
        'video': bool(j.get('duration')),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url')
    ap.add_argument('--dir', default='.')
    a = ap.parse_args()
    carpeta = os.path.abspath(a.dir)
    os.makedirs(carpeta, exist_ok=True)
    host = re.sub(r'^https?://', '', a.url).split('/')[0]
    if plataforma(host) == 'X':
        salida = capturar_x(a.url, carpeta)
    else:
        salida = capturar_generico(a.url, carpeta)
    salida['dir'] = carpeta
    print(json.dumps(salida, ensure_ascii=False))


if __name__ == '__main__':
    main()
