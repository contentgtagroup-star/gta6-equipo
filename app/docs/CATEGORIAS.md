# Categorías de producción — auditoría e implementación, 2026-11-21

## Arquitectura descubierta

La app desplegable es `app/`. El `index.html` sin seguimiento de Git en la raíz es ajeno a este cambio. El frontend es una SPA HTML/CSS/JavaScript sin bundler. El backend usa funciones Vercel ES modules y `@supabase/supabase-js` 2.45.4. Declara Node >=20; la validación local se ejecutó con Node 24.22.3. La única dependencia npm existente se conserva.

Rutas: `/api/estado` entrega estado y URLs firmadas, `/api/turno` coordina trabajos, `/api/doc` administra documentos con versión optimista, `/api/video` gestiona Storage y `/api/herramienta` distribuye herramientas. La autenticación existente usa claves por integrante. Los nombres de variables se referencian desde `comun.js`; no se abrieron archivos de entorno ni equipo.json.

Supabase guarda documentos JSON en `docs` (`coleccion`, `id`, `datos`, `version`) y videos en Storage. No se encontró una migración SQL ni esquema local de la base. Los clips guardan estado, receta, fuentes y calificaciones. Los pedidos conservan pausa, avances y bloqueos de concurrencia. La persistencia nueva se añade dentro de `datos`, sin DDL ni migraciones.

La generación real la ejecuta `equipo.py`, que despierta Claude CLI (Sonnet) o Codex CLI con un prompt generado por el servidor. No hay proveedor HTTP de generación separado, endpoint de ideas, servicio de guiones o síntesis de voz. Se conserva el audio del streamer; no se añadió TTS. El agente interpreta material, escribe títulos/descripciones y traduce subtítulos cuando corresponde. El registro narrativo nuevo documenta el plan editorial: su presencia no certifica que el audio contenga ese guion.

`radar.py` busca con yt-dlp y ordena por vistas/vistas por hora. No comprueba autenticidad del gameplay ni viralidad de una afirmación. `procesar.py momentos` usa heatmap, transcripción y picos de volumen. `bajar` obtiene un tramo, metadatos, imágenes y subtítulos. Whisper es opcional y no está instalado localmente. FFmpeg produce ASS y video vertical; `cortar` y `parchar` reutilizan recetas. `recopilar.py` reutiliza código del motor vía exec: fragilidad preexistente conservada.

Flujo real: panel → pedido validado → documento de turno → escucha local → agente → reserva de link/tramo → radar/análisis de momentos → descarga acotada → revisión visual/traducción/gancho → render FFmpeg → revisión de muestras → Storage + documento del clip. El flujo general también arma recopilaciones. Errores de API usan HTTP/JSON; CLI falla con mensajes; los turnos registran errores y permiten reintentos. No se añadieron reintentos de IA.

## Protección y cambios mínimos

Se detectaron modificaciones ajenas en subtítulos e imágenes de `gta6-trabajo-rehacer/` y archivos sin seguimiento (incluido `index.html` raíz). Se conservaron. Antes de editar se creó un snapshot con `git stash create`, sin retirar cambios del directorio: `dc808d71491d96a3b87d9f4c2fa590c178d79227`. Es un objeto sin referencia persistente; no depender de él como backup permanente. También se copiaron archivos sensibles al cambio en `/tmp/gta6-categorias-respaldo`. No se ejecutó reset, clean ni checkout.

Para revertir esta tarea, revisar el diff de `app/` y revertir solamente sus hunks y archivos nuevos listados aquí. No aplicar un stash completo ni restaurar el directorio de datos. No se hizo deploy ni escritura contra Supabase durante esta tarea.

Plan incremental aplicado: (1) línea base y mapa; (2) registro y validadores; (3) selector; (4) prompts, radar, momentos y render; (5) documentos aditivos; (6) pruebas aisladas y renders sintéticos.

## Fuente de verdad e integración

`herramientas/categorias.json` contiene ocho entradas independientes con id, nombre, descripción, habilitación, versión, reglas de ideas, estructura, tono, requisitos visuales, campos de calidad, palabras clave y consultas de investigación. No contiene credenciales. Para agregar una categoría se añade su configuración; los validadores específicos adicionales deben implementarse si requiere comprobaciones nuevas.

`lib/categorias.js` carga ese registro, valida identificadores, publica solo id/nombre/descripción, compone instrucciones confiables y comprueba calidad. El cliente solo envía un identificador; las instrucciones no se toman de la UI. Las fuentes y el feedback se delimitan como datos. El feedback especializado se filtra por categoría; General conserva el feedback anterior.

`prompt_turno.js` conserva el prompt General y sustituye selección/recopilación solo en pedidos especializados. Usa el motor existente, exige evidencia y plan narrativo, revisión del recorte local y referencias visuales. No afirma que existan recursos ausentes ni modifica declaraciones del streamer para simular un guion. Falta de material debe resultar en un pedido incompleto, no en éxito ficticio. Se limita la revisión a ocho candidatos de un link, sin ciclos ilimitados.

`turno.js` valida categoría y la conserva al pedir, reintentar, recuperar, pausar y reanudar. `tomar` la entrega a `equipo.py`; este la exporta mediante `GTA6_CATEGORIA`. El radar selecciona dos consultas específicas usando el mismo buscador y conserva fecha del video. Momentos suma señales léxicas específicas, sin certificar pertenencia ni veracidad. Render admite `--categoria`, valida y guarda categoría y versión en la receta. El filtro audiovisual no se modifica.

`doc.js` hereda la categoría del pedido y rechaza discrepancias; persiste categoría y versión en clip y receta. Los documentos antiguos siguen válidos. Al guardar un clip categorizado como listo exige concepto, hook/desarrollo/payoff/cierre, estructura por etapas, evidencia con URL/tiempos/estado y referencias visuales. Comprueba requisitos por categoría, comparación A/B, pasos de guía, incertidumbre y duplicados exactos normalizados de concepto. Tendencias sugeridas deben indicarlo en hook/título; verificadas requieren fecha de los últimos 14 días y señal de atención. No se consulta IA para validar.

No es un verificador semántico o visual: un texto incorrecto pero formalmente completo podría pasar. Los duplicados parafraseados y carreras entre dos altas simultáneas de igual concepto no se resuelven con unicidad transaccional. El historial se consulta paginado; ese costo puede crecer con la biblioteca. Categorías inválidas y registros incompletos devuelven 400. El CLI muestra los detalles para que el agente pueda corregirlos.

Los pedidos especializados no invocan recopilaciones: 7,5 segundos por fuente pueden destruir la narrativa y la evidencia. La herramienta de recopilación manual existente sigue disponible; si todas sus fuentes tienen la misma categoría conserva esa referencia, sin exigirle un guion único. Los grupos mixtos no reciben una categoría única. General conserva recopilaciones automáticas.

## Uso

En Crear clips, elegí General o una de las ocho categorías, elegí cantidad y enviá. Cambiar categoría modifica el próximo pedido; no interrumpe trabajos activos. La selección se captura antes de la petición asíncrona, los botones usan aria-pressed y conservan foco entre refrescos sin cambios. Pedidos y tarjetas muestran su categoría. Los registros anteriores se muestran como General.

La versión de herramientas sube a 30 y el mínimo para asignar nuevos pedidos también. El registro se distribuye por `/api/herramienta` y se incluye explícitamente en las funciones Vercel que lo leen. Después del despliegue habitual, actualizar las herramientas de cada PC. No se desplegó desde esta tarea.

CLI: `python3 app/herramientas/procesar.py momentos --url URL --categoria easter-eggs` y `render --dir CARPETA --gancho TEXTO --categoria easter-eggs`. Sin categoría ni variable de turno conserva el comportamiento anterior.

## Verificación y límites

Línea base: 39 tests Python y 3 archivos de tests Node sin fallos. Verificación ampliada: 42 tests Python; 33 tests Node ejecutados directamente en cinco archivos, todos aprobados. Se evitó depender únicamente del resumen del runner que en este entorno contaba archivos. El test de equivalencia General usa SHA-256 de la salida original; su primera versión intentaba invocar git desde Node y encontró EPERM del entorno; se sustituyó por un valor fijo calculado del respaldo anterior.

Comandos:

- `python3 -m py_compile app/herramientas/*.py`
- `python3 app/herramientas/procesar.py revisar` (yt-dlp, ffmpeg, fuente y overlay OK; faster-whisper opcional ausente)
- `python3 -m unittest discover -s app/tests` (42 pruebas)
- `node app/tests/categorias.test.mjs` (4)
- `node app/tests/categorias_ui.test.mjs` (1)
- `node app/tests/estado_turno.test.mjs` (1)
- `node app/tests/turno_api.test.mjs` (25)
- `node app/tests/turnos.test.mjs` (2)
- `git diff --check`
- Comprobación de sintaxis de JS/SPA y render de una fuente sintética de ocho segundos con FFmpeg, audio y frases locales. Resultado categorizado: `/tmp/gta6-categoria-render/vertical.mp4`, H.264/AAC, 1080×1920, 10,5 s, 8,1 MB; receta con easter-eggs v1. Una muestra fue inspeccionada visualmente (overlay, cartel y subtítulo). También terminó el render General en `/tmp/gta6-general-render/vertical.mp4` (10,5 s); su receta no contiene campos de categoría.

La UI se ejecutó contra un DOM mínimo y las APIs contra Supabase simulado. No hubo revisión responsive/cross-browser en navegador real, build Vercel remoto, llamadas reales a agentes/IA, búsquedas de YouTube, descargas externas, cargas ni borrados en Storage. No existe script npm de compilación; la SPA no necesita bundler. No se certifica una generación editorial real para ninguna categoría con estas pruebas. No se probó contra Node 20, aunque se usaron APIs compatibles.

## Archivos

Nuevos: `herramientas/categorias.json`, `lib/categorias.js`, `tests/categorias.test.mjs`, `tests/categorias_ui.test.mjs`, `tests/test_categorias.py`, este documento.

Extendidos: `api/turno.js`, `api/estado.js`, `api/doc.js`, `api/herramienta.js`, `lib/prompt_turno.js`, `lib/turnos.js`, `public/index.html`, `herramientas/equipo.py`, `herramientas/procesar.py`, `herramientas/radar.py`, `herramientas/recopilar.py`, `herramientas/CAMBIOS.json`, `vercel.json` y tres pruebas existentes (`turno_api`, `estado_turno`, `turnos`).

## Próxima mejora

Una biblioteca pequeña de fuentes y recortes verificados por categoría permitiría una prueba editorial completa sin búsquedas amplias y mejoraría la coherencia audiovisual. Antes de producción: desplegar mediante el flujo habitual, actualizar una PC y ejecutar un único pedido con material autorizado, revisando evidencia, audio, estructura y resultado. La generación autónoma de guiones originales con narración sería una evolución separada: hoy el producto sigue siendo un clipper con dirección editorial especializada.

## Despliegue autorizado — 2026-11-21

Tras la autorización del usuario se publicó la versión 30 en el proyecto Vercel existente `gta6-equipo`. Despliegue `dpl_5uhhSLhmTgfZNM6gvqG172K7EZ2s`, URL inmutable `https://gta6-equipo-fz5az1gc7-synkcc-2206s-projects.vercel.app`. Build READY y promoción de producción confirmada por Vercel. Antes de promover se verificó HTTP 200 para el panel y HTTP 401 con el error de autenticación esperado en estado, turno y doc. Se repitieron las 33 pruebas Node y 42 Python sin fallos. No se ejecutaron generaciones, cargas ni borrados en producción.

Se añadió `.vercelignore` para excluir credenciales locales, estado temporal de Supabase, logs, bytecode y archivos de pruebas/documentación. Se verificó el inventario mediante deploy --dry. La escucha existente comprueba versiones y actualiza herramientas automáticamente cuando está activa y vuelve a su ciclo de revisión. No se comprobó la actualización efectiva de cada PC ni se leyeron sus claves.

Dominio habitual verificado: https://gta6-equipo.vercel.app/ (HTTP 200 y selector nuevo presente). Alias confirmado contra el identificador del despliegue nuevo.
