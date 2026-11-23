# Equipo GTA 6 — clipper automático

> **Antes de trabajar leé `PTM.md`** (protocolo de trabajo del equipo: ramas, deploy a main, puesta en marcha). Si entrás por primera vez, seguí su sección 0.

Herramienta para convertir streams de GTA 6 en clips verticales de ~30 s
(1080x1920) listos para Shorts/TikTok/Reels, más un panel web para coordinarse
en equipo (links, turnos, correcciones, biblioteca de clips).

## Stack

- Python 3 (solo stdlib) + `yt-dlp` + `ffmpeg`/`ffprobe`
- `faster-whisper` opcional (solo para videos sin subtítulos de YouTube)
- Node 20 + Vercel + Supabase para `app/`
- Linux. Binarios ya instalados: Python 3.14, ffmpeg 9.0, yt-dlp 2026.10.26

## Mapa

| Ruta | Qué es |
|---|---|
| `app/herramientas/procesar.py` | **Motor principal.** `momentos`, `bajar`, `render`, `cortar`, `parchar`, `revisar`. Constantes de formato arriba (W, H, GANCHO_DUR, SUB_Y…). Genera `receta.json`. |
| `app/herramientas/recopilar.py` | Recopilaciones de ~30 s con 4 momentos y número grande. Reutiliza `procesar.py` vía `exec`. |
| `app/herramientas/equipo.py` | Cliente del backend de equipo (Supabase). `conectar`, `get/set/update`, `subir`, `correcciones`, `escuchar`. |
| `app/herramientas/radar.py` | Busca videos de GTA 6 del día y detecta alertas (easter eggs, misterio, terror…). |
| `app/api/*.js`, `app/lib/comun.js` | Endpoints de Vercel (estado, video, doc, herramienta). |
| `app/public/index.html` | Panel del equipo (SPA en un solo HTML). |
| `app/herramientas/CAMBIOS.json` | Changelog con `version`. Subirla en cada cambio visible. |
| `panel/`, `identidad/` | Artefactos de diseño (no los toca el runtime). |
| `panel/tools/` | **Copia vieja y congelada** de `procesar.py`/`radar.py`. No editar acá: la fuente de verdad es `app/herramientas/`. |
| `app/herramientas/equipo.json` | **Secreto**: URL + clave del backend de equipo. Nunca leer, imprimir ni versionar. |
| `gta6-trabajo-rehacer/` | **Datos** de un lote de reelaboración (JSON, logs, videos). No es parte de la app. |

## Comandos

```bash
python3 app/herramientas/procesar.py revisar
python3 app/herramientas/procesar.py momentos --url URL --cuantos 8
python3 app/herramientas/procesar.py bajar --url URL --desde 4:18 --hasta 4:50 --dir CARPETA
python3 app/herramientas/procesar.py render --dir CARPETA --gancho "TEXTO"
python3 app/herramientas/procesar.py cortar --dir CARPETA --receta receta.json --vertical actual.mp4 --quitar 2-3
python3 app/herramientas/procesar.py parchar --dir CARPETA --receta receta.json --vertical actual.mp4 --tramo 0-2.5
python3 app/herramientas/recopilar.py --titulo "TITULO" --clips a,b,c,d --dir CARPETA
python3 app/herramientas/equipo.py herramientas
python3 app/herramientas/radar.py
```

Verificación mínima después de tocar Python:

```bash
python3 -m py_compile app/herramientas/*.py
python3 app/herramientas/procesar.py revisar
```

## Reglas para el agente

1. **No leer ni modificar `app/.env*` ni `app/herramientas/equipo.json`.** Tienen claves reales. Si una tarea
   necesita una variable, pedila por nombre, nunca imprimas el valor.
2. **No borrar ni subir clips** (`equipo.py borrar-video`, `subir`) sin pedido
   explícito. El bucket es producción.
3. **No lanzar descargas masivas de YouTube** (radar/yt-dlp en loop) sin
   confirmación: consumen red y tiempo.
4. **Un cambio por vez, verificable.** Nada de reescribir archivos completos si
   el cambio es localizado.
5. **No cambiar nombres de campos JSON** (`receta.json`, respuestas del panel):
   el panel y las recetas viejas dependen de ellos.
6. **Mantener los textos de UI en español rioplatense** como el resto.
7. **Si el cambio lo ve el usuario**, agregar entrada en `CAMBIOS.json` y subir
   `version`.
8. **No reformatear** archivos existentes (indentación, comillas, orden de imports).
9. **Probar con un clip corto** antes de correr un lote. Un render completo tarda
   y descarga de YouTube.
10. Si algo falla dos veces, parar y reportar el error en 3 líneas.

## Deuda técnica conocida (priorizada)

1. ✅ **Rutas absolutas: resuelto.** Derivadas de `__file__` / `BASH_SOURCE` en
   los 6 scripts de lote (commit `9c1daef`).
2. ✅ **Git: resuelto.** Repo inicializado, commit base `93f979b` (94 archivos,
   `.git` = 1,7 MB). Antes de cada tanda de cambios, commitear o usar `git stash`.
3. `recopilar.py` hace `exec` del código de `procesar.py` cortando en
   `argparse`. Es frágil: cualquier cambio de orden arriba rompe la recopilación.
4. `procesar.py` tiene 899 líneas y mezcla descarga, análisis, ASS, filtros y
   CLI. Se puede partir sin cambiar comportamiento.
5. ✅ **Tests: resuelto.** Suite automatizada con 60 tests en Node y 50 tests en Python (`app/tests/`), integrada en `.github/workflows/verificar.yml`.
6. ✅ **faster-whisper en Mac/Linux: resuelto.** Comando interactivo `python3 procesar.py preparar-whisper` en venv aislado con Python 3.12 (`.whisper/py312/`).
7. `plan_gta6.html`, `panel_equipo.html` y `lamina.html` son artefactos sueltos:
   definir si son fuente o salida.

## Contexto de producto

- Formato: gancho 2,5 s + historia; streamer arriba, juego abajo; subtítulos
  en español; cartel de título con paleta GTA VI que rota entre 5 estilos (A-E).
- Límite de peso del panel: `MAX_MB = 14`.
- Las recetas se guardan en el clip del panel para corregir tramos con `parchar`
  sin rehacer todo.
