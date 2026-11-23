# PTM — Protocolo de Trabajo · Equipo GTA 6

> **Versión:** 1.0 · 2026-11-23 · Repo único: `contentgtagroup-star/gta6-equipo`
> Complementa a `AGENTS.md` (ese dice *cómo un agente edita el código*; este dice *cómo nos organizamos los devs: ramas, deploys y puesta en marcha*).
> **Fuente de verdad:** este archivo vive en el repo. `AGENTS.md` lo apunta arriba de todo para que los agentes lo lean solos.

---

## 0. Si entrás por primera vez (leé esto antes que nada)

Si abrís este repo y es tu primera vez, **antes de tocar código tenés que dejar tu compu lista y guardar este PTM**:

1. **Instalá las herramientas** para tu sistema operativo (sección "Puesta en marcha").
2. **Verificá** que quedó todo: `python3 app/herramientas/procesar.py revisar`.
3. **Conectá tu compu** al panel con tu clave (sección "Conectar").
4. **Guardá este PTM en tu agente** (sección "Cómo se aplica") así se te aplica solo en cada sesión.
5. Recién ahí, leé `AGENTS.md` y empezá a trabajar siguiendo las reglas R1–R7.

## Devs y dominios

| Dev | GitHub | Dominio (qué posee / deploya) |
|-----|--------|-------------------------------|
| **Eze** | `AstonMartin-s` | Publicación, trazabilidad, panel práctico (UX de pedidos/cola/biblioteca). |
| **Cuervo** | `contentgtagroup-star` (Tomás) | Motor / funcionamiento: `procesar.py`, `recopilar.py`, render, Whisper, radar. |
| **Luis** | — | Operativa (juntar cuentas, clips, ideas). **No deploya.** |

- Cada dev **edita y deploya lo suyo**. Lo que cruce el dominio del otro → se avisa antes (ver "Orden de contratos").

## Comunicación entre instancias (mensaje R1)

Trabajamos con **varias instancias de Claude Code** (cada dev tiene la suya, y un mismo dev puede tener varias: dev/deploy, cuentas/publicación, etc.). Para pasar trabajo o avisos entre instancias sin perder contexto, se usa este bloque (se copia y pega de una instancia a otra, o se le pasa a otro dev):

```
=== MENSAJE R1 — INTER-INSTANCIA ===
DE: <instancia/dev>   →   A: <instancia/dev>
TIPO: <PEDIDO | RESPUESTA | AVISO>
TEMA: <en una línea>
FECHA: <YYYY-MM-DD>

CONTEXTO:
<1-3 líneas>

QUÉ TOCA (rama / archivos / contrato):
<rama, archivos o "ninguno">

ACCIÓN REQUERIDA:
<qué debe hacer la instancia destino>

REFERENCIAS:
- <docs, PR, branch, link>
=== FIN R1 ===
```

- Nunca pegar secretos en un R1.
- Si el R1 pide tocar `main` o la rama del otro → el destino audita (R2) antes de ejecutar.

## R1 — Una rama por dev, por tema

- Formato: `ajustes/<dev>/<tema>` → `ajustes/eze/publicacion-cola`, `ajustes/cuervo/motor-eze`.
- **Una rama = un tema acotado y verificable.** Nada de ramas gigantes que mezclan todo.
- Nunca commitear directo a `main`. Siempre rama → PR → merge.

## R2 — Auditar antes de mergear (REGLA DURA)

Antes de mergear a `main`, **siempre**:

1. `git fetch --all` y mirar en qué está `origin/main` (base real, no la copia vieja).
2. Mirar las **ramas activas del otro dev** (`git branch -a`, `git log origin/main..origin/ajustes/<otro>/*`).
3. Preguntarse: **¿mi merge reescribe o rompe algo que el otro tiene en vuelo?**
   Si toca archivos que el otro está modificando en su rama → **avisar antes**, no mergear a ciegas.
4. Correr los tests (`cd app && npm test` + `python3 -m unittest discover -s app/tests -p 'test_*.py'`) o confirmar que el CI (`.github/workflows/verificar.yml`) está verde en el PR.

## R3 — Deploy a main (ordenado)

- Deploy = **merge a `main`** (Vercel despliega desde `main`).
- Implementación: el workflow **Verificar** publica en Vercel después de pasar
  las pruebas de `main`. Eze puede usar este flujo desde GitHub. La conexión Git
  nativa de Vercel y los previews por rama siguen pendientes; ver
  `app/docs/DESPLIEGUE.md`.
- Camino: rama propia → **PR** → review del otro dev si cruza su dominio → merge.
- Merge preferido: **merge commit** o **squash** (historia limpia y revertible). **Nunca `push --force` a `main`.**

## R4 — Registrar cada cambio visible

- Si el cambio lo ve el usuario → entrada en `app/herramientas/CAMBIOS.json` + subir `version`.
- El PR describe en 2-3 líneas: qué cambia, qué dominio toca, si cruza al otro.

## R5 — Siempre poder volver atrás

- Todo cambio en `main` se revierte con `git revert <commit>` (nunca reescribir historia).
- Antes de un merge grande, confirmar que el anterior quedó estable.

## R6 — Secretos (regla dura)

- **Nunca** leer, imprimir ni versionar `app/.env*` ni `app/herramientas/equipo.json`.
- Claves de redes/Supabase/paneles van por variables de entorno, nunca al repo ni al chat.

## R7 — Higiene

- Un cambio por vez, verificable. No reescribir archivos completos por un cambio localizado.
- No reformatear archivos existentes (indentación, comillas, orden de imports).
- Textos de UI en **español rioplatense**.
- Probar con un clip corto antes de un lote. No lanzar descargas masivas de YouTube sin confirmar.

## Orden de contratos (quién avisa a quién)

| Cambia | Dueño | Avisa a |
|--------|-------|---------|
| Motor / render / Whisper / radar | Cuervo | Eze (si cambia salida que usa el panel) |
| Panel / cola / biblioteca / UX | Eze | Cuervo (si cambia un contrato que lee el motor) |
| Publicación / redes / trazabilidad / fuentes | Eze | Cuervo (si toca `equipo.py` o el runtime) |
| Nombres de campos JSON (`receta.json`, respuestas del panel) | quien lo crea | **todos** (rompe recetas viejas y el panel) |
| Secretos / `.env` / `equipo.json` | quien administra | dev afectado (por nombre, sin valores) |

---

## Puesta en marcha (instalar las herramientas)

El motor necesita **Python 3.12+**, **ffmpeg/ffprobe** (con `libass` y `drawtext`) y **yt-dlp**. `faster-whisper` solo si vas a procesar videos sin subtítulos (Twitch/Kick) — se instala aparte con `python3 app/herramientas/procesar.py preparar-whisper`.

### Mac (Homebrew)

```bash
brew install python@3.12 yt-dlp ffmpeg
# Si 'procesar.py revisar' se queja de que a ffmpeg le falta drawtext/libass:
brew uninstall --ignore-dependencies ffmpeg
brew tap homebrew-ffmpeg/ffmpeg
brew install homebrew-ffmpeg/ffmpeg/ffmpeg
```

### Linux (Debian / Ubuntu)

```bash
sudo apt update && sudo apt install -y python3 python3-venv ffmpeg
# yt-dlp (binario oficial, siempre actualizado):
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### Windows (winget)

```powershell
winget install Python.Python.3.12
winget install Gyan.FFmpeg
winget install yt-dlp.yt-dlp
```

> En Windows, si falta algo, alternativa con Chocolatey: `choco install python ffmpeg yt-dlp`.

### Verificar (los tres SO)

```bash
python3 app/herramientas/procesar.py revisar
```

El comando te dice si falta algo y qué instalar. No sigas hasta que dé OK.

## Conectar tu compu al panel

```bash
python3 app/herramientas/equipo.py conectar --url https://gta6-equipo.vercel.app --clave TU_CLAVE
python3 app/herramientas/equipo.py herramientas
```

- Tu clave te la da quien administra el equipo. Queda en `app/herramientas/equipo.json` (ignorado por Git). **Nunca la pegues en el chat ni la subas al repo.**
- (Opcional) Motor automático: necesita el CLI de Claude Code instalado y logueado. Activar/parar: `python3 app/herramientas/equipo.py autoinicio`.

## Cómo se aplica este PTM

- **En el repo (equipo y agentes):** `PTM.md` en la raíz + puntero en `AGENTS.md`, así cualquier agente que abra el proyecto lo lee solo.
- **Cada dev lo guarda en su agente**, para que se aplique sin repetirlo:
  - **Claude Code** (Eze y Cuervo): guardarlo en memoria del proyecto.
  - Cualquier otro agente: cargarlo como regla/base de contexto del proyecto.
