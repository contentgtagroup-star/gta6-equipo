# Despliegue de GTA desde GitHub

El workflow `Verificar` publica en el proyecto existente `gta6-equipo` al
integrar cambios a `main`, después de que pasen las pruebas Node y Python.
Los PR ejecutan pruebas y publican un preview. También se puede ejecutar
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
cuentas. Este workflow permite producción y previews sin depender de esa conexión.

## Previews de PR

Al abrir o actualizar un PR desde una rama de este repositorio, las pruebas
deben pasar antes de construir y publicar su preview. Aparece como check
`Preview del PR`, entorno `gta6-preview-N` y comentario con el enlace. El mismo
comentario se actualiza con cada commit. Los PR de forks no reciben credenciales
ni despliegues automáticos. Una ejecución vieja no pisa el enlace de un commit
nuevo o de un PR cerrado. El preview usa las variables Preview de Vercel.

`GTA_PREVIEW_REVIEWER_EMAIL` es un secreto de Actions con el correo de Vercel
del revisor. El flujo concede acceso personal a ese deployment; no publica
enlaces con tokens ni desactiva la protección del proyecto. Eze abre el enlace
con su cuenta de Vercel y usa su clave del panel. Los previews pueden usar la
base configurada en Preview; los cambios hechos dentro de la app se guardan
allí. El workflow de preview no ejecuta publicaciones ni migraciones.

Para activarlo, configurar primero `GTADEPLOY` y luego integrar el PR
del workflow. La sesión OAuth del CLI no permite crear ese token por API
(`Cannot create tokens for this app`). No pegar su valor en el chat ni en
archivos del repositorio.

Las migraciones de Supabase se ejecutan aparte; el despliegue no modifica
tablas ni archivos del bucket.

Referencia: https://vercel.com/docs/git/vercel-for-github#using-github-actions
