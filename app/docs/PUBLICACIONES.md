# Configuración de publicaciones

1. Ejecutar `supabase/migrations/202611220001_publicaciones.sql` en el proyecto
   Supabase del equipo. La tabla nueva solo admite acceso del servidor.
2. Configurar en Vercel, sin subir los valores al repositorio:

| Variable | Uso |
| --- | --- |
| `PUBLICACION_ORIGIN` | Origen HTTPS del panel, sin barra final |
| `PUBLICACION_CIPHER_KEY` | Clave aleatoria de 32 bytes codificada en base64 para cifrar los tokens guardados |
| `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID` | App Business y página autorizada de Meta |
| `META_GRAPH_VERSION` | Versión Graph habilitada por la app; por defecto v27.0 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_CHANNEL_ID` | OAuth del canal; habilitar YouTube Data API y YouTube Analytics API |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Login Kit, `video.upload`, `video.list`, `user.info.basic`, `user.info.stats` |
| `BUFFER_API_KEY`, `BUFFER_CHANNEL_ID`, `BUFFER_ORGANIZATION_ID` | Integración personal de Buffer; canal de X y organización para métricas |
| `PUBLICACION_ACTIVA` | Dejar sin definir durante la configuración; `1` habilita el procesamiento de los envíos aprobados |

Los callbacks OAuth son `https://ORIGEN/api/conexion/meta`,
`https://ORIGEN/api/conexion/google` y `https://ORIGEN/api/conexion/tiktok`.
Registrar cada uno en su proveedor y conectar desde el panel. Buffer usa su clave
personal de API en el servidor; el botón comprueba su acceso, no pide contraseñas.
No rotar la clave de cifrado sin migrar antes los tokens existentes o reconectar.

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
