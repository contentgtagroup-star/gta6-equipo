#!/usr/bin/env python3
"""Equipo GTA 6 - clips verticales automáticos.

  python3 procesar.py revisar
  python3 procesar.py momentos --url URL [--cuantos 8] [--evitar "30-60,100-130"]   busca dónde el streamer se exalta (saltea lo ya usado)
  python3 procesar.py bajar  --url URL --desde 4:18 --hasta 4:50 --dir CARPETA
  python3 procesar.py render --dir CARPETA --gancho "TEXTO" [--camara x,y,w,h] [--inicio SEG --fin SEG] [--gancho-en SEG] [--foco "SEG:POS,..."]
  python3 procesar.py cortar  --dir CARPETA --receta receta.json --vertical actual.mp4 --quitar 2-3
      saca pedazos del clip sin renderizar nada
  python3 procesar.py parchar --dir CARPETA --receta receta.json --vertical actual.mp4 --tramo 0-2.5
      corrige solo ese tramo (segundos del clip final): baja solo esos segundos, rehace el pedazo y lo empalma

Armado del clip (~30 s):
  1) Gancho: 2,5 s del momento más fuerte, con el texto del gancho.
  2) Corte seco a la historia: desde unos 20 s antes hasta un poco después.
  Juego grande y abierto (personaje al centro), streamer chico arriba, y primer plano
  del streamer de 1 s en cada reacción fuerte. Subtítulos nuevos en español
  (subs_es.json) y sin los subtítulos del juego.

Solo necesita Python 3, yt-dlp y ffmpeg. faster-whisper es opcional.
"""
import argparse, glob, json, zlib, os, platform, re, shutil, statistics, subprocess, sys, tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
FUENTE = os.path.join(AQUI, 'BowlbyOne-Regular.ttf')
OVERLAY = os.path.join(AQUI, 'OVERLAY.png')
MAX_MB = 14
W, H = 1080, 1920
# Las descargas de tramos se recodifican para cortar justo (--force-keyframes-at-cuts). Con el preset por defecto
# tardaba más del doble: se usa uno rápido con calidad alta y ya a 30 cuadros por segundo, como el clip final.
DESCARGA_RAPIDA = ['--downloader-args', 'ffmpeg_o:-c:v libx264 -preset ultrafast -crf 17 -r 30']
MAIN_W, MAIN_H, MAIN_Y = 1080, 1140, 780     # juego abajo (casi cuadrado); arriba el streamer (780 px) como en los clips de referencia
TOP_H = 780
TITULO_DUR = 6.0                             # el cartel del título queda los primeros 6 s
CAM_W = 340                                  # streamer chico arriba
BIG_W = 1000                                 # streamer en primer plano (reacciones)
SUB_Y = 1370                                 # subtítulos centrados sobre el juego, como en la referencia
GANCHO_DUR = 2.5
PUNCH = 1.0                                  # segundos de primer plano por reacción
JUEGO_ARRIBA = 0.10                          # se saca el 10 % de arriba del juego (avisos y carteles)
JUEGO_ABAJO = 0.78                           # y todo lo que está debajo del 78 % (subtítulos del juego)


def fail(msg):
    print('ERROR: ' + msg)
    sys.exit(1)


def segundos(t):
    s = 0.0
    for x in str(t).strip().split(':'):
        s = s * 60 + float(x)
    return s


def mmss(t):
    t = int(max(t, 0))
    return f'{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}' if t >= 3600 else f'{t // 60}:{t % 60:02d}'


def como_instalar(prog):
    so = platform.system()
    tabla = {
        'yt-dlp': {'Darwin': 'brew install yt-dlp', 'Windows': 'winget install yt-dlp.yt-dlp', 'Linux': 'sudo pacman -S yt-dlp (o pipx install yt-dlp)'},
        'ffmpeg': {'Darwin': 'brew install ffmpeg', 'Windows': 'winget install Gyan.FFmpeg', 'Linux': 'sudo pacman -S ffmpeg'},
        'faster-whisper': {'Darwin': 'brew install python@3.12; python3 procesar.py preparar-whisper', 'Windows': 'py procesar.py preparar-whisper', 'Linux': 'python3 procesar.py preparar-whisper (requiere Python 3.12)'},
    }
    return tabla[prog].get(so, tabla[prog]['Linux'])


def revisar(imprimir=True):
    falta = [p for p in ('yt-dlp', 'ffmpeg', 'ffprobe') if not shutil.which(p)]
    falta += [n for n in ('BowlbyOne-Regular.ttf', 'OVERLAY.png') if not os.path.exists(os.path.join(AQUI, n))]
    fw = bool(python_whisper(instalar=False)) if imprimir else False
    if imprimir:
        for p in ('yt-dlp', 'ffmpeg'):
            ok = p not in falta and (p != 'ffmpeg' or 'ffprobe' not in falta)
            print(f"{'OK   ' if ok else 'FALTA'} {p}" + ('' if ok else f'  ->  instalalo con: {como_instalar(p)}'))
        print(f"{'OK   ' if fw else 'OPC. '} faster-whisper" + ('' if fw else '  (para Twitch, Kick y videos sin subtítulos: ' + como_instalar('faster-whisper') + ')'))
        print(f"{'OK   ' if os.path.exists(FUENTE) else 'FALTA'} BowlbyOne-Regular.ttf junto a este script")
        print(f"{'OK   ' if os.path.exists(OVERLAY) else 'FALTA'} OVERLAY.png junto a este script")
        # generador de PO Token: hace que YouTube bloquee mucho menos las descargas (recomendado por yt-dlp)
        pot = os.path.isdir(os.path.join(os.path.expanduser('~'), 'bgutil-ytdlp-pot-provider', 'server', 'build'))
        print(f"{'OK   ' if pot else 'OPC. '} generador de PO Token" + ('' if pot else
              '  (evita bloqueos de YouTube; ver "Preparar mi compu" en el panel)'))
    return falta


def con_cookies(cmd):
    if cmd and cmd[0] == 'yt-dlp' and os.environ.get('GTA6_COOKIES'):
        return cmd[:1] + ['--cookies-from-browser', os.environ['GTA6_COOKIES']] + cmd[1:]
    return cmd


def marcar_bloqueo():
    """Deja constancia para el motor: pausa el pedido y lo reanuda solo cuando pase el bloqueo."""
    import time
    try:
        open(os.path.join(AQUI, '.youtube_bloqueado'), 'w').write(str(time.time()))
    except OSError:
        pass


def youtube_bloqueo(r):
    """YouTube frenó esta conexión: se corta enseguida en vez de seguir probando (eso empeora el bloqueo)."""
    texto = (r.stderr or '') + (r.stdout or '')
    if 'confirm you' in texto or 'HTTP Error 429' in texto:
        marcar_bloqueo()
        fail(BLOQUEO_YOUTUBE)


def es_youtube(url):
    return bool(re.search(r'(^|[/.])(youtube\.com|youtu\.be)(/|$)', url or ''))


def ytdlp_suave(cmd):
    """yt-dlp para pasos opcionales (subtítulos, audio): si falla sigue, salvo que YouTube haya bloqueado."""
    r = subprocess.run(con_cookies(cmd), capture_output=True, text=True)
    if es_youtube(cmd[-1]):
        youtube_bloqueo(r)
    return r


def run(cmd):
    cmd = con_cookies(cmd)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and cmd[0] == 'yt-dlp' and es_youtube(cmd[-1]) and ('confirm you' in (r.stderr or '') or '429' in (r.stderr or '')):
        marcar_bloqueo()
        fail(BLOQUEO_YOUTUBE)
    if r.returncode != 0:
        fail(' '.join(cmd[:3]) + ' falló:\n' + (r.stderr or r.stdout)[-1500:])
    return r.stdout


BLOQUEO_YOUTUBE = ('YOUTUBE_BLOQUEADO: YouTube frenó las descargas desde esta conexión (pide confirmar que no sos un robot). Es temporal: '
                   'esperá 30 a 60 minutos y volvé a correr. Si sigue, se puede usar la sesión de YouTube de tu navegador '
                   'poniendo la variable GTA6_COOKIES=chrome (o firefox) antes de correr el script.')


def chequear():
    if revisar(False):
        revisar(True)
        fail('faltan programas o archivos del clipper: actualizá las herramientas y volvé a correr.')


def rms_por_paso(archivo, paso=1.0):
    """Volumen (dB) cada `paso` segundos."""
    n = int(8000 * paso)
    out = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-i', archivo, '-vn', '-af',
                          f'aresample=8000,asetnsamples={n},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
                          '-f', 'null', '-'], capture_output=True, text=True).stderr
    return [float(x) if 'inf' not in x else -90.0 for x in re.findall(r'RMS_level=(-?[\d.]+|-?inf)', out)]


# ---------------- subtítulos ----------------
def leer_json3(path):
    out = []
    for e in json.load(open(path, encoding='utf-8')).get('events', []):
        t0 = e.get('tStartMs', 0)
        for s in e.get('segs') or []:
            txt = (s.get('utf8') or '').strip()
            if txt:
                out.append(((t0 + s.get('tOffsetMs', 0)) / 1000, txt))
    return out


def bajar_subs(url, carpeta, idioma=''):
    base = os.path.join(carpeta, 'subs')
    idiomas = ['es.*', 'es', 'en.*', 'en']
    if re.fullmatch(r'[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?', idioma or '') and idioma.lower() not in ('es', 'en'):
        idiomas += [re.escape(idioma) + '.*', re.escape(idioma)]
    ytdlp_suave(['yt-dlp', '--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', ','.join(idiomas),
                 '--sub-format', 'json3', '-o', base, url])
    archivos = sorted(glob.glob(base + '*.json3'), key=lambda f: (0 if '.es' in f else 1, f))
    return archivos[0] if archivos else None


def palabras_youtube(url, carpeta, ini, fin, idioma=''):
    if not es_youtube(url):   # Twitch y Kick no tienen subtítulos automáticos: se transcribe con Whisper
        return None
    arch = bajar_subs(url, carpeta, idioma)
    if not arch:
        return None
    pal = []
    for t, w in leer_json3(arch):
        if w.startswith('[') or w.endswith(']') or '__' in w:
            continue
        if ini <= t <= fin:
            pal.append({'t': round(t - ini, 2), 'w': w})
    for f in glob.glob(os.path.join(carpeta, 'subs*.json3')):
        os.remove(f)
    for i, p in enumerate(pal):
        p['f'] = min(pal[i + 1]['t'] if i + 1 < len(pal) else round(fin - ini, 2), p['t'] + 1.2)
    return pal or None


# faster-whisper vive en su propio entorno (gta6-tools/.whisper) para no tocar el Python de cada compu.
# Se prepara de forma interactiva antes de iniciar los turnos.
WHISPER_DIR = os.path.join(AQUI, '.whisper')
# Modelos de voz: gta6-tools/.modelos (se bajan ahí una sola vez; puede ser un enlace a una carpeta que ya los tenga).
WHISPER_MODELOS = os.path.join(AQUI, '.modelos')
# El audio se decodifica con ffmpeg (no con PyAV, que falla con algunos archivos) y se usa el modelo local si ya está.
# Recibe: archivo, carpeta de modelos, tramos [[inicio, duración], ...] (duración 0 = todo) y modelo.
# Un solo proceso transcribe todos los tramos para cargar el modelo una vez.
WHISPER_SCRIPT = ('import json, subprocess, sys\n'
                  'import numpy as np\n'
                  'from faster_whisper import WhisperModel\n'
                  'arch, raiz, tramos, modelo = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4]\n'
                  'try:\n'
                  "    m = WhisperModel(modelo, compute_type='int8', download_root=raiz, local_files_only=True)\n"
                  'except Exception:\n'
                  "    m = WhisperModel(modelo, compute_type='int8', download_root=raiz)\n"
                  'out = []\n'
                  'for ini, dur in tramos:\n'
                  "    corte = ['-ss', str(ini), '-t', str(dur)] if dur else []\n"
                  "    pcm = subprocess.run(['ffmpeg', '-v', 'error', *corte, '-i', arch, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout\n"
                  '    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768\n'
                  '    segs, _ = m.transcribe(audio, word_timestamps=True, vad_filter=True)\n'
                  '    out += [[round(ini + w.start, 2), round(ini + w.end, 2), w.word.strip()] for s in segs for w in (s.words or [])]\n'
                  'print(json.dumps(out))')


def _tiene_whisper(py):
    try:
        return subprocess.run([py, '-c', 'import faster_whisper'], capture_output=True, timeout=60).returncode == 0
    except Exception:
        return False


def python_whisper(instalar=False):
    """Usa un entorno existente; solo preparar-whisper puede instalar paquetes."""
    propio = os.path.join(WHISPER_DIR, 'Scripts', 'python.exe') if platform.system() == 'Windows' else os.path.join(WHISPER_DIR, 'bin', 'python')
    partes = ('Scripts', 'python.exe') if os.name == 'nt' else ('bin', 'python')
    entornos = glob.glob(os.path.join(WHISPER_DIR, 'py*', *partes))
    for py in (os.environ.get('WHISPER_PY'), *entornos, propio, sys.executable):
        if py and os.path.exists(py) and _tiene_whisper(py):
            return py
    if not instalar:
        return None
    candidatos = [[p] for p in (os.environ.get('WHISPER_PY'), shutil.which('python3.12'), shutil.which('python3.13'), shutil.which('python3.11'), sys.executable) if p]
    if os.name == 'nt' and shutil.which('py'):
        candidatos = [['py', '-3.12'], ['py', '-3.13'], ['py', '-3.11']] + candidatos
    base = None
    for candidato in candidatos:
        try:
            r = subprocess.run([*candidato, '-c', 'import json, sys; print(json.dumps(list(sys.version_info[:2])))'], capture_output=True, text=True, timeout=15)
            version = json.loads(r.stdout) if r.returncode == 0 else []
            if version in ([3, 12], [3, 13], [3, 11]):
                base = candidato
                break
        except (OSError, ValueError, subprocess.TimeoutExpired):
            continue
    if not base:
        print('AVISO: instalá Python 3.12 y volvé a correr procesar.py preparar-whisper. No se modifica el Python del sistema.')
        return None
    carpeta = os.path.join(WHISPER_DIR, 'py' + ''.join(map(str, version)))
    propio = os.path.join(carpeta, 'Scripts', 'python.exe') if os.name == 'nt' else os.path.join(carpeta, 'bin', 'python')
    print('Preparando faster-whisper en un entorno propio con Python ' + '.'.join(map(str, version)) + '…', flush=True)
    try:
        if not os.path.exists(propio):
            subprocess.run([*base, '-m', 'venv', carpeta], check=True, capture_output=True, timeout=120)
        subprocess.run([propio, '-m', 'pip', 'install', '--only-binary=:all:', 'faster-whisper'], check=True, capture_output=True, timeout=600)
    except Exception as e:
        print(f'AVISO: no se pudo instalar faster-whisper ({e}).')
        return None
    return propio if _tiene_whisper(propio) else None


def palabras_whisper(video, tramos=None, modelo='small'):
    py = python_whisper()
    if not py:
        print('AVISO: falta preparar Whisper. Corré procesar.py preparar-whisper desde Preparar mi compu antes de reanudar el pedido.')
        return None
    r = subprocess.run([py, '-c', WHISPER_SCRIPT, video, WHISPER_MODELOS, json.dumps(tramos or [[0, 0]]), modelo], capture_output=True, text=True)
    if r.returncode != 0:
        print('AVISO: falló la transcripción con Whisper:\n' + (r.stderr or '')[-800:])
        return None
    try:
        return [{'t': t, 'f': f, 'w': w} for t, f, w in json.loads(r.stdout.strip().splitlines()[-1]) if w] or None
    except Exception:
        return None


def validar_subs_extranjeros(idioma, ruta, subs, con_subs):
    if not idioma or idioma.lower().startswith('es'):
        return
    if not os.path.exists(ruta) or not subs or any(not x.get('es') for x in subs):
        fail('el video está en otro idioma: completá subs_es.json con traducción al español antes de renderizar.')
    if not con_subs:
        fail('el video está en otro idioma: renderizá con --con-subs para mostrar la traducción.')


# ---------------- momentos ----------------
CLAVES = ['no puede ser', 'qué es eso', 'que es eso', 'dios', 'madre mía', 'madre mia', 'hostia', 'increíble', 'increible',
          'no no no', 'jaja', 'jajaja', 'corre', 'cuidado', 'wow', 'buah', 'flipa', 'brutal', 'no mames', 'wey',
          'oh my god', 'no way', 'holy', "let's go", 'lets go', 'insane', 'what the']
ETIQUETAS = ['risa', 'laugh', 'aplauso', 'applause', 'grito', 'scream', 'explos', 'ovación', 'ovacion', 'cheer']
ENOJO = re.compile(r'(?<!\w)(?:mierda|joder|coño|puta|puto|carajo|qué bronca|me cago|fuck|fucking|shit|bullshit|damn|wtf|pissed|angry|rage|caralho|porra|merda|puta que pariu|блять|сука|чёрт)(?!\w)', re.I)

# Palabras ALERTA: si el streamer (o el título) las dice, ese momento se ve SIEMPRE, pase algo loco o no.
# Sirve para clickbait: prometemos algo grande aunque la toma sea normal. (Misterio/terror/FOMO pesan más que realismo.)
ALERTAS_FUERTES = [
    'easter egg', 'huevo de pascua', 'secreto', 'secretos', 'secret', 'oculto', 'oculta', 'escondido', 'hidden', 'misterio', 'misterioso', 'mystery',
    'glitch', 'bug', 'referencia', 'reference', 'alien', 'aliens', 'extraterrestre', 'ovni', 'ufo', 'monstruo', 'monster', 'criatura', 'creature',
    'fantasma', 'fantasmas', 'ghost', 'zombie', 'zombi', 'bigfoot', 'pie grande', 'sasquatch', 'leyenda', 'legend', 'terror', 'horror', 'creepy',
    'siniestro', 'escalofriante', 'maldito', 'cursed', 'embrujado', 'haunted', 'demonio', 'demon', 'culto', 'cult', 'sacrificio', 'ritual',
    'desaparecido', 'desaparece', 'missing', 'conspiración', 'conspiracion', 'conspiracy', 'teoría', 'teoria', 'theory', 'nadie sabe',
    'nobody knows', 'nunca visto', 'never seen', 'filtrado', 'leak', 'leaked', 'exclusivo', 'sabías que', 'sabias que', 'did you know',
    'no lo vas a creer', 'qué es eso', 'que es eso', 'what is that', 'qué fue eso', 'what was that', 'extraño', 'extraño', 'raro', 'weird',
    'strange', 'paranormal', 'asesino', 'killer', 'serial', 'misión secreta', 'secret mission', 'nueva zona', 'new area', 'cripta', 'tumba']
ALERTAS_REALISMO = [
    'realista', 'realistic', 'real life', 'vida real', 'tan real', 'demasiado real', 'too real', 'increíble detalle', 'increible detalle',
    'insane detail', 'el detalle', 'físicas', 'fisicas', 'physics', 'inmersión', 'inmersion', 'immersive', 'florida', 'everglades', 'cocodrilo',
    'caimán', 'caiman', 'gator', 'alligator', 'huracán', 'huracan', 'hurricane', 'tormenta', 'storm', 'mira esto', 'look at this', 'mira eso',
    'look at that', 'espera', 'wait', 'no lo puedo creer', "can't believe", 'cant believe', 'primera vez', 'first time', 'tiene que ser mentira']


def buscar_alertas(palabras):
    """palabras = [(segundo, palabra)]. Devuelve [(segundo, frase, peso)] para cada coincidencia."""
    norm = lambda w: re.sub(r"[^\wáéíóúüñ']", '', w.lower())
    seq = []
    for t, w in palabras:
        if w.startswith('['):
            continue
        for parte in w.split():
            q = norm(parte)
            if q:
                seq.append((t, q))
    out = []
    for lista, peso in ((ALERTAS_FUERTES, 8), (ALERTAS_REALISMO, 4)):
        for k in lista:
            kw = k.split()
            n = len(kw)
            for i in range(len(seq) - n + 1):
                if all(seq[i + j][1] == kw[j] for j in range(n)):
                    out.append((seq[i][0], k, peso))
    return out


def categoria_config(id_):
    if not id_:
        return None
    with open(os.path.join(AQUI, 'categorias.json'), encoding='utf-8') as f:
        categorias = json.load(f)
    for c in categorias:
        if c['id'] == id_ and c['enabled']:
            return c
    fail('categoría inválida.')


def tramos_a_transcribir(rms, dur, cuantos=20, largo=60):
    """Ventanas de `largo` s alrededor de los picos de volumen: así no se transcribe un stream de horas entero."""
    if dur <= cuantos * largo:
        return [[0, 0]]
    salto = [rms[t] - statistics.median(rms[max(0, t - 60):t + 60]) for t in range(len(rms))]
    picos = []
    for t in sorted(range(len(salto)), key=lambda t: -salto[t]):
        if len(picos) >= cuantos:
            break
        if all(abs(t - p) >= largo for p in picos):
            picos.append(t)
    return [[max(0, t - largo // 2), largo] for t in sorted(picos)]


# Caché por video (24 h): el segundo clip de un mismo video, o un pedido que se reanuda,
# no vuelve a bajar el audio entero ni a transcribir. Se guardan datos chicos (JSON), no el audio.
CACHE = os.path.join(tempfile.gettempdir(), 'gta6_cache')
CACHE_HORAS = 24


def carpeta_cache(url):
    import hashlib, time
    os.makedirs(CACHE, exist_ok=True)
    for c in glob.glob(os.path.join(CACHE, '*')):
        try:
            if time.time() - os.path.getmtime(c) > CACHE_HORAS * 3600:
                shutil.rmtree(c, ignore_errors=True)
        except OSError:
            pass
    d = os.path.join(CACHE, hashlib.sha1(url.strip().encode()).hexdigest()[:16])
    os.makedirs(d, exist_ok=True)
    return d


def leer_cache(d, nombre):
    try:
        return json.load(open(os.path.join(d, nombre), encoding='utf-8'))
    except Exception:
        return None


def guardar_cache(d, nombre, valor):
    p = os.path.join(d, nombre)
    json.dump(valor, open(p + '.tmp', 'w', encoding='utf-8'), ensure_ascii=False)
    os.replace(p + '.tmp', p)
    return valor


def momentos(a):
    categoria = categoria_config(getattr(a, 'categoria', ''))
    chequear()
    c = carpeta_cache(a.url)
    d = tempfile.mkdtemp(prefix='gta6_mom_')
    try:
        info = leer_cache(c, 'info.json') or guardar_cache(c, 'info.json', json.loads(run(['yt-dlp', '-j', '--skip-download', a.url])))
        dur = int(info.get('duration') or 0)
        if 0 < dur < 60 and not es_youtube(a.url):
            # clip de Twitch/Kick: ya es un momento elegido por la gente, se usa entero
            print(json.dumps({'video': info.get('title'), 'canal': info.get('channel') or info.get('uploader'), 'duracion': mmss(dur),
                              'momentos': [{'desde': '0:00', 'hasta': mmss(dur), 'pico': mmss(dur / 2), 'puntaje': 0, 'alerta': False,
                                            'senales': ['clip corto: se usa entero'], 'texto': info.get('title') or ''}]}, ensure_ascii=False, indent=1))
            print('SIGUIENTE: es un clip corto, no hace falta buscar momentos: bajalo entero con bajar (--desde 0:00 --hasta la duración).')
            return
        if dur < 60:
            fail('el video es muy corto o no se pudo leer.')
        score = [0.0] * (dur + 1)
        motivos = [set() for _ in range(dur + 1)]
        texto = [[] for _ in range(dur + 1)]
        alertas = set()
        for h in info.get('heatmap') or []:
            for t in range(int(h['start_time']), min(int(h['end_time']) + 1, dur + 1)):
                score[t] += 3 * h.get('value', 0)
                if h.get('value', 0) > 0.6:
                    motivos[t].add('lo más repetido')
        sub = leer_cache(c, 'subs.json')
        if sub is None:
            arch = bajar_subs(a.url, d, info.get('language') or '') if es_youtube(a.url) else None
            sub = guardar_cache(c, 'subs.json', {'hay': bool(arch), 'todas': leer_json3(arch) if arch else []})
        arch, todas = sub['hay'], [tuple(x) for x in sub['todas']]
        au = leer_cache(c, 'audio.json')
        if au is None:
            ytdlp_suave(['yt-dlp', '-f', 'ba[abr<=80]/ba/worstaudio/worst', '-o', os.path.join(d, 'audio.%(ext)s'), a.url])
            aud = next((f for f in glob.glob(os.path.join(d, 'audio.*')) if not f.endswith(('.part', '.ytdl'))), None)
            au = {'rms': rms_por_paso(aud, 1.0) if aud else [], 'palabras': []}
            if not arch and au['rms']:   # Twitch, Kick o video sin subtítulos: se transcriben solo los picos, con el modelo rápido
                tramos = tramos_a_transcribir(au['rms'], dur)
                print(f'Transcribiendo {mmss(sum(x[1] for x in tramos) or dur)} de audio con Whisper…', flush=True)
                au['palabras'] = [[p['t'], p['w']] for p in (palabras_whisper(aud, tramos, 'base') or [])]
            if au['rms'] and (arch or au['palabras']):   # si algo falló, la próxima vez se reintenta
                guardar_cache(c, 'audio.json', au)
        else:
            print('Usando el análisis guardado de este video (no se vuelve a bajar el audio).', flush=True)
        rms = au['rms']
        if not arch:
            todas = [tuple(x) for x in au['palabras']]
        if todas:
            for t, k, peso in buscar_alertas(todas):
                if t <= dur:
                    score[int(t)] += peso; motivos[int(t)].add('ALERTA: ' + k); alertas.add(int(t))
            for t, w in todas:
                i = int(t)
                if i > dur:
                    continue
                lw = w.lower()
                if lw.startswith('['):
                    if any(e in lw for e in ETIQUETAS):
                        score[i] += 1.5; motivos[i].add(lw)
                    continue
                texto[i].append(w)
                if any(k == lw.strip('¡!¿?.,') or (' ' in k and k in lw) for k in CLAVES) or '!' in w:
                    score[i] += 0.4; motivos[i].add('reacción: ' + w)
                if ENOJO.search(w):
                    score[i] += 2.0; motivos[i].add('enojo / puteada')
        if rms:
            for t in range(min(len(rms), dur + 1)):
                base = statistics.median(rms[max(0, t - 60):t + 60])
                salto = rms[t] - base
                if salto > 5:
                    score[t] += min(salto / 2, 6); motivos[t].add('grito / pico de volumen')
    finally:
        shutil.rmtree(d, ignore_errors=True)
    if categoria:
        # Señales léxicas para ordenar candidatos; nunca verifican hechos.
        for t in range(dur + 1):
            contexto = ' '.join(sum(texto[max(0, t - 4):t + 5], [])).lower()
            if any(k in contexto for k in categoria['keywords']):
                score[t] += 3
                motivos[t].add('categoría: ' + categoria['id'])
    suave = [sum(score[max(0, t - 5):t + 5]) for t in range(dur + 1)]
    # tramos ya usados por el equipo (registro del panel): no se repiten, con 5 s de margen
    usados = []
    for c in [c for c in (a.evitar or '').split(',') if '-' in c]:
        u0, u1 = [segundos(x) for x in c.split('-')]
        usados.append((u0 - 5, u1 + 5))
    for t in alertas:   # los momentos con palabra alerta siempre entran primero
        for u in range(max(0, t - 5), min(dur, t + 5) + 1):
            suave[u] += 50
    for t in range(dur + 1):
        if any(t - 15 < u1 and t + 15 > u0 for u0, u1 in usados):
            suave[t] = 0
    elegidos = []
    for t in sorted(range(dur + 1), key=lambda t: -suave[t]):
        if suave[t] <= 0 or len(elegidos) >= a.cuantos:
            break
        if all(abs(t - e) > 75 for e in elegidos) and t > 22:
            elegidos.append(t)
    res = []
    for t in sorted(elegidos):
        ini, fin = max(0, t - 15), min(dur, t + 15)
        mot = set().union(*motivos[max(0, t - 8):t + 8])
        res.append({'desde': mmss(ini), 'hasta': mmss(fin), 'pico': mmss(t), 'puntaje': round(suave[t], 1),
                    'alerta': any(m.startswith('ALERTA') for m in mot), 'senales': sorted(mot)[:6], 'texto': ' '.join(sum(texto[ini:fin], []))[:400]})
    if categoria:
        print(json.dumps({'categoria': categoria['id'], 'verificacion': 'candidatos sin verificar', 'reglas': categoria['ideaGenerationRules'], 'visuales': categoria['visualRequirements']}, ensure_ascii=False))
    print(json.dumps({'video': info.get('title'), 'canal': info.get('channel'), 'duracion': mmss(dur), 'momentos': res}, ensure_ascii=False, indent=1))
    if categoria:
        print('Revisá solo candidatos que cumplan la categoría y su evidencia. Si no hay material suficiente, informalo sin inventar.')
        return
    print('ALERTA: los momentos con "alerta": true tienen una palabra de easter egg / secreto / misterio / terror / realismo. Mirá esos SIEMPRE, '
          'aunque la toma sea normal: se arman igual y el título promete algo grande (clickbait).')
    print('SIGUIENTE: quedate solo con los momentos donde pasa algo (por pasar, pasando o recién pasado: persecuciones, choques, '
          'tiros, sustos, risas, sorpresas). Descartá charlas, menús y escenas de historia. Cada momento trae ~15 s antes '
          'y ~15 s después del pico; si la acción sigue o empieza antes, ajustá desde/hasta (clip de unos 30 s).')


# ---------------- bajar ----------------
def bajar(a):
    chequear()
    os.makedirs(a.dir, exist_ok=True)
    ini, fin = segundos(a.desde), segundos(a.hasta)
    if fin <= ini or fin - ini > 60:
        fail('el tramo tiene que durar entre 1 y 60 segundos.')
    src = os.path.join(a.dir, 'fuente.mp4')
    run(['yt-dlp', '--force-ipv4', '--retries', '5', '--fragment-retries', '5', '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b', '--merge-output-format', 'mp4',
         '--download-sections', f'*{ini}-{fin}', '--force-keyframes-at-cuts', *DESCARGA_RAPIDA, '-o', src, '--force-overwrites', a.url])
    if not os.path.exists(src):
        fail('yt-dlp no dejó el archivo fuente.mp4.')
    pal = palabras_youtube(a.url, a.dir, ini, fin, a.idioma)
    origen = 'youtube' if pal else None
    if not pal and not es_youtube(a.url):
        print('Twitch/Kick no tiene subtítulos: se transcribe el tramo con Whisper.', flush=True)
    if not pal:
        pal = palabras_whisper(src)
        origen = 'whisper' if pal else 'ninguno'
    pal = pal or []
    frases, actual = [], []
    for i, p in enumerate(pal):
        actual.append(p)
        if i + 1 == len(pal) or pal[i + 1]['t'] - p['f'] > 0.6 or re.search(r'[.!?]$', p['w']) or len(actual) >= 10:
            frases.append({'t': actual[0]['t'], 'f': round(actual[-1]['f'], 2), 'original': ' '.join(x['w'] for x in actual)})
            actual = []
    json.dump(frases, open(os.path.join(a.dir, 'frases.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump({'url': a.url, 'desde_abs': ini, 'hasta_abs': fin, 'idioma': a.idioma}, open(os.path.join(a.dir, 'info.json'), 'w'))
    dur = fin - ini
    # reacciones: picos de volumen dentro del tramo (cada 0,25 s)
    rms = rms_por_paso(src, 0.25)
    reac = []
    if rms:
        med = statistics.median(rms)
        cand = sorted(((rms[i] - med, i * 0.25) for i in range(len(rms))), reverse=True)
        for fuerza, t in cand:
            if (fuerza > 4 or not reac) and 0.5 < t < dur - 0.5 and all(abs(t - r['t']) > 4 for r in reac):
                reac.append({'t': round(t, 2), 'fuerza': round(fuerza, 1)})
            if len(reac) >= 3 or fuerza <= 4 and reac:
                break
    json.dump(reac, open(os.path.join(a.dir, 'reacciones.json'), 'w'), indent=1)
    cd = subprocess.run(['ffmpeg', '-v', 'info', '-ss', str(dur * 0.3), '-i', src, '-t', '4', '-vf', 'cropdetect=24:2:0', '-f', 'null', '-'],
                        capture_output=True, text=True).stderr
    crops = re.findall(r'crop=(\d+:\d+:\d+:\d+)', cd)
    if crops:
        open(os.path.join(a.dir, 'juego_crop.txt'), 'w').write(crops[-1])
    momentos_ver = [0.15, 0.5, 0.85] + [r['t'] / dur for r in reac[:1]]
    for i, pos in enumerate(momentos_ver):
        run(['ffmpeg', '-v', 'error', '-y', '-ss', str(dur * pos), '-i', src, '-frames:v', '1', '-q:v', '3', os.path.join(a.dir, f'cuadro{i + 1}.jpg')])
    hoja = os.path.join(a.dir, 'hoja.jpg')
    fuente_txt = fpath(FUENTE)
    run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf',
         f"fps=1,scale=320:-2,drawtext=fontfile='{fuente_txt}':text='%{{pts\\:hms}}':x=8:y=8:fontsize=22:fontcolor=white:borderw=3,tile=6x7",
         '-frames:v', '1', '-q:v', '4', hoja])
    sz = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).strip()
    print(json.dumps({'ok': True, 'hoja': 'hoja.jpg (un cuadro por segundo con su segundo)', 'tamaño': sz, 'duracion': round(dur, 1), 'subtitulos': origen, 'frases': len(frases),
                      'reacciones_seg': [r['t'] for r in reac], 'cuadros': [f'cuadro{i + 1}.jpg' for i in range(len(momentos_ver))],
                      'texto': ' '.join(p['w'] for p in pal)[:600]}, ensure_ascii=False))
    print('ANTES DE TODO: mirá hoja.jpg (un cuadro por segundo). Elegí el pedazo LIMPIO: juego y cámara del streamer a la vista todo el tiempo. '
          'Empezá al menos 1 s después de que desaparezca cualquier cartel, aviso o menú del juego o alerta del stream, y terminá antes del siguiente. '
          'Si el streamer mueve o agranda su cámara, pasá cada posición con su tramo: --camara "0-14:x,y,w,h;14-30:x,y,w,h" (segundos de este archivo). '
          'Pasá el pedazo con --inicio y --fin. No hace falta volver a bajar nada.')
    print('SIGUIENTE: 1) escribí subs_es.json (lista de frases.json con los mismos t y f y un campo "es" en español neutro: '
          'traducí si está en otro idioma, corregí si ya es español, sacá repeticiones y lo que no se entiende). '
          '2) mirá los cuadros (el último es el pico más fuerte) y medí la cámara del streamer (x,y,ancho,alto). '
          '3) corré render. El gancho sale solo del pico más fuerte; si otro segundo es más impactante, pasalo con --gancho-en.')
    if origen == 'ninguno':
        print('AVISO: no hay subtítulos y no se pudo transcribir con Whisper (mirá el aviso de arriba): elegí otro video o renderizá sin subtítulos.')


# ---------------- render ----------------
def ass_time(t):
    t = max(t, 0)
    return f'{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}'


def esc(t):
    return t.replace('\\', '').replace('{', '(').replace('}', ')').replace('\n', ' ')


def pedazos(subs, campo):
    out = []
    for fr in subs:
        pal = (fr.get(campo) or '').split()
        if not pal:
            continue
        # palabra por palabra: cada una dura según su largo
        t0 = float(fr['t'])
        t1 = max(float(fr['f']), t0 + 0.22 * len(pal))
        pesos = [len(w) + 2 for w in pal]
        tot, acum = sum(pesos), t0
        for w, pw in zip(pal, pesos):
            d = (t1 - t0) * pw / tot
            out.append((acum, acum + d, w))
            acum += d
    return out


def linea_tiempo(R):
    """Lista de (desde, hasta) en segundos de la fuente, en el orden del clip final: gancho, historia y sin los cortes."""
    segs = [(R['g0'], R['g0'] + GANCHO_DUR), (0.0, R['dur'])]
    for c0, c1 in R.get('cortes') or []:          # cortes en segundos del clip sin cortes
        nuevos, pos = [], 0.0
        for a_, b_ in segs:
            largo = b_ - a_
            q0, q1 = max(c0 - pos, 0), min(c1 - pos, largo)
            if q1 <= q0:
                nuevos.append((a_, b_))
            else:
                if q0 > 0.01:
                    nuevos.append((a_, a_ + q0))
                if largo - q1 > 0.01:
                    nuevos.append((a_ + q1, b_))
            pos += largo
        segs = nuevos
    return segs


def total_clip(R):
    return sum(b_ - a_ for a_, b_ in linea_tiempo(R))


def lineas_salida(R):
    """Subtítulos en tiempo del clip final."""
    out, pos = [], 0.0
    trozos = pedazos(R['subs'], R['campo'])
    for a_, b_ in linea_tiempo(R):
        out += [(max(t0, a_) - a_ + pos, min(t1, b_) - a_ + pos, txt) for t0, t1, txt in trozos if t1 > a_ and t0 < b_]
        pos += b_ - a_
    return out


# ---------------- título (cartel blanco redondeado, texto negro, palabras *clave* en rojo) ----------------
_METRICAS = {}
def _metricas():
    """Anchos de letra del TTF (sin librerías): sirve para medir el texto y dibujar el cartel justo."""
    if _METRICAS:
        return _METRICAS
    import struct
    d = open(FUENTE, 'rb').read()
    n = struct.unpack('>H', d[4:6])[0]
    tab = {d[12 + 16 * i:16 + 16 * i].decode('latin1'): struct.unpack('>II', d[20 + 16 * i:28 + 16 * i]) for i in range(n)}
    upem = struct.unpack('>H', d[tab['head'][0] + 18:tab['head'][0] + 20])[0]
    nh = struct.unpack('>H', d[tab['hhea'][0] + 34:tab['hhea'][0] + 36])[0]
    hm = tab['hmtx'][0]
    adv = [struct.unpack('>H', d[hm + 4 * i:hm + 4 * i + 2])[0] for i in range(nh)]
    co = tab['cmap'][0]
    cmap = {}
    for k in range(struct.unpack('>H', d[co + 2:co + 4])[0]):
        pid, eid, off = struct.unpack('>HHI', d[co + 4 + 8 * k:co + 12 + 8 * k])
        o = co + off
        if struct.unpack('>H', d[o:o + 2])[0] == 4 and pid in (0, 3):
            sc = struct.unpack('>H', d[o + 6:o + 8])[0] // 2
            fin = struct.unpack('>%dH' % sc, d[o + 14:o + 14 + 2 * sc])
            ini = struct.unpack('>%dH' % sc, d[o + 16 + 2 * sc:o + 16 + 4 * sc])
            dl = struct.unpack('>%dh' % sc, d[o + 16 + 4 * sc:o + 16 + 6 * sc])
            ro_pos = o + 16 + 6 * sc
            ro = struct.unpack('>%dH' % sc, d[ro_pos:ro_pos + 2 * sc])
            for j in range(sc):
                for c in range(ini[j], fin[j] + 1):
                    if c == 0xFFFF:
                        continue
                    if ro[j] == 0:
                        g = (c + dl[j]) & 0xFFFF
                    else:
                        p_ = ro_pos + 2 * j + ro[j] + 2 * (c - ini[j])
                        g = struct.unpack('>H', d[p_:p_ + 2])[0]
                        g = (g + dl[j]) & 0xFFFF if g else 0
                    cmap[c] = g
            break
    _METRICAS.update(upem=upem, adv=adv, cmap=cmap)
    return _METRICAS


def ancho_texto(t, size):
    try:
        m = _metricas()
        tot = sum(m['adv'][min(m['cmap'].get(ord(c), 0), len(m['adv']) - 1)] for c in t)
        return tot * size / m['upem']
    except Exception:
        return len(t) * size * 0.62   # si no se pudo leer la fuente, medida aproximada


# colores del cartel (ASS usa BGR). A = rosa neón con borde violeta; B = violeta oscuro con borde rosa
ESTILOS_TITULO = {
    'A': dict(fondo='&HA34FFF&', borde='&H3D0B2A&', texto='&HFFFFFF&', clave='&H3CC9FF&', borde_texto='&H3D0B2A&'),
    'B': dict(fondo='&H3D0B2A&', borde='&HA34FFF&', texto='&HFFFFFF&', clave='&HA34FFF&', borde_texto='&H000000&'),
    'C': dict(fondo='&H3D8AFF&', borde='&H3D0B2A&', texto='&HFFFFFF&', clave='&H3D0B2A&', borde_texto='&H3D0B2A&'),     # atardecer naranja
    'D': dict(fondo='&H3D1F0B&', borde='&HE0F033&', texto='&HFFFFFF&', clave='&HE0F033&', borde_texto='&H000000&'),     # noche azul con cian neón
    'E': dict(fondo='&H3CC9FF&', borde='&H3D0B2A&', texto='&H3D0B2A&', clave='&H8A2DFF&', borde_texto='&H3CC9FF&'),     # amarillo sol con violeta
}
ESTILO_TITULO = 'A'


def titulo_eventos(texto, t0, t1, estilo=None):
    """Cartel: máx. 2 líneas, centrado en la unión streamer/juego. *palabra* = rojo."""
    toks = []
    for i, parte in enumerate(re.sub(r'GTA\s+(\d)', 'GTA\u00a0\\1', texto.upper()).split('*')):   # 'GTA 6' nunca se separa
        toks += [(w, i % 2 == 1) for w in parte.split(' ') if w.strip()]   # split(' '): split() también corta en el espacio duro
    if not toks:
        return []
    size, maxw = 108, 960
    while True:
        mejor = None
        for k in range(1, len(toks) + 1):   # k = palabras en la primera línea (k = len → una sola línea)
            lineas = [toks[:k]] + ([toks[k:]] if k < len(toks) else [])
            ws = [ancho_texto(' '.join(w for w, _ in l), size) for l in lineas]
            if mejor is None or max(ws) < mejor[0]:
                mejor = (max(ws), lineas)
        if mejor[0] <= maxw or size <= 40:
            break
        size -= 4
    mw, lineas = mejor
    lh = size * 0.84
    bw, bh, r = int(mw + 76), int(len(lineas) * lh + 44), 30
    E = ESTILOS_TITULO[estilo or ESTILO_TITULO]
    cx, cy = W // 2, MAIN_Y + 35
    x0, y0 = cx - bw // 2, int(cy - bh / 2)
    dib = (f"m {r} 0 l {bw - r} 0 b {bw} 0 {bw} 0 {bw} {r} l {bw} {bh - r} b {bw} {bh} {bw} {bh} {bw - r} {bh} "
           f"l {r} {bh} b 0 {bh} 0 {bh} 0 {bh - r} l 0 {r} b 0 0 0 0 {r} 0")
    a, b = ass_time(0), ass_time(t1 - t0)
    ev = [f"Dialogue: 2,{a},{b},Titulo,,0,0,0,,{{\\an7\\pos({x0},{y0})\\1c{E['fondo']}\\3c{E['borde']}\\1a&H55&\\3a&H55&\\bord7\\shad0\\fad(90,0)\\p1}}{dib}"]
    for j, l in enumerate(lineas):
        ty = int(y0 + 22 + lh * (j + 0.5))
        txt = ' '.join(('{\\1c' + (E['clave'] if rojo else E['texto']) + '\\3c' + E['borde_texto'] + '\\bord4}') + esc(w) for w, rojo in l)
        ev.append(f"Dialogue: 3,{a},{b},Titulo,,0,0,0,,{{\\an5\\pos({cx},{ty})\\fs{size}\\fad(90,0)}}{txt}")
    return ev


def armar_ass(R, out_t0, out_t1):
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Bowlby One,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,1,0,0,100,100,0,0,1,7,3,5,190,190,0,1
Style: Titulo,Bowlby One,70,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Gancho,Bowlby One,128,&H00A34FFF,&H00A34FFF,&H003D0B2A,&H003D8AFF,0,0,0,0,100,100,0,0,1,9,7,8,150,190,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    palabras = []
    for a_, b_, t in sorted(lineas_salida(R) if R.get('con_subs') else [], key=lambda p: (p[0], -p[1])):
        if palabras and a_ < palabras[-1][1]:
            if a_ - palabras[-1][0] < 0.08:
                continue
            palabras[-1] = (palabras[-1][0], a_, palabras[-1][2])
        if b_ - a_ >= 0.08:
            palabras.append((a_, b_, t))
    for a_, b_, t in palabras:
        a2, b2 = max(a_, out_t0), min(b_, out_t1)
        if b2 > a2:
            ev.append(f"Dialogue: 1,{ass_time(a2 - out_t0)},{ass_time(b2 - out_t0)},Sub,,0,0,0,,{{\\pos({W // 2},{SUB_Y})\\fscx118\\fscy118\\t(0,90,\\fscx100\\fscy100)}}{esc(t).upper()}")
    if R.get('con_gancho') and R.get('gancho') and out_t0 < TITULO_DUR:
        ev += titulo_eventos(R['gancho'], out_t0, min(TITULO_DUR, out_t1), R.get('estilo_titulo'))
    return head + '\n'.join(ev) + '\n'


def fpath(p):
    return p.replace('\\', '/').replace(':', '\\:')


def receta_nueva(a, src):
    """Calcula todos los ajustes del clip una sola vez y los guarda (sirven para corregir partes sin rehacer todo)."""
    categoria = categoria_config(getattr(a, 'categoria', '') or os.environ.get('GTA6_CATEGORIA', ''))
    sw, sh = [int(x) for x in run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]).strip().split(',')[:2]]
    dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).strip())
    jx, jy, jw, jh = 0, 0, sw, sh
    jc = os.path.join(a.dir, 'juego_crop.txt')
    if os.path.exists(jc):
        jw, jh, jx, jy = [int(v) for v in open(jc).read().strip().split(':')]
    ini = max(0.0, a.inicio or 0.0)
    fin = min(dur, a.fin) if a.fin else dur
    if fin - ini < 8:
        fail('el pedazo elegido con --inicio/--fin es muy corto (mínimo 8 s).')
    dur = fin - ini
    reac = json.load(open(os.path.join(a.dir, 'reacciones.json'))) if os.path.exists(os.path.join(a.dir, 'reacciones.json')) else []
    reac = [{'t': round(r['t'] - ini, 2), 'fuerza': r['fuerza']} for r in reac if ini + 0.5 < r['t'] < fin - 0.5]
    pico = (a.gancho_en - ini) if a.gancho_en is not None else (max(reac, key=lambda r: r['fuerza'])['t'] if reac else dur * 0.7)
    cortes = [[float(x) for x in c.split('-')] for c in (a.quitar or '').split(',') if '-' in c]
    pes = os.path.join(a.dir, 'subs_es.json')
    if os.path.exists(pes):
        subs, campo = json.load(open(pes, encoding='utf-8')), 'es'
    elif os.path.exists(os.path.join(a.dir, 'frases.json')):
        subs, campo = json.load(open(os.path.join(a.dir, 'frases.json'), encoding='utf-8')), 'original'
    else:
        subs, campo = [], 'es'
    subs = [dict(x, t=round(float(x['t']) - ini, 2), f=round(float(x['f']) - ini, 2)) for x in subs if float(x['f']) > ini and float(x['t']) < fin]
    if a.con_subs and not any((x.get(campo) or '').strip() for x in subs):
        fail('no hay frases para subtitular: elegí otro video o generá una transcripción antes de renderizar.')
    camaras = []
    for parte in [p for p in (a.camara or '').split(';') if p.strip()]:
        if ':' in parte:
            rango, box = parte.split(':', 1)
            t0, t1 = [float(x) for x in rango.split('-')]
        else:
            t0, t1, box = ini, fin, parte
        box = [int(v) for v in box.split(',')]
        t0, t1 = max(t0, ini), min(t1, fin)
        if t1 - t0 < 0.5:
            continue
        vis = [[round(v0 + t0 - ini, 2), round(v1 + t0 - ini, 2)] for v0, v1 in camara_visible(src, box, t0, t1 - t0)]
        unidos = []
        for v in vis:   # huecos de menos de 1 s se cuentan como visibles
            if unidos and v[0] - unidos[-1][1] < 1.0:
                unidos[-1][1] = v[1]
            else:
                unidos.append(v)
        camaras.append({'t0': round(t0 - ini, 2), 't1': round(t1 - ini, 2), 'box': box, 'visible': unidos})
    congelar = []   # si el streamer saca su cámara del stream, el clip tampoco la muestra (decisión del equipo)
    # volumen fijo (así un pedazo corregido suena igual que el resto)
    ln = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-i', src, '-vn', '-af', 'loudnorm=I=-14:print_format=json', '-f', 'null', '-'],
                        capture_output=True, text=True).stderr
    m = re.search(r'"input_i"\s*:\s*"(-?[\d.]+)"', ln)
    ganancia = max(-20.0, min(20.0, -14 - float(m.group(1)))) if m else 0.0
    info = json.load(open(os.path.join(a.dir, 'info.json'))) if os.path.exists(os.path.join(a.dir, 'info.json')) else {}
    validar_subs_extranjeros(info.get('idioma'), pes, subs, a.con_subs)
    total = GANCHO_DUR + dur
    desde_abs = (info['desde_abs'] + ini) if info.get('desde_abs') is not None else None
    return {**({'categoria': categoria['id'], 'categoria_version': categoria['configurationVersion']} if categoria else {}), 'v': 3, 'url': info.get('url'), 'desde_abs': desde_abs, 'ini_archivo': round(ini, 3), 'dur': round(dur, 3),
            'juego': [jx, jy, jw, jh], 'camaras': camaras, 'congelar': congelar,
            'foco': a.foco or '', 'reacciones': reac, 'g0': round(max(0.0, min(pico - 1.0, dur - GANCHO_DUR)), 2),
            'gancho': a.gancho, 'con_gancho': not a.sin_gancho, 'estilo_titulo': a.estilo_titulo or sorted(ESTILOS_TITULO)[zlib.crc32((os.path.basename(os.path.abspath(a.dir)) + (a.gancho or '')).encode()) % len(ESTILOS_TITULO)], 'con_subs': a.con_subs, 'cortes': cortes, 'subs': subs, 'campo': campo, 'ganancia_db': round(ganancia, 2),
            'vk': int(max(1200, min(6000, MAX_MB * 8 * 1024 * 0.92 / total - 128)))}


def filtro_imagen(R, corrimiento):
    """Juego grande + streamer chico arriba (con borde) + en reacciones: streamer casi a pantalla completa y fondo desenfocado.
    `corrimiento` = segundo del clip en que empieza el archivo fuente."""
    jx, jy, jw, jh = R['juego']
    gy = jy + int(jh * JUEGO_ARRIBA) // 2 * 2
    gh = int(jh * (JUEGO_ABAJO - JUEGO_ARRIBA)) // 2 * 2
    cw = min(jw, int(gh * MAIN_W / MAIN_H)) // 2 * 2
    camaras = R.get('camaras') or []
    x_centro = jx + (jw - cw) // 2
    if camaras:   # correr la vista para que no entre el recuadro del streamer (según su posición más larga)
        cx, cy, cwid, chei = max(camaras, key=lambda c: c['t1'] - c['t0'])['box']
        if cy < gy + gh and cy + chei > gy and cx < x_centro + cw and cx + cwid > x_centro:
            x_centro = max(jx, cx - cw) if cx + cwid / 2 > jx + jw / 2 else min(jx + jw - cw, cx + cwid)
    margen = (jw - cw) // 2
    T = f'(t+{corrimiento:.3f})'
    x_expr = str(x_centro)
    focos = []
    for par in [p for p in (R.get('foco') or '').split(',') if ':' in p]:
        t, pos = par.split(':')
        focos.append((float(t), max(-1.0, min(1.0, float(pos)))))
    for t, pos in sorted(focos, reverse=True):
        xp = int(min(jx + jw - cw, max(jx, jx + margen + pos * margen)))
        x_expr = f'if(gte({T}\\,{t})\\,{xp}\\,{x_expr})'
    grande = lambda c: c['box'][2] > jw * 0.33     # el streamer agrandó su cámara dentro del stream
    for c in camaras:
        if grande(c):
            bx = c['box'][0] + c['box'][2] / 2
            xg = int(min(jx + jw - cw, max(jx, bx - cw / 2)))
            for v0, v1 in c['visible']:
                x_expr = f'if(between({T}\\,{v0:.2f}\\,{v1:.2f})\\,{xg}\\,{x_expr})'
    n = len(camaras)
    f = (f"[0:v]fps=30,split={2 + n}[bgs][gs]" + ''.join(f'[cs{i}]' for i in range(n)) + ';'
         f"[bgs]crop={jw}:{gh}:{jx}:{gy},scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},boxblur=7:2,eq=brightness=-0.22,scale={W}:{H}[bg];"
         f"[gs]crop={cw}:{gh}:'{x_expr}':{gy},scale={MAIN_W}:{MAIN_H},setsar=1[main];"
         f"[bg][main]overlay=0:{MAIN_Y}[v1]")
    if not n:
        return f, 'v1'
    # streamer arriba a pantalla ancha (mitad superior), sin primer plano ni recuadro
    ult = 'v1'
    for i, c in enumerate(camaras):
        cx, cy, cwid, chei = c['box']
        vis = ('+'.join(f'between({T},{v0:.2f},{v1:.2f})' for v0, v1 in c['visible']) or '0') if not grande(c) else '0'
        f += (f";[cs{i}]crop={cwid}:{chei}:{cx}:{cy},scale={W}:{TOP_H}:force_original_aspect_ratio=increase,crop={W}:{TOP_H},setsar=1[s{i}]"
              f";[{ult}][s{i}]overlay=0:0:enable='{vis}'[o{i}]")
        ult = f'o{i}'
    for k, z in enumerate(R.get('congelar') or []):
        cx, cy, cwid, chei = camaras[z['cam']]['box']
        hs = int(CAM_W * chei / cwid) // 2 * 2
        f += (f";[{k + 1}:v]scale={CAM_W}:{hs},setsar=1,pad={CAM_W + 8}:{hs + 8}:4:4:color={rosa},format=yuv420p[z{k}]"
              f";[{ult}][z{k}]overlay=({W}-{CAM_W + 8})/2:{MAIN_Y - hs - 32}:shortest=1:enable='between({T},{z['t0']:.2f},{z['t1']:.2f})*not({en_all})'[q{k}]")
        ult = f'q{k}'
    return f, ult


def partes_de_salida(R, o0, o1):
    """Qué segundos de la fuente forman el tramo [o0, o1] del clip final."""
    partes, pos = [], 0.0
    for a_, b_ in linea_tiempo(R):
        largo = b_ - a_
        q0, q1 = max(o0 - pos, 0), min(o1 - pos, largo)
        if q1 - q0 > 0.01:
            partes.append((a_ + q0, a_ + q1))
        pos += largo
    return partes


def componer(R, fuente, corrimiento, o0, o1, salida, carpeta):
    """Renderiza solo el tramo [o0, o1] del clip final a partir de un archivo fuente que empieza en el segundo `corrimiento`."""
    partes = partes_de_salida(R, o0, o1)
    extra = []
    for k, z in enumerate(R.get('congelar') or []):
        cx, cy, cwid, chei = R['camaras'][z['cam']]['box']
        png = os.path.join(carpeta, f'cam_quieta_{k}.png')
        t_arch = max(0.0, z['cuadro'] - corrimiento)
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t_arch:.2f}', '-i', fuente, '-frames:v', '1', '-vf', f'crop={cwid}:{chei}:{cx}:{cy}', png])
        if not os.path.exists(png):
            fail('no se pudo sacar el cuadro de la cámara para un hueco.')
        extra += ['-loop', '1', '-i', png]
    f, ult = filtro_imagen(R, corrimiento)
    n = len(partes)
    # todo a 30 cuadros por segundo y cortes por cuadro exacto, así los empalmes caen justo en los puntos de corte
    f += (f";[{ult}]setpts=PTS-STARTPTS,fps=30,split={n}" + ''.join(f'[vs{i}]' for i in range(n))
          + f";[0:a]asetpts=PTS-STARTPTS,aresample=48000,asplit={n}" + ''.join(f'[as{i}]' for i in range(n)))
    for i, (s0, s1) in enumerate(partes):
        c0 = round((s0 - corrimiento) * 30)
        c1 = c0 + round((s1 - s0) * 30)
        f += (f";[vs{i}]trim=start_frame={c0}:end_frame={c1},setpts=PTS-STARTPTS[pv{i}]"
              f";[as{i}]atrim=start={c0 / 30:.4f}:end={c1 / 30:.4f},asetpts=PTS-STARTPTS[pa{i}]")
    f += ';' + ''.join(f'[pv{i}][pa{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=1[cv][ca]'
    ass = os.path.join(carpeta, 'subs.ass')
    open(ass, 'w', encoding='utf-8').write(armar_ass(R, o0, o1))
    f += f";[cv]subtitles='{fpath(ass)}':fontsdir='{fpath(AQUI)}'[base];[ca]volume={R['ganancia_db']}dB,alimiter=limit=0.89[a]"
    if R.get('con_overlay', True):
        if not os.path.exists(OVERLAY):
            fail('falta OVERLAY.png junto a procesar.py.')
        f += f";[{1 + len(R.get('congelar') or [])}:v]scale={W}:{H},format=rgba[marca];[base][marca]overlay=0:0:eof_action=repeat:format=auto[v]"
        extra += ['-i', OVERLAY]
    else:
        f += ';[base]null[v]'
    vk = R['vk']
    run(['ffmpeg', '-v', 'error', '-y', '-i', fuente, *extra, '-filter_complex_threads', str(os.cpu_count() or 2), '-filter_complex', f, '-map', '[v]', '-map', '[a]', '-r', '30',
         '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'high', '-b:v', f'{vk}k', '-maxrate', f'{vk}k', '-bufsize', f'{vk * 2}k',
         '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', salida])


def cuadros(video):
    return int(run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', video]).strip() or 0)


def verificar_decodifica(video):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-f', 'null', '-'], capture_output=True, text=True)
    if r.stderr.strip():
        fail('el video final tiene errores al reproducirse:\n' + r.stderr[-800:])


def camara_visible(src, cam, ini, dur):
    """Tramos (en segundos del clip) donde la cámara del streamer está en pantalla."""
    cx, cy, cw_, ch_ = cam
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(ini, 0):.2f}', '-t', f'{dur:.2f}', '-i', src, '-vf',
                          f'crop={cw_}:{ch_}:{cx}:{cy},fps=4,scale=16:9,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    n = 144
    frames = [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]
    if len(frames) < 4:
        return [[0.0, dur]]
    ref = bytes(sorted(f[k] for f in frames)[len(frames) // 2] for k in range(n))
    difs = [sum(abs(f[k] - ref[k]) for k in range(n)) / n for f in frames]
    umbral = statistics.median(difs) * 2 + 12
    tramos, dentro = [], None
    for i, d_ in enumerate(difs + [999]):
        t = i / 4
        if d_ <= umbral and dentro is None:
            dentro = t
        elif d_ > umbral and dentro is not None:
            if t - dentro >= 0.5:
                tramos.append([round(dentro, 2), round(min(t, dur), 2)])
            dentro = None
    return tramos


def muestras(carpeta, video, tiempos):
    for i, t in enumerate(tiempos):
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', video, '-frames:v', '1', '-q:v', '4', os.path.join(carpeta, f'muestra{i + 1}.jpg')])


def render(a):
    chequear()
    src = os.path.join(a.dir, 'fuente.mp4')
    if not os.path.exists(src):
        fail('no está fuente.mp4: corré primero bajar.')
    if not os.path.exists(FUENTE):
        fail('falta BowlbyOne-Regular.ttf junto a procesar.py.')
    R = receta_nueva(a, src)
    total = total_clip(R)
    out = os.path.join(a.dir, 'vertical.mp4')
    componer(R, src, -R['ini_archivo'], 0.0, total, out, a.dir)
    esperados = sum(round((p1 - p0) * 30) for p0, p1 in partes_de_salida(R, 0.0, total))
    hechos = cuadros(out)
    if abs(hechos - esperados) > 1:
        fail(f'el clip salió con {hechos} cuadros y tenían que ser {esperados}: no lo subas, avisale a Cuervo.')
    verificar_decodifica(out)
    json.dump(R, open(os.path.join(a.dir, 'receta.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    mb = os.path.getsize(out) / 1048576
    pico = R['g0'] + 1.0
    muestras(a.dir, out, (1.0, GANCHO_DUR + 3, min(total - 0.2, GANCHO_DUR + pico)))
    print(json.dumps({'ok': True, 'archivo': out, 'receta': 'receta.json', 'mb': round(mb, 1), 'duracion': round(total, 1),
                      'subtitulos': 'español' if R['campo'] == 'es' else 'original',
                      'muestras': ['muestra1.jpg (gancho)', 'muestra2.jpg (historia)', 'muestra3.jpg (pico)']}, ensure_ascii=False))
    print('Guardá receta.json en el clip del panel (campo "receta"): sirve para corregir partes sin rehacer todo.')
    if mb > MAX_MB:
        print(f'AVISO: pesa {mb:.1f} MB, más que el límite de {MAX_MB} MB del panel.')


def parchar(a):
    """Corrige solo un tramo: baja de YouTube solo esos segundos, renderiza ese pedazo y lo empalma sin tocar el resto."""
    chequear()
    os.makedirs(a.dir, exist_ok=True)
    R = json.load(open(a.receta, encoding='utf-8'))
    if not R.get('url') or R.get('desde_abs') is None:
        fail('la receta no tiene url/desde: hay que rehacer el clip completo con bajar y render.')
    total = total_clip(R)
    o0, o1 = [float(x) for x in a.tramo.split('-')]
    o0 = max(0.0, int(o0 * 2) / 2)                    # a medio segundo (puntos de corte del clip)
    o1 = min(total, -(-o1 * 2 // 1) / 2)
    if o1 >= total - 0.05:
        o1 = total
    partes = partes_de_salida(R, o0, o1)
    s_ini = max(0.0, min(p[0] for p in partes) - 1.0)
    for z in R.get('congelar') or []:   # si el tramo toca un hueco, bajar también el cuadro que se congela
        if any(p0 < z['t1'] and p1 > z['t0'] for p0, p1 in partes):
            s_ini = max(0.0, min(s_ini, z['cuadro'] - 0.5))
    s_fin = min(R['dur'], max(p[1] for p in partes) + 1.0)
    ab0, ab1 = R['desde_abs'] + s_ini, R['desde_abs'] + s_fin
    pedazo_src = os.path.join(a.dir, 'pedazo_fuente.mp4')
    run(['yt-dlp', '--force-ipv4', '--retries', '5', '--fragment-retries', '5', '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b',
         '--merge-output-format', 'mp4', '--download-sections', f'*{ab0:.2f}-{ab1:.2f}', '--force-keyframes-at-cuts', *DESCARGA_RAPIDA,
         '-o', pedazo_src, '--force-overwrites', R['url']])
    pedazo = os.path.join(a.dir, 'pedazo.mp4')
    componer(R, pedazo_src, s_ini, o0, o1, pedazo, a.dir)
    lista, trozos = os.path.join(a.dir, 'lista.txt'), []
    if o0 > 0:
        cab = os.path.join(a.dir, 'cabeza.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-i', a.vertical, '-t', f'{o0:.3f}', '-c', 'copy', '-avoid_negative_ts', 'make_zero', cab]); trozos.append(cab)
    trozos.append(pedazo)
    if o1 < total:
        col = os.path.join(a.dir, 'cola.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{o1 + 0.01:.3f}', '-i', a.vertical, '-c', 'copy', '-avoid_negative_ts', 'make_zero', col]); trozos.append(col)
    open(lista, 'w').write(''.join(f"file '{os.path.abspath(t).replace(chr(92), '/')}'\n" for t in trozos))
    out = os.path.join(a.dir, 'vertical.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', out])
    # si se rehízo el clip entero (por ejemplo para sumarle el gancho), la duración puede cambiar: se compara con la esperada
    completo = o0 <= 0 and o1 >= total
    antes = sum(round((p1 - p0) * 30) for p0, p1 in partes_de_salida(R, 0.0, total)) if completo else cuadros(a.vertical)
    despues = cuadros(out)
    for t in trozos + [pedazo_src, lista]:
        if os.path.exists(t):
            os.remove(t)
    if abs(antes - despues) > 1:
        os.remove(out)
        fail(f'el empalme salió mal ({despues} cuadros en vez de {antes}). No se tocó el clip original: avisale a Cuervo.')
    verificar_decodifica(out)
    muestras(a.dir, out, (min(o0 + 0.3, total - 0.2), min((o0 + o1) / 2, total - 0.2)))
    dur_final = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).strip())
    print(json.dumps({'ok': True, 'archivo': out, 'tramo_rehecho': f'{o0}-{o1}', 'segundos_bajados': round(s_fin - s_ini, 1),
                      'duracion': round(dur_final, 1), 'muestras': ['muestra1.jpg', 'muestra2.jpg']}, ensure_ascii=False))


def final_a_original(R, t):
    """Segundo del clip actual (con cortes) -> segundo del clip sin cortes."""
    base = GANCHO_DUR + R['dur']
    quedan, pos = [], 0.0
    for c0, c1 in sorted(R.get('cortes') or []):
        if c0 > pos:
            quedan.append((pos, c0))
        pos = max(pos, c1)
    if pos < base:
        quedan.append((pos, base))
    acum = 0.0
    for q0, q1 in quedan:
        if t <= acum + (q1 - q0) + 1e-6:
            return q0 + (t - acum)
        acum += q1 - q0
    return base


def cortar(a):
    """Saca pedazos del clip SIN renderizar: copia lo que queda y lo une en los puntos de corte."""
    chequear()
    os.makedirs(a.dir, exist_ok=True)
    R = json.load(open(a.receta, encoding='utf-8'))
    total = total_clip(R)
    pedidos = []
    for c in [c for c in a.quitar.split(',') if '-' in c]:
        c0, c1 = [float(x) for x in c.split('-')]
        c0, c1 = int(c0 * 2) / 2, min(total, -(-c1 * 2 // 1) / 2)
        if c1 - c0 >= 0.5:
            pedidos.append((c0, c1))
    if not pedidos:
        fail('no hay nada para cortar (usá --quitar "2-3,10.5-12").')
    pedidos.sort()
    quedan, pos = [], 0.0
    for c0, c1 in pedidos:
        if c0 > pos:
            quedan.append((pos, c0))
        pos = max(pos, c1)
    if total - pos > 0.05:
        quedan.append((pos, total))
    trozos = []
    for k, (q0, q1) in enumerate(quedan):
        t = os.path.join(a.dir, f'parte{k}.mp4')
        cmd = ['ffmpeg', '-v', 'error', '-y']
        if q0 > 0:
            cmd += ['-ss', f'{q0 + 0.01:.3f}']
        cmd += ['-i', a.vertical, '-t', f'{q1 - q0:.3f}', '-c', 'copy', '-avoid_negative_ts', 'make_zero', t]
        run(cmd); trozos.append(t)
    lista = os.path.join(a.dir, 'lista.txt')
    open(lista, 'w').write(''.join(f"file '{os.path.abspath(t).replace(chr(92), '/')}'\n" for t in trozos))
    out = os.path.join(a.dir, 'vertical.mp4')
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', out])
    antes, despues = cuadros(a.vertical), cuadros(out)
    quitado = sum(c1 - c0 for c0, c1 in pedidos)
    for t in trozos + [lista]:
        os.remove(t)
    if abs(despues - (antes - round(quitado * 30))) > 2:
        os.remove(out)
        fail(f'el corte salió mal ({despues} cuadros, se esperaban {antes - round(quitado * 30)}). No se tocó el clip.')
    verificar_decodifica(out)
    nuevos = [[round(final_a_original(R, c0), 3), round(final_a_original(R, c1), 3)] for c0, c1 in pedidos]
    R['cortes'] = sorted((R.get('cortes') or []) + nuevos)
    json.dump(R, open(a.receta, 'w', encoding='utf-8'), ensure_ascii=False)
    print(json.dumps({'ok': True, 'archivo': out, 'quitado_seg': quitado, 'duracion': round(despues / 30, 1),
                      'receta': 'actualizada con los cortes (guardala en el clip del panel)'}, ensure_ascii=False))


def revisar_pausa():
    pedido_id = os.environ.get('GTA6_TURNO_ID')
    if not pedido_id:
        return
    r = subprocess.run([sys.executable, os.path.join(AQUI, 'equipo.py'), 'comprobar-turno', '--pedido-id', pedido_id],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fail(r.stdout.strip() or r.stderr.strip() or 'el pedido está en pausa.')


def reportar_avance(fase):
    if not os.environ.get('GTA6_TURNO_ID') or not os.environ.get('GTA6_RUN_ID'):
        return
    try:
        subprocess.run([sys.executable, os.path.join(AQUI, 'equipo.py'), 'progreso', fase],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=7)
    except (OSError, subprocess.TimeoutExpired):
        pass


def revisar_reserva(a):
    if not os.environ.get('GTA6_TURNO_ID'):
        return
    if not a.video_id:
        fail('para este pedido falta --video-id y la reserva del tramo.')
    r = subprocess.run([sys.executable, os.path.join(AQUI, 'equipo.py'), 'verificar-tramo', a.video_id,
                        '--desde', str(segundos(a.desde)), '--hasta', str(segundos(a.hasta)),
                        '--clip', os.path.basename(os.path.abspath(a.dir))], capture_output=True, text=True)
    if r.returncode != 0:
        fail(r.stdout.strip() or r.stderr.strip() or 'el tramo no está reservado.')


def registrar_tiempo(cmd, seg, ok, url=''):
    """Una línea por comando en tiempos.jsonl (junto al script): equipo.py tiempos lo resume."""
    import time
    fuente = 'youtube' if es_youtube(url) else ('twitch' if 'twitch.tv' in url or 'kick.com' in url else ('x' if re.search(r'//(www\.)?(x|twitter)\.com/', url) else ''))
    try:
        with open(os.path.join(AQUI, 'tiempos.jsonl'), 'a', encoding='utf-8') as f:
            f.write(json.dumps({'cmd': cmd, 'seg': round(seg, 1), 'ok': ok, 'fuente': fuente, 'pedido': os.environ.get('GTA6_TURNO_ID') or '',
                                'el': int(time.time() * 1000)}) + '\n')
    except OSError:
        pass


ap = argparse.ArgumentParser()
sp = ap.add_subparsers(dest='cmd', required=True)
sp.add_parser('revisar')
sp.add_parser('preparar-whisper')
m = sp.add_parser('momentos'); m.add_argument('--url', required=True); m.add_argument('--cuantos', type=int, default=8)
m.add_argument('--categoria', default=os.environ.get('GTA6_CATEGORIA', ''))
m.add_argument('--evitar', default='', help='tramos ya usados del video, en segundos o mm:ss: "30-60,1:40-2:10"')
b = sp.add_parser('bajar'); b.add_argument('--url', required=True); b.add_argument('--desde', required=True); b.add_argument('--hasta', required=True); b.add_argument('--dir', required=True); b.add_argument('--video-id', default=''); b.add_argument('--idioma', default='', help='idioma original del video (ej. ru, pt-BR) para bajar sus subtítulos')
r = sp.add_parser('render'); r.add_argument('--dir', required=True); r.add_argument('--gancho', default='')
r.add_argument('--categoria', default=os.environ.get('GTA6_CATEGORIA', ''))
r.add_argument('--camara', default='', help='x,y,w,h o por tramos: "0-14:x,y,w,h;14-30:x,y,w,h" (segundos del archivo)'); r.add_argument('--gancho-en', type=float, default=None); r.add_argument('--foco', default='')
r.add_argument('--inicio', type=float, default=None, help='segundo del archivo bajado donde arranca el clip'); r.add_argument('--fin', type=float, default=None)
r.add_argument('--quitar', default='', help='pedazos a sacar del clip final, ej. "2-3"'); r.add_argument('--con-subs', action='store_true', default=True); r.add_argument('--sin-gancho', action='store_true', help='no poner el cartel de título'); r.add_argument('--estilo-titulo', default='', choices=['', *sorted(ESTILOS_TITULO)], help='color del cartel (si no, rota solo entre A-E, todos de paleta GTA VI)')
c = sp.add_parser('cortar'); c.add_argument('--dir', required=True); c.add_argument('--receta', required=True); c.add_argument('--vertical', required=True); c.add_argument('--quitar', required=True)
p = sp.add_parser('parchar'); p.add_argument('--dir', required=True); p.add_argument('--receta', required=True)
p.add_argument('--vertical', required=True); p.add_argument('--tramo', required=True, help='segundos del clip final, ej. 0-2.5')
a = ap.parse_args()
if a.cmd == 'preparar-whisper':
    sys.exit(0 if python_whisper(instalar=True) else 1)
if a.cmd in ('momentos', 'bajar'):
    revisar_pausa()
if a.cmd == 'bajar':
    revisar_reserva(a)
inicio_avance = {'momentos': 'analizando', 'bajar': 'descargando', 'render': 'renderizando'}
fin_avance = {'momentos': 'analizado', 'bajar': 'fuente_lista', 'render': 'video_listo'}
if a.cmd in inicio_avance:
    reportar_avance(inicio_avance[a.cmd])
if a.cmd == 'revisar':
    if revisar(True):
        sys.exit(1)
    sys.exit(0)
import time as _time
_t0, _ok = _time.time(), False
try:
    {'revisar': lambda a: revisar(True), 'momentos': momentos, 'bajar': bajar, 'render': render, 'parchar': parchar, 'cortar': cortar}[a.cmd](a)
    _ok = True
finally:
    registrar_tiempo(a.cmd, _time.time() - _t0, _ok, getattr(a, 'url', '') or '')
if a.cmd in fin_avance:
    reportar_avance(fin_avance[a.cmd])
