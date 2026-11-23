# GTA 6 — Clipper automático y panel de equipo

Herramientas para convertir streams de GTA 6 en clips verticales de ~30 s
(1080×1920) listos para Shorts, TikTok y Reels, más un panel web para coordinarse
en equipo: links, turnos, correcciones, biblioteca de clips y publicación en
redes.

Proyecto abierto bajo licencia MIT. No está afiliado a Rockstar Games ni a
Take-Two Interactive.

## Qué incluye

- **Motor de clips (Python + ffmpeg + yt-dlp):** busca momentos, descarga solo
  el tramo necesario, recorta, agrega gancho, subtítulos en español y overlay, y
  deja un MP4 vertical con una receta reproducible.
- **Panel de equipo (Vercel + Supabase):** pedidos de clips, cola por compu,
  correcciones, biblioteca, links en rotación y modo escucha.
- **Publicaciones:** conexiones OAuth, cuentas a rastrear, sugerencias,
  preparación de material, cola por red, trazabilidad y métricas oficiales.
  Instagram, Facebook y X publican tras aprobar; YouTube y TikTok quedan en
  borrador para terminar a mano.

## Estructura

| Ruta | Qué es |
|---|---|
| `app/herramientas/procesar.py` | Motor principal: `momentos`, `bajar`, `render`, `cortar`, `parchar`, `revisar`, `preparar-whisper`. |
| `app/herramientas/recopilar.py` | Recopilaciones de ~30 s con 4 momentos. |
| `app/herramientas/equipo.py` | Cliente del panel: conectar, get/set/update, subir, correcciones, escuchar. |
| `app/herramientas/radar.py` | Busca videos de GTA 6 del día y detecta alertas. |
| `app/herramientas/publicaciones.py` | Procesa trabajos editoriales y pasos de la cola de publicación. |
| `app/api/`, `app/lib/` | Endpoints y lógica del panel (Vercel). |
| `app/public/index.html` | Panel del equipo. |
| `app/tests/` | Pruebas de Node y Python. |
| `app/docs/PUBLICACIONES.md` | Configuración de redes y publicación. |
| `AGENTS.md` | Reglas y mapa del proyecto para agentes de código. |

## Requisitos

- Python 3.12 o superior (el motor usa solo la biblioteca estándar).
- `ffmpeg` y `ffprobe` con `libass` y `drawtext`.
- `yt-dlp`.
- Node 20 o superior y npm (panel).
- Un proyecto de Supabase (base y storage).
- Vercel para desplegar el panel (opcional para probar local).
- `faster-whisper` solo si se van a procesar videos sin subtítulos (Twitch/Kick).

## Puesta en marcha

### 1. Motor de clips

```bash
python3 app/herramientas/procesar.py revisar
```

Si falta algo, el comando indica qué instalar. Para Whisper:

```bash
python3 app/herramientas/procesar.py preparar-whisper
```

### 2. Panel

```bash
cd app
npm ci
cp .env.example .env.local   # completá los valores
npm test
```

En Supabase, ejecutá en orden los archivos de `app/supabase/migrations/`:

1. `202611220000_base.sql` — tabla `docs` y bucket privado `clips`.
2. `202611220001_publicaciones.sql` — tablas de publicación.

Después desplegá `app/` en Vercel y cargá las mismas variables de entorno.
La app usa la `service_role` key solo del lado del servidor; nunca la expongas
en el cliente.

### 3. Conectar una compu del equipo

```bash
python3 app/herramientas/equipo.py conectar --url https://tu-panel.vercel.app --clave TU_CLAVE
python3 app/herramientas/equipo.py herramientas
```

La clave queda en `app/herramientas/equipo.json`, que está ignorado por Git.

### 4. Publicaciones

Seguí `app/docs/PUBLICACIONES.md`. Resumen:

1. Completar las variables de Meta, Google, TikTok y Buffer.
2. Conectar cada cuenta desde el panel (`/api/conexion/...`).
3. Importar las fuentes desde **Cuentas a rastrear**.
4. Probar una sugerencia completa.
5. Recién entonces definir `PUBLICACION_ACTIVA=1`.

## Pruebas

```bash
cd app && npm test
cd .. && python3 -m py_compile app/herramientas/*.py
python3 -m unittest discover -s app/tests -p 'test_*.py'
```

El workflow `.github/workflows/verificar.yml` corre lo mismo en cada PR y en
`main`.

## Personalización

El equipo se define en tres lugares y conviene cambiarlo junto:

- `app/herramientas/equipo.py` → `EQUIPO`
- `app/lib/turnos.js` → `EQUIPO`
- `app/public/index.html` → `EQUIPO`

Las claves de cada integrante se cargan en la variable `TEAM_KEYS` (JSON). Los
handles y cuentas de las redes están en `app/lib/publicacion.js` (`REDES`) y en
`app/herramientas/fuentes_iniciales.json`.

## Datos y secretos

- `app/.env*`, `app/herramientas/equipo.json`, cookies, claves y media pesada
  están fuera del repositorio.
- Los clips se guardan en un bucket privado de Supabase.
- Las notas internas de trabajo no se versionan.

## Aviso legal

GTA 6 y sus marcas pertenecen a Rockstar Games / Take-Two Interactive. Este
proyecto no incluye assets del juego ni está afiliado a sus titulares. Los clips
se generan a partir de streams de terceros: quien publica es responsable de
contar con los derechos y permisos correspondientes.

## Licencia

MIT. Ver `LICENSE`. La fuente Bowlby One incluida se distribuye bajo la SIL Open
Font License (`app/herramientas/OFL.txt`).
