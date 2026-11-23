"""Obtiene YT_REFRESH_TOKEN y lo carga en Vercel sin mostrarlo ni pasarlo por el chat.

Uso (en la compu, con el navegador y `vercel`/`gh` logueados):
  python3 app/herramientas/youtube_token_vercel.py ruta/client_secret_XXXX.json [--canal UC...]

1. Abre el navegador para autorizar con la cuenta de Google dueña del canal.
2. Recibe el código en http://127.0.0.1 (cliente OAuth de escritorio, con PKCE).
3. Comprueba el canal y manda el refresh token a Vercel por stdin.
4. Dispara el workflow Verificar para que el panel tome la variable.

Nunca imprime ni guarda en disco el refresh token, el secreto del cliente ni el
access token. El JSON de cliente no se modifica; borrarlo después es decisión del
usuario.
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

PROYECTO = 'prj_54G9WHv8ggngapNEXRDDB0GJ3FTE'
EQUIPO = 'team_teuRF4rK0UsjEY2iUYw3ES4v'
REPO = 'contentgtagroup-star/gta6-equipo'
WORKFLOW = 'verificar.yml'
SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'


def leer_cliente(ruta):
    with open(ruta, encoding='utf-8') as f:
        raw = json.load(f)
    cfg = raw.get('installed') or raw.get('web')
    if not cfg or not cfg.get('client_id') or not cfg.get('client_secret'):
        sys.exit('El JSON no parece un cliente OAuth de Google (faltan "installed", client_id o client_secret).')
    return cfg['client_id'], cfg['client_secret']


def ocultar(texto, secretos):
    """Reemplaza cualquier secreto conocido antes de mostrar salida de un subproceso."""
    resultado = str(texto or '')
    for valor in secretos:
        if valor:
            resultado = resultado.replace(valor, '***')
    return resultado


def comando_vercel():
    # El valor va por stdin (input=), nunca en argv ni en --value: queda fuera del historial y de `ps`.
    return ['vercel', 'env', 'add', 'YT_REFRESH_TOKEN', '-e', 'production', '--force',
            '--sensitive', '-p', PROYECTO, '--scope', EQUIPO, '-y']


def comando_deploy():
    return ['gh', 'workflow', 'run', WORKFLOW, '-R', REPO, '--ref', 'main']


def verificar_canal(items, esperado):
    if not items:
        sys.exit('Esa cuenta de Google no tiene canal de YouTube. Entrá con la cuenta (o el canal de marca) correcto.')
    if esperado and not any(str(x.get('id')) == str(esperado) for x in items):
        sys.exit('La cuenta autorizada no tiene el canal esperado. No se cargó ningún token en Vercel.')
    canal = items[0]
    if esperado:
        canal = next(x for x in items if str(x.get('id')) == str(esperado))
    return canal.get('snippet', {}).get('title') or 'YouTube', str(canal.get('id') or '')


def autorizar(cid, csec):
    verificador = secrets.token_urlsafe(64)
    reto = base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).rstrip(b'=').decode()
    estado = secrets.token_urlsafe(16)
    recibido = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if 'code' not in q and 'error' not in q:
                self.send_response(404)
                self.end_headers()
                return
            recibido.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write('<h2>Listo. Ya podés cerrar esta pestaña y volver a la terminal.</h2>'.encode())

        def log_message(self, *args):
            pass

    srv = http.server.HTTPServer(('127.0.0.1', 0), Callback)
    srv.timeout = 300
    redirect = 'http://127.0.0.1:' + str(srv.server_port)
    url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
        'client_id': cid, 'redirect_uri': redirect, 'response_type': 'code', 'scope': SCOPES,
        'access_type': 'offline', 'prompt': 'consent', 'state': estado,
        'code_challenge': reto, 'code_challenge_method': 'S256',
    })
    print('Abriendo el navegador. Si no se abre, copiá este link:\n' + url)
    webbrowser.open(url)
    try:
        while not recibido:
            srv.handle_request()
    finally:
        srv.server_close()
    if not recibido:
        sys.exit('Se agotó el tiempo esperando la autorización. Probá de nuevo.')
    if recibido.get('error'):
        sys.exit('Google rechazó la autorización: ' + recibido['error'])
    if recibido.get('state') != estado:
        sys.exit('La respuesta no coincide con el pedido (state). Probá de nuevo.')

    cuerpo = urllib.parse.urlencode({
        'code': recibido['code'], 'client_id': cid, 'client_secret': csec,
        'redirect_uri': redirect, 'grant_type': 'authorization_code', 'code_verifier': verificador,
    }).encode()
    try:
        with urllib.request.urlopen('https://oauth2.googleapis.com/token', cuerpo, timeout=60) as r:
            tokens = json.load(r)
    except (urllib.error.URLError, TimeoutError) as e:
        sys.exit('No se pudo intercambiar el código con Google: ' + str(getattr(e, 'reason', e)))
    refresh = tokens.get('refresh_token')
    if not refresh:
        sys.exit('Google no devolvió refresh_token. Quitá el acceso de la app en myaccount.google.com y probá de nuevo.')

    req = urllib.request.Request(
        'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
        headers={'Authorization': 'Bearer ' + tokens['access_token']})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            items = json.load(r).get('items', [])
    except (urllib.error.URLError, TimeoutError) as e:
        sys.exit('No se pudo comprobar el canal en YouTube: ' + str(getattr(e, 'reason', e)))
    return refresh, items


def cargar_en_vercel(refresh, secretos):
    try:
        p = subprocess.run(comando_vercel(), input=refresh + '\n', text=True,
                           capture_output=True, check=False)
    except FileNotFoundError:
        sys.exit('No encontré el comando `vercel`. Instalalo con `npm i -g vercel` y logueate.')
    if p.returncode:
        detalle = ocultar((p.stderr or p.stdout or '').strip()[-500:], secretos)
        sys.exit('No se pudo cargar YT_REFRESH_TOKEN en Vercel. ¿Estás logueado con `vercel login`?\n' + detalle)
    return ocultar((p.stdout or '').strip(), secretos)


def disparar_deploy(secretos):
    try:
        p = subprocess.run(comando_deploy(), text=True, capture_output=True, check=False)
    except FileNotFoundError:
        return 'No encontré `gh`, así que no pude disparar el deploy. Avisame y lo hago desde GitHub.'
    if p.returncode:
        detalle = ocultar((p.stderr or p.stdout or '').strip()[-300:], secretos)
        return 'El secreto ya está en Vercel pero no pude disparar el deploy: ' + detalle + '. Avisame y lo hago desde GitHub.'
    return 'Deploy disparado desde GitHub Actions (workflow Verificar).'


def main():
    ap = argparse.ArgumentParser(description='Carga YT_REFRESH_TOKEN en Vercel sin mostrarlo.')
    ap.add_argument('cliente', help='JSON client_secret_XXXX.json descargado de Google Cloud Console')
    ap.add_argument('--canal', default=os.environ.get('YOUTUBE_CHANNEL_ID', ''),
                    help='ID del canal esperado (opcional; por defecto YOUTUBE_CHANNEL_ID local)')
    ap.add_argument('--sin-deploy', action='store_true', help='No disparar el workflow de Verificar')
    args = ap.parse_args()

    cid, csec = leer_cliente(args.cliente)
    refresh, items = autorizar(cid, csec)
    titulo, id_canal = verificar_canal(items, args.canal)
    if not args.canal:
        print('Canal autorizado: ' + titulo + ' (id ' + id_canal + ')')
        if input('¿Es este el canal de GTA 6? [s/N]: ').strip().lower() not in ('s', 'si', 'sí'):
            sys.exit('No se cargó nada en Vercel. Volé a correr con el canal correcto.')

    secretos = [refresh, csec, cid]
    cargar_en_vercel(refresh, secretos)
    print('YT_REFRESH_TOKEN cargado como secreto de Vercel Production.')
    print('Canal: ' + titulo + ' (id ' + id_canal + ')')
    if not args.sin_deploy:
        print(disparar_deploy(secretos))
    print('Ya podés borrar el JSON de cliente de la compu. Nunca pegues el token en el chat.')


if __name__ == '__main__':
    main()
