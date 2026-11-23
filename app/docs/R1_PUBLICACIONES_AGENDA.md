=== MENSAJE R1 — INTER-INSTANCIA ===
DE: Cuervo / Codex → A: Eze
TIPO: RESPUESTA
TEMA: X/YouTube y agenda compartida de hasta 6 shorts diarios
FECHA: 2026-11-23

CONTEXTO:
Los ajustes locales se trasladaron a una rama basada en main, con versión 52.
No están activados en producción. Las pruebas usan respuestas simuladas;
no se publicaron ni subieron clips reales durante esta preparación.

QUÉ TOCA:
- Rama app: ajustes/cuervo/publicaciones-agenda.
- Aprobación y cola: app/api/publicacion.js, publicacion_store.js,
  publicacion_worker.js, programacion.js y UI de Publicaciones.
- Conexiones: conexiones.js, api/conexion/[proveedor].js,
  importar_conexiones.js, publicar_redes.js y métrica de Buffer.
- No modifica equipo.py ni procesar.py. Cada PC conserva los pedidos y envíos
  de su usuario. No cambia nombres de campos existentes ni requiere SQL nuevo.
- Agrega programado_el y zona_horaria a los envíos. La agenda compartida vive
  en publicacion_docs, colección conexiones, id programacion-global, con CAS.

COMPORTAMIENTO:
- Aprobar un short reserva un horario en las redes conectadas. El límite es
  de 6 shorts por día para todo el equipo; cada short comparte horario entre
  sus destinos. No es un límite por persona.
- Seis franjas de 9 a 21 h de Argentina, minuto aleatorio y al menos 15 minutos
  de anticipación. Si un turno no empezó y venció más de 15 minutos, se
  reprograma. La cola anterior sin horario queda en espera.
- X usa Buffer y verifica el canal antes de enviar. YouTube conserva el cliente
  Desktop existente para renovar el acceso; sus credenciales quedan cifradas.
- YouTube sube privado y TikTok llega al Inbox: todavía requieren completar
  la publicación en su plataforma. Esta entrega no habilita Direct Post.
- El puente de importación está cerrado salvo que se configure un permiso
  temporal. Verifica los IDs de los canales y rechaza repeticiones exitosas.

ACCIÓN REQUERIDA:
1. Revisar e integrar el PR de app. Coordinar los cambios coincidentes de
   api/publicacion.js, public/publicaciones.js y CAMBIOS.json con generador-links.
2. Integrar el workflow manual del repositorio privado gta-publicador:
   https://github.com/contentgtagroup-star/gta-publicador/pull/1
3. Después del despliegue del panel, generar un permiso temporal y guardarlo
   por canal seguro como IMPORTACION_CONEXIONES_TOKEN en Vercel y
   GTA_PANEL_IMPORT_TOKEN en los secretos del publicador. No pegarlo en R1.
4. Ejecutar Importar conexiones al panel GTA una sola vez. Confirmar las cuentas
   en Publicaciones y retirar ambos permisos temporales. No recrear las apps.
5. Conectar/verificar los destinos y habilitar PUBLICACION_ACTIVA=1 solo cuando
   se decida empezar los envíos. Se usa la PC de quien aprobó cada short.

VALIDACIÓN:
- Local: 103 pruebas Node de app y 5 de infraestructura, todas correctas.
- Workflow privado: Python embebido compilado sin ejecutarlo.
- CI y preview del PR de app se verifican por separado antes de integrar.

REFERENCIAS:
- app/docs/PUBLICACIONES.md
- https://github.com/contentgtagroup-star/gta6-equipo/tree/ajustes/cuervo/publicaciones-agenda
- https://github.com/contentgtagroup-star/gta-publicador/pull/1
=== FIN R1 ===
