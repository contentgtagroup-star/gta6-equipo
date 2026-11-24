"""Recopilación de ~30 s con varios clips de la biblioteca.
Por cada clip baja de YouTube solo su momento fuerte (~7,5 s), lo arma con el formato 50/50 de procesar.py
y al final une todo con el cartel del título y un número grande por momento.
Uso: python3 recopilar.py --titulo "LA POLICÍA DE GTA 6 *NO PERDONA*" --clips c1,c2,c3,c4 --dir carpeta [--largo 30] [--subir --id auto]
Con --subir la sube a la app como clip nuevo (tipo recopilacion) y marca los clips usados con en_recop.
"""
import argparse, hashlib, json, os, subprocess, sys, zlib

H = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(H, 'procesar.py'), encoding='utf-8') as f:
    src = f.read()
src = src[:src.index('\nap = argparse.ArgumentParser()')]
P = {'__file__': os.path.join(H, 'procesar.py'), '__name__': 'procesar'}
exec(compile(src, 'procesar.py', 'exec'), P)

ap = argparse.ArgumentParser()
ap.add_argument('--titulo', required=True); ap.add_argument('--clips', required=True); ap.add_argument('--dir', required=True)
ap.add_argument('--largo', type=float, default=30.0); ap.add_argument('--estilo', default='')
ap.add_argument('--subir', action='store_true'); ap.add_argument('--id', default='')
a = ap.parse_args()
if os.environ.get('GTA6_TURNO_ID'):
    P['revisar_pausa']()
a.dir = os.path.abspath(a.dir)
os.makedirs(a.dir, exist_ok=True)
ids = [c.strip() for c in a.clips.split(',') if c.strip()]
if not ids:
    P['fail']('faltan clips para la recopilación.')
if a.subir and a.id == 'auto':
    a.id = 'rc-' + hashlib.sha256(','.join(sorted(ids)).encode()).hexdigest()[:16]
if a.subir and not a.id:
    P['fail']('falta --id para subir (usá --id auto para evitar duplicados).')
cada = a.largo / len(ids)


def eq(*args):
    r = subprocess.run([sys.executable, os.path.join(H, 'equipo.py'), *args], capture_output=True, text=True)
    if r.returncode:
        P['fail']((r.stderr or r.stdout)[-300:])
    return json.loads(r.stdout)


if a.subir:
    anterior = eq('get', 'clips', a.id)
    if anterior.get('existe'):
        if sorted((anterior.get('datos') or {}).get('momentos') or []) != sorted(ids):
            P['fail']('ese id de recopilación ya pertenece a otros clips.')
        for cid in ids:
            if (eq('get', 'clips', cid).get('datos') or {}).get('en_recop') != a.id:
                eq('update', 'clips', cid, '--json', json.dumps({'en_recop': a.id}))
        print(json.dumps({'ok': True, 'ya_existia': a.id}))
        sys.exit(0)
    reserva = eq('reservar-recop', a.id, '--clips', ','.join(ids))
    if not reserva.get('ok'):
        print(json.dumps({'ok': False, 'duplicado': True, 'id': a.id}))
        sys.exit(0)

segs = []
for i, cid in enumerate(ids):
    datos = eq('get', 'clips', cid)['datos']
    if a.subir and datos.get('en_recop') and datos['en_recop'] != a.id:
        P['fail'](f'{cid} ya está en otra recopilación.')
    R = datos['receta']
    pico = R['g0'] + 1.0                                    # el momento fuerte (el gancho arranca en g0)
    s0 = max(0.0, pico - cada * 0.4)
    s1 = min(R['dur'], s0 + cada)
    s0 = max(0.0, s1 - cada)
    s0, s1 = round(s0 * 30) / 30, round(s1 * 30) / 30
    R2 = dict(R, cortes=[], con_gancho=False, con_subs=True, con_overlay=False)
    o0, o1 = P['GANCHO_DUR'] + s0, P['GANCHO_DUR'] + s1    # sin cortes: salida = 2,5 s de gancho + segundo de la fuente
    d = os.path.join(a.dir, cid); os.makedirs(d, exist_ok=True)
    b0 = max(0.0, s0 - 1.0)
    fuente = os.path.join(d, 'pedazo_fuente.mp4')
    if not os.path.exists(fuente):
        P['run'](['yt-dlp', '--force-ipv4', '--retries', '5', '--fragment-retries', '5', '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b',
                  '--merge-output-format', 'mp4', '--download-sections', f"*{R['desde_abs'] + b0:.2f}-{R['desde_abs'] + s1 + 1.0:.2f}",
                  '--force-keyframes-at-cuts', *P['DESCARGA_RAPIDA'], '-o', fuente, '--force-overwrites', R['url']])
    seg = os.path.join(d, 'seg.mp4')
    if not os.path.exists(seg):
        P['componer'](R2, fuente, b0, o0, o1, seg, d)
    segs.append((seg, s1 - s0))
    print('momento', i + 1, cid, f'{s0:.1f}-{s1:.1f}', flush=True)

# texto final: cartel del título todo el video + número grande al arrancar cada momento
total = sum(x for _, x in segs)
estilo = a.estilo or sorted(P['ESTILOS_TITULO'])[zlib.crc32(a.titulo.encode()) % len(P['ESTILOS_TITULO'])]
E = P['ESTILOS_TITULO'][estilo]
ass = P['armar_ass']({'con_subs': False, 'con_gancho': False}, 0, total)
ev = P['titulo_eventos'](a.titulo, 0, total, estilo)
pos = 0.0
for i, (_, dur) in enumerate(segs):
    t0, t1 = P['ass_time'](pos), P['ass_time'](pos + dur)
    ev.append(f"Dialogue: 4,{t0},{t1},Titulo,,0,0,0,,{{\\an7\\pos(40,{P['MAIN_Y'] + 120})\\fs170\\1c{E['fondo']}\\3c{E['borde']}\\bord9"
              f"\\fscx140\\fscy140\\t(0,160,\\fscx100\\fscy100)}}#{i + 1}")
    pos += dur
ass_path = os.path.join(a.dir, 'recop.ass')
open(ass_path, 'w', encoding='utf-8').write(ass + '\n'.join(ev) + '\n')
lista = os.path.join(a.dir, 'lista.txt')
open(lista, 'w').write(''.join(f"file '{s}'\n" for s, _ in segs))
out = os.path.join(a.dir, 'recopilacion.mp4')
P['run'](['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista,
          '-loop', '1', '-framerate', '30', '-i', P['OVERLAY'],
          '-filter_complex', f"[0:v]subtitles='{P['fpath'](ass_path)}':fontsdir='{P['fpath'](H)}'[base];"
          f"[1:v]scale={P['W']}:{P['H']},format=rgba[marca];[base][marca]overlay=0:0:shortest=1:format=auto[v]",
          '-map', '[v]', '-map', '0:a', '-r', '30',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-af', 'loudnorm=I=-14:TP=-1.5', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', out])
P['verificar_decodifica'](out)
for k, t in enumerate((1.0, total / 2, total - 1.0)):
    P['run'](['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', out, '-frames:v', '1', '-vf', 'scale=360:-1', os.path.join(a.dir, f'm{k}.jpg')])
print(json.dumps({'ok': True, 'archivo': out, 'duracion': round(total, 1), 'estilo': estilo}, ensure_ascii=False))

if a.subir:
    import time
    yo = subprocess.run([sys.executable, os.path.join(H, 'equipo.py'), 'yo'], capture_output=True, text=True).stdout.strip()
    fuentes = [eq('get', 'clips', c)['datos'] for c in ids]
    vp = eq('subir', out)['video_path']
    limpio = a.titulo.replace('*', '')
    canales = []
    for f in fuentes:
        if f.get('canal') and f['canal'] not in canales:
            canales.append(f['canal'])
    desc = (limpio.capitalize() + f' 💀 {len(ids)} momentos que merecen replay. '
            '¿Cuál te voló más la cabeza?\n\n#gta6 #gtavi #gta6clips')
    datos = {'tipo': 'recopilacion', 'momentos': ids, 'gancho': a.titulo, 'titulo': limpio.capitalize() + ' #gta6',
             'descripcion': desc, 'motivo': f'Recopilación: {len(ids)} momentos', 'canal': ', '.join(canales),
             'url': fuentes[0].get('url'), 'idioma': 'es', 'estado': 'listo', 'responsable': yo, 'video_path': vp,
             'receta': None, 'stock': False, 'creado': int(time.time() * 1000)}
    categorias = {f.get('categoria') for f in fuentes}
    if len(categorias) == 1 and None not in categorias:
        datos['categoria'] = categorias.pop()
        datos['categoria_version'] = P['categoria_config'](datos['categoria'])['configurationVersion']
    eq('set', 'clips', a.id, '--json', json.dumps(datos, ensure_ascii=False))
    for c in ids:
        eq('update', 'clips', c, '--json', json.dumps({'en_recop': a.id}))
    print(json.dumps({'ok': True, 'subido': a.id, 'video_path': vp}))
