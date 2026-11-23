import test from 'node:test'
import assert from 'node:assert/strict'
import { leerDeployment, registrarPreview } from './preview.mjs'

const sha = 'a'.repeat(40)
const deployment = { status: 'ok', deployment: { readyState: 'READY', target: null, url: 'https://gta6-equipo-prueba-synkcc-2206s-projects.vercel.app' } }
const env = { GITHUB_REPOSITORY: 'contentgtagroup-star/gta6-equipo', GTA_PREVIEW_PR: '6', GTA_PREVIEW_SHA: sha, GH_TOKEN: 'github-fixture', VERCEL_TOKEN: 'vercel-fixture', GTA_PREVIEW_REVIEWER_EMAIL: 'revisor@example.com' }
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })

test('lee JSON de Vercel y rechaza producción, errores y URLs ajenas', () => {
  assert.equal(leerDeployment(deployment).hostname, new URL(deployment.deployment.url).hostname)
  assert.equal(leerDeployment(deployment.deployment).url, deployment.deployment.url)
  for (const cambio of [{ target: 'production' }, { readyState: 'ERROR' }, { url: 'https://otra-app.vercel.app' }, { url: 'https://gta6-equipo-prueba.vercel.app/?token=fixture' }]) {
    assert.throws(() => leerDeployment({ deployment: { ...deployment.deployment, ...cambio } }))
  }
  assert.throws(() => leerDeployment({ ...deployment, status: 'error' }))
})
test('concede acceso solo al revisor del deployment y crea el enlace sin revelar credenciales', async () => {
  const llamadas = []
  const salida = await registrarPreview(deployment, env, async (url, opciones) => {
    llamadas.push({ url, opciones })
    if (url.includes('/pulls/')) return respuesta({ head: { sha }, state: 'open' })
    if (opciones.method === 'GET') return respuesta([])
    return respuesta({ ok: true })
  })
  assert.equal(salida.url, deployment.deployment.url)
  const permiso = llamadas.find(x => x.url.startsWith('https://api.vercel.com/'))
  assert.ok(permiso.url.includes('/aliases/' + new URL(salida.url).hostname + '/protection-bypass?'))
  assert.deepEqual(JSON.parse(permiso.opciones.body), { scope: { email: env.GTA_PREVIEW_REVIEWER_EMAIL, access: 'granted' } })
  const comentario = llamadas.at(-1)
  assert.equal(comentario.opciones.method, 'POST')
  for (const secreto of [env.GH_TOKEN, env.VERCEL_TOKEN, env.GTA_PREVIEW_REVIEWER_EMAIL]) assert.ok(!comentario.opciones.body.includes(secreto))
})
test('actualiza el comentario propio y no duplica ni modifica comentarios de personas', async () => {
  const llamadas = []
  await registrarPreview(deployment, env, async (url, opciones) => {
    llamadas.push({ url, opciones })
    if (url.includes('/pulls/')) return respuesta({ head: { sha }, state: 'open' })
    if (opciones.method === 'GET') return respuesta([
      { id: 1, user: { login: 'persona' }, body: '<!-- gta6-preview -->' },
      { id: 2, user: { login: 'github-actions[bot]' }, body: '<!-- gta6-preview -->' }
    ])
    return respuesta({ ok: true })
  })
  assert.ok(llamadas.at(-1).url.endsWith('/issues/comments/2'))
  assert.equal(llamadas.at(-1).opciones.method, 'PATCH')
})
test('un commit viejo o un PR cerrado no pisan el preview actual', async () => {
  for (const actual of [{ head: { sha: 'b'.repeat(40) }, state: 'open' }, { head: { sha }, state: 'closed' }]) {
    let n = 0
    assert.deepEqual(await registrarPreview(deployment, env, async () => { n++; return respuesta(actual) }), { anterior: true })
    assert.equal(n, 1)
  }
})
test('si Vercel rechaza el acceso no publica un enlace como si estuviera habilitado', async () => {
  let n = 0
  await assert.rejects(registrarPreview(deployment, env, async () => {
    n++; return n === 1 ? respuesta({ head: { sha }, state: 'open' }) : respuesta({ error: 'fixture' }, 403)
  }), /Vercel.*HTTP 403/)
  assert.equal(n, 2)
})
