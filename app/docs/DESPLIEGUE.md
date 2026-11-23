# Despliegue de GTA desde GitHub

El workflow `Verificar` publica en el proyecto existente `gta6-equipo` al
integrar cambios a `main`, después de que pasen las pruebas Node y Python.
Los PR ejecutan pruebas; no publican en producción. También se puede ejecutar
manualmente desde Actions → Verificar → Run workflow, seleccionando `main`.

El job `Publicar GTA` ejecuta `vercel pull`, `vercel build --prod` y
`vercel deploy --prebuilt --prod`. La URL queda en el resumen y en el entorno
`gta6-produccion` de GitHub. Los despliegues se serializan para evitar que
dos ejecuciones publiquen a la vez.

## Configuración

- Proyecto: `prj_54G9WHv8ggngapNEXRDDB0GJ3FTE`.
- Equipo: `team_teuRF4rK0UsjEY2iUYw3ES4v`.
- Raíz configurada en Vercel: `app`.
- Secreto de Actions: `GTADEPLOY`, generado por el titular en
  https://vercel.com/account/settings/tokens y guardado exclusivamente como
  secreto de Actions en este repositorio. Elegir el menor alcance disponible
  que permita desplegar GTA. El workflow fija los IDs del proyecto y equipo.
- Las variables de la aplicación siguen administradas en Vercel.

Eze puede integrar sus PR y ejecutar el workflow con sus permisos de GitHub.
No necesita una membresía de equipo en Vercel para este flujo.

La conexión nativa Git de Vercel sigue pendiente de la autorización entre
cuentas. Este workflow permite producción sin depender de esa conexión.
Los previews automáticos de ramas no forman parte de este workflow.

Para activarlo, configurar primero `GTADEPLOY` y luego integrar el PR
del workflow. La sesión OAuth del CLI no permite crear ese token por API
(`Cannot create tokens for this app`). No pegar su valor en el chat ni en
archivos del repositorio.

Las migraciones de Supabase se ejecutan aparte; el despliegue no modifica
tablas ni archivos del bucket.

Referencia: https://vercel.com/docs/git/vercel-for-github#using-github-actions
