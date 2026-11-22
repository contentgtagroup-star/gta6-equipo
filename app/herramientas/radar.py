#!/usr/bin/env python3
"""Radar GTA 6: busca videos de hoy en YouTube, los ordena por vistas y vistas/hora y guarda los picos de 'más repetido' (heatmap).

  python3 radar.py                              videos de hoy (incluye búsquedas de easter eggs / misterio / terror)
  python3 radar.py cuentas @MatiClipss @otra     Shorts más vistos de esas cuentas de clips (cuentas_resultado.json)
  python3 radar.py twitch [--horas 24]           clips y VODs más vistos de GTA VI en Twitch (vía la app, API oficial)
"""
import os, json, re, subprocess, sys, time, concurrent.futures as cf, pathlib, datetime
from urllib.parse import quote_plus
OUT = pathlib.Path('.')
HOY = 'EgIIAg%253D%253D'   # filtro "hoy"
QUERIES = ['GTA 6 en vivo', 'GTA 6 reaccion', 'GTA 6 español gameplay', 'GTA 6 momentos graciosos',
           'GTA 6 primera vez', 'GTA 6 directo', 'GTA 6 gameplay', 'GTA 6 funny moments', 'GTA 6 first time playing',
           'GTA 6 easter egg', 'GTA 6 secretos', 'GTA 6 misterio', 'GTA 6 glitch', 'GTA 6 aliens', 'GTA 6 fantasma', 'GTA 6 terror', 'GTA 6 realista',
           'GTA 6 русский стрим', 'GTA 6 brasil ao vivo', 'GTA 6 français live', 'GTA 6 deutsch stream',
           'GTA 6 streamer se enoja', 'GTA 6 streamer rage']
PALABRAS_ALERTA = ['easter egg', 'huevo de pascua', 'secreto', 'secret', 'oculto', 'hidden', 'misterio', 'mystery', 'glitch', 'alien', 'ovni', 'ufo',
                   'monstruo', 'monster', 'fantasma', 'ghost', 'terror', 'horror', 'creepy', 'leyenda', 'teoría', 'teoria', 'theory', 'filtrado', 'leak',
                   'bug', 'realismo', 'realism', 'realista', 'realistic', 'vida real', 'real life', 'bigfoot', 'zombie', 'embrujado', 'haunted', 'conspiración', 'conspiracy', 'paranormal']
def alerta(titulo):
    t = (titulo or '').lower()
    return [k for k in PALABRAS_ALERTA if k in t]
class Bloqueado(Exception):
    pass


def run(args, t=120):
    cookies = ['--cookies-from-browser', os.environ['GTA6_COOKIES']] if os.environ.get('GTA6_COOKIES') else []
    r = subprocess.run(['yt-dlp', *cookies, *args], capture_output=True, text=True, timeout=t)
    if 'confirm you' in r.stderr or 'HTTP Error 429' in r.stderr:
        raise Bloqueado()
    return r.stdout
def buscar(q):
    url = f'https://www.youtube.com/results?search_query={quote_plus(q)}&sp={HOY}'
    out = run([url, '--flat-playlist', '--playlist-end', '25', '--print', '%(id)s\t%(view_count)s'])
    return [l.split('\t') for l in out.splitlines() if '\t' in l]


DETALLE = 25   # solo los más vistos se consultan uno por uno: pedir los datos de cada resultado hacía que YouTube bloqueara la conexión
def meta(vid):
    try:
        j = json.loads(run(['-j', '--skip-download', f'https://www.youtube.com/watch?v={vid}'], 90))
    except Bloqueado:
        raise
    except Exception:
        return None
    ts = j.get('release_timestamp') or j.get('timestamp')
    horas = max((time.time() - ts) / 3600, 0.5) if ts else None
    v = j.get('view_count') or 0
    hm = j.get('heatmap') or []
    picos = sorted(hm, key=lambda h: -h.get('value', 0))[:8]
    return dict(id=vid, titulo=j.get('title'), canal=j.get('channel'), canal_url=j.get('channel_url'),
                vistas=v, horas=round(horas, 1) if horas else None, vph=round(v / horas) if horas else 0,
                fecha=datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).date().isoformat() if ts else None,
                duracion=j.get('duration'), alerta=alerta(j.get('title')), idioma=j.get('language'), en_vivo=j.get('live_status'),
                picos=[(round(p['start_time']), round(p['end_time']), round(p['value'], 2)) for p in picos])
def consultas_categoria():
    id_ = os.environ.get('GTA6_CATEGORIA', '')
    if not id_:
        return QUERIES
    categorias = json.loads(pathlib.Path(__file__).with_name('categorias.json').read_text(encoding='utf-8'))
    c = next((c for c in categorias if c['id'] == id_ and c['enabled']), None)
    if not c:
        raise ValueError('categoría inválida.')
    return c['researchQueries']


def main():
    consultas = consultas_categoria()
    ids = {}
    try:
        with cf.ThreadPoolExecutor(3) as ex:
            for res in ex.map(buscar, consultas):
                for vid, vc in res:
                    ids[vid] = int(vc) if str(vc).isdigit() else 0
        mejores = sorted(ids, key=lambda v: -ids[v])[:DETALLE]
        print(f'{len(ids)} videos encontrados; leyendo datos de los {len(mejores)} más vistos...', file=sys.stderr)
        with cf.ThreadPoolExecutor(3) as ex:
            filas = [m for m in ex.map(meta, mejores) if m]
    except Bloqueado:
        pathlib.Path(__file__).with_name('.youtube_bloqueado').write_text(str(time.time()))
        sys.exit('YOUTUBE_BLOQUEADO: YouTube frenó las búsquedas desde esta conexión. Es temporal (30 a 60 minutos). '
                 'No sigas buscando: terminá el turno y avisá.')
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M')
    filas.sort(key=lambda m: (-m['vistas'], -m['vph'], -bool(m['alerta'])))
    top = [dict(id=m['id'], titulo=m['titulo'], canal=m['canal'], vistas=m['vistas'], vph=m['vph'], fecha=m.get('fecha'), idioma=m['idioma'], alerta=m['alerta'], url='https://www.youtube.com/watch?v='+m['id']) for m in filas[:60]]
    (OUT / 'radar_resultado.json').write_text(json.dumps({'actualizado': int(time.time()*1000), 'videos': top}, ensure_ascii=False, indent=1))
    print('Guardado radar_resultado.json', file=sys.stderr)
    for m in filas[:30]:
        print(f"{m['vph']:>8} v/h | {m['vistas']:>8} | {m['idioma'] or '--':5} | {m['en_vivo'] or '':12} | "
              f"{len(m['picos'])} picos | {m['canal'][:22]:22} | {m['titulo'][:70]}")

def twitch(horas=24):
    """Clips y VODs de GTA VI en Twitch. La app consulta la API oficial: las claves no están en esta compu."""
    import equipo
    datos = equipo.pedir('GET', f'/api/twitch?horas={int(horas)}', timeout=90)
    filas = [dict(v, alerta=alerta(v.get('titulo'))) for v in datos.get('videos', [])]
    filas.sort(key=lambda m: (-m['vistas'], -m['vph'], -bool(m['alerta'])))
    (OUT / 'radar_resultado.json').write_text(json.dumps({'actualizado': int(time.time()*1000), 'fuente': 'twitch', 'videos': filas[:60]}, ensure_ascii=False, indent=1))
    print(f'Guardado radar_resultado.json ({len(filas)} de Twitch en las últimas {datos.get("horas", horas)} h)', file=sys.stderr)
    for m in filas[:30]:
        print(f"{m['vph']:>8} v/h | {m['vistas']:>8} | {m['idioma'] or '--':5} | {m['tipo']:4} {m['duracion']:>6}s | {m['canal'][:22]:22} | {m['titulo'][:70]}")


def cuentas(handles):
    """Shorts más vistos de cuentas de clips: sirven de modelo (qué momento y qué título funcionan)."""
    filas = []
    for h in handles:
        h = h if h.startswith('http') else 'https://www.youtube.com/' + (h if h.startswith('@') else '@' + h)
        out = run([h.rstrip('/') + '/shorts', '--flat-playlist', '--playlist-end', '60', '--print', '%(id)s\t%(view_count)s\t%(title)s\t%(channel)s'], 180)
        for l in out.splitlines():
            p = l.split('\t')
            if len(p) >= 4 and p[1].isdigit():
                filas.append(dict(id=p[0], vistas=int(p[1]), titulo=p[2], cuenta=p[3], alerta=alerta(p[2]), url='https://www.youtube.com/shorts/' + p[0]))
    filas.sort(key=lambda f: -f['vistas'])
    pathlib.Path('cuentas_resultado.json').write_text(json.dumps({'actualizado': int(time.time() * 1000), 'shorts': filas[:60]}, ensure_ascii=False, indent=1))
    for f in filas[:25]:
        print(f"{f['vistas']:>9} | {f['cuenta'][:18]:18} | {'ALERTA ' if f['alerta'] else '       '}| {f['titulo'][:80]}")
    print('SIGUIENTE: para replicar uno, NO bajes el short. Del título sacá qué pasó y a quién; buscá el stream original (python3 procesar.py momentos sobre el video largo) y cortalo con nuestro formato.', file=sys.stderr)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'cuentas':
        cuentas(sys.argv[2:] or ['@MatiClipss'])
    elif len(sys.argv) > 1 and sys.argv[1] == 'twitch':
        twitch(int(sys.argv[sys.argv.index('--horas') + 1]) if '--horas' in sys.argv else 24)
    else:
        main()
