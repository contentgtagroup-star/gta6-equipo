# Configuración de publicaciones

Antes de crear integraciones nuevas, revisar `gta-publicador/` en la raíz de
GTA6. El repositorio `contentgtagroup-star/gta-publicador` ya tiene los secretos
de YouTube (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`) y Buffer
(`BUFFER_API_KEY`). Su prueba de solo lectura confirmó ambas conexiones el
2026-11-23 (Actions 45191704837). Faltar variables en Vercel no significa que
las apps no existan. Los secretos de GitHub no permiten recuperar sus valores
por lectura: una migración al panel requiere transferirlos por un canal seguro.

1. Ejecutar `supabase/migrations/202611220001_publicaciones.sql` en el proyecto
   Supabase del equipo. La tabla nueva solo admite acceso del servidor.
2. Configurar en Vercel, sin subir los valores al repositorio:

| Variable | Uso |
| --- | --- |
| `PUBLICACION_ORIGIN` | Origen HTTPS del panel, sin barra final |
| `PUBLICACION_CIPHER_KEY` | Clave aleatoria de 32 bytes codificada en base64 para cifrar los tokens guardados |
| `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID` | App Business y página autorizada de Meta |
| `META_AUTH_MODE` | Opcional: `system_user` fuerza el modo sistema; si falta, se activa solo con que exista `META_SYSTEM_USER_TOKEN` |
| `META_SYSTEM_USER_TOKEN` | Token generado en Configuración del negocio → Usuarios del sistema para la app del panel |
| `META_GRAPH_VERSION` | Versión Graph habilitada por la app; por defecto v27.0 |
| `YOUTUBE_CHANNEL_ID` | ID del canal propio de YouTube |
| `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN` | Token renovable ya existente; conecta YouTube sin crear una app OAuth nueva |
| `YOUTUBE_AUTH_MODE` | Opcional: `oauth` fuerza el flujo con `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Solo para el OAuth alternativo; habilitar YouTube Data API y YouTube Analytics API |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Login Kit, `video.upload`, `video.list`, `user.info.basic`, `user.info.stats` |
| `TIKTOK_ENV` | `sandbox` para reutilizar la app de pruebas de GTA; sin definir usa producción |
| `TIKTOK_SANDBOX_CLIENT_KEY`, `TIKTOK_SANDBOX_CLIENT_SECRET` | Claves de la app sandbox existente; para métricas requiere `user.info.basic`, `user.info.stats` y `video.list` habilitados en ese sandbox y una nueva autorización de la cuenta. También solicita `video.upload` para el envío al Inbox. |
| `BUFFER_API_KEY`, `BUFFER_CHANNEL_ID`, `BUFFER_ORGANIZATION_ID` | Integración personal de Buffer; canal de X y organización para métricas |
| `PUBLICACION_ACTIVA` | Dejar sin definir durante la configuración; `1` habilita el procesamiento de los envíos aprobados |

Los callbacks OAuth son `https://ORIGEN/api/conexion/meta`,
`https://ORIGEN/api/conexion/google` y `https://ORIGEN/api/conexion/tiktok`.
Registrar cada uno en su proveedor y conectar desde el panel. Buffer usa su clave
personal de API en el servidor; el botón comprueba su acceso, no pide contraseñas.
No rotar la clave de cifrado sin migrar antes los tokens existentes o reconectar.

Cuando existe `META_SYSTEM_USER_TOKEN` (o `META_AUTH_MODE=system_user`), Meta no pasa por el OAuth del panel. El botón
Conectar/Reconectar lee `META_SYSTEM_USER_TOKEN` desde Vercel, comprueba con
`/debug_token` que pertenezca a la app (`META_APP_ID`), que sea de tipo
`SYSTEM_USER` y que esté vigente; después verifica el acceso a `META_PAGE_ID` y
a la cuenta de Instagram de negocio vinculada. Solo guarda el token de página
cifrado: no publica ni modifica nada en Meta durante la comprobación. Al
rotar el token del usuario del sistema, actualizar el secreto en Vercel y
tocar Reconectar en el panel.

Permisos del usuario del sistema, en la pestaña «Permisos de la app»:

- Imprescindibles para publicar: `pages_show_list`, `pages_manage_posts`,
  `instagram_basic`, `instagram_content_publish`. Si falta alguno, Conectar
  devuelve el nombre del permiso y no guarda la conexión.
- Métricas: `pages_read_engagement`, `instagram_manage_insights`,
  `read_insights`. Si faltan, la conexión funciona y el panel enumera cuáles
  faltan junto a la tarjeta de Instagram/Facebook.

X usa `BUFFER_API_KEY` con el canal y la organización ya configurados. El botón
Conectar solo consulta el canal en Buffer: si la clave falta, la tarjeta dice
qué variable hace falta y no publica nada.

YouTube reutiliza el token renovable de `gta-publicador`: con `YT_CLIENT_ID`,
`YT_CLIENT_SECRET` y `YT_REFRESH_TOKEN`, Conectar renueva el acceso, comprueba
que pertenezca a `YOUTUBE_CHANNEL_ID` y guarda el acceso cifrado. No sube
videos. Cuando el acceso vence, el panel lo renueva solo con esas mismas
variables. Para usar un OAuth nuevo en su lugar, configurar
`YOUTUBE_AUTH_MODE=oauth` junto con `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

Si no se conserva el `YT_REFRESH_TOKEN` original, se genera uno nuevo sin que el
valor pase por el chat: descargar de Google Cloud Console el `client_secret_*.json`
de la app de escritorio que ya usa el equipo y correr en la compu, con `vercel` y
`gh` logueados:

```bash
python3 app/herramientas/youtube_token_vercel.py ruta/client_secret_XXXX.json
```

Abre el navegador, autoriza con la cuenta dueña del canal y confirma el canal
mostrado. El script verifica el canal, manda el token a Vercel Production como
secreto por stdin y dispara el workflow Verificar. Imprime solo el nombre del
canal y el resultado; nunca muestra el token. Para cargar el token sin disparar
el deploy, agregar `--sin-deploy`. Si se conoce el ID del canal, se puede pasar
`--canal UC...` y se comprueba automáticamente. El `client_secret_*.json` se puede
borrar al terminar.

TikTok ya se preparó en `gta-publicador` con una app sandbox y un callback de
GitHub Pages. Para autorizar desde este panel, agregar también
`https://gta6-equipo.vercel.app/api/conexion/tiktok` en Login Kit de esa misma app.
Los secretos de GitHub no se pueden descargar; sus refresh tokens no se importan
ni se rotan durante la configuración del panel. La autorización se hace de nuevo
desde Conectar usando las claves existentes. Sandbox no equivale a producción
aprobada; no habilitar envíos automáticos al preparar esta conexión de prueba.

3. Actualizar las herramientas con `equipo.py herramientas`. Para Twitch y Kick,
   preparar Whisper una vez con `procesar.py preparar-whisper`; requiere un
   Python compatible, preferentemente 3.12. En Mac: `brew install python@3.12`.
4. Importar las fuentes desde Cuentas a rastrear. El rastreo automático se activa
   individualmente; los perfiles tienen un intervalo mínimo de seis horas.
5. Probar una sugerencia y revisar su material antes de aprobar. Cada compu con
   el motor activo toma solo los trabajos que pidió su usuario y los envíos que aprobó;
   el botón Procesar próximo envío permite avanzar un paso desde el panel.
   Si esa compu está apagada u ocupada, sus pedidos esperan allí. Otra compu no los toma.
6. Recién después de conectar y probar las cuentas, habilitar los envíos. Las
   pruebas automáticas usan respuestas simuladas y nunca publican contenido real.

Instagram y Facebook usan Graph API. X usa Buffer GraphQL. YouTube siempre sube
privado; TikTok envía al Inbox para completar manualmente. Los proyectos de
YouTube sin auditoría pueden mantener el video bloqueado como privado: la
alternativa manual es subir el archivo desde YouTube Studio. No se cambia la
visibilidad por API. El texto de TikTok se termina de editar en su Inbox.

Las métricas ausentes se representan sin valor. TikTok expone contadores
acumulados de videos recientes, no ganancias de una ventana; YouTube Analytics
informa por día cerrado. Las limitaciones se muestran junto al informe. El
histórico depende de lo que conserva y permite consultar cada proveedor.

Referencias oficiales:

- https://developers.facebook.com/documentation/video-api/guides/reels-publishing
- https://developers.buffer.com/guides/rest-migration.html
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://developers.google.com/youtube/analytics/sample-requests
- https://developers.tiktok.com/docs/en/content-posting-api-get-started-upload-content

## Calidad de video antes de encolar

Conservá el máster en resolución original. El piso de entrega es 720 × 1280
en vertical o 1280 × 720 en horizontal. Si supera los 14 MiB del flujo actual
de YouTube o TikTok, prepará una variante con los momentos más relevantes.
Preferí cortes sin recodificación cuando sean posibles y comprobá tamaño y
reproducción antes de aprobar. Si el texto enumera momentos, actualizalo para
que coincida con la variante.
