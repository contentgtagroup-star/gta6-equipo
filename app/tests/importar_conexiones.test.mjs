import test from 'node:test'
import assert from 'node:assert/strict'
import { importarConexiones } from '../lib/importar_conexiones.js'
import { tokenConexion, estadosConexiones, descifrarConexion } from '../lib/conexiones.js'

Object.assign(process.env, { SUPABASE_URL: 'https://importacion.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 7).toString('base64'), IMPORTACION_CONEXIONES_TOKEN: 'permiso-temporal-fixture', YOUTUBE_CHANNEL_ID: 'yt-equipo', BUFFER_CHANNEL_ID: 'x-equipo' })
delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET
const filas = [], llamadas = [], original = globalThis.fetch
let canalYT = 'yt-equipo'
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url); llamadas.push(u.hostname)
  if (u.hostname === 'oauth2.googleapis.com') {
    const body = new URLSearchParams(op.body)
    assert.equal(body.get('client_id'), 'cliente-fixture')
    assert.equal(body.get('client_secret'), 'secreto-fixture')
    assert.equal(body.get('refresh_token'), 'refresco-fixture')
    return respuesta({ access_token: 'acceso-fixture', expires_in: 3600 })
  }
  if (u.hostname === 'www.googleapis.com') return respuesta({ items: [{ id: canalYT, snippet: { title: 'GTA Universo' } }] })
  if (u.hostname === 'api.buffer.com') {
    assert.match(JSON.parse(op.body).query, /channel\(input: \{id:/)
    return respuesta({ data: { channel: { id: 'x-equipo', name: 'Gta6univers0', service: 'twitter', isLocked: false, isDisconnected: false } } })
  }
  assert.equal(u.hostname, 'importacion.supabase.co')
  const coincide = f => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(f[k]) === v.slice(3))
  let resultado = filas.filter(coincide)
  if (op.method === 'POST') {
    const f = JSON.parse(op.body)
    if (filas.some(x => x.id === f.id && x.coleccion === f.coleccion)) return respuesta({ code: '23505' }, 409)
    filas.push(f); resultado = [f]
  }
  if (op.method === 'PATCH') for (const f of resultado) Object.assign(f, JSON.parse(op.body))
  return respuesta(resultado)
}
const pedido = () => ({ method: 'POST', headers: { 'x-importacion': process.env.IMPORTACION_CONEXIONES_TOKEN }, body: { yt_client_id: 'cliente-fixture', yt_client_secret: 'secreto-fixture', yt_refresh_token: 'refresco-fixture', buffer_api_key: 'buffer-fixture' } })
function reset () { filas.length = 0; llamadas.length = 0; canalYT = 'yt-equipo' }
test('el puente exige el permiso temporal antes de consultar la base', async () => {
  reset()
  await assert.rejects(importarConexiones({ ...pedido(), headers: {} }), e => e.status === 403)
  assert.equal(llamadas.length, 0)
  const permiso = process.env.IMPORTACION_CONEXIONES_TOKEN; delete process.env.IMPORTACION_CONEXIONES_TOKEN
  await assert.rejects(importarConexiones(pedido()), e => e.status === 404)
  process.env.IMPORTACION_CONEXIONES_TOKEN = permiso
})
test('rechaza un canal ajeno sin guardar conexiones', async () => {
  reset(); canalYT = 'canal-ajeno'
  await assert.rejects(importarConexiones(pedido()), e => e.status === 424)
  assert.equal(filas.filter(f => f.coleccion === 'conexiones').length, 0)
})
test('importa una sola vez, cifra los accesos y renueva el cliente Desktop sin OAuth web', async () => {
  reset()
  const r = await importarConexiones(pedido())
  assert.deepEqual(r.cuentas, { youtube: 'GTA Universo', x: 'Gta6univers0' })
  for (const secreto of Object.values(pedido().body)) {
    assert.ok(!JSON.stringify(r).includes(secreto))
    assert.ok(!JSON.stringify(await estadosConexiones()).includes(secreto))
    assert.ok(!JSON.stringify(filas).includes(secreto))
  }
  const yt = filas.find(f => f.id === 'google')
  assert.equal(descifrarConexion('google', yt.datos.sobre).client_secret, 'secreto-fixture')
  assert.equal((await tokenConexion('buffer')).access_token, 'buffer-fixture')
  const n = llamadas.filter(h => h === 'oauth2.googleapis.com').length
  // Simula que ya pasó una hora sin alterar el contenido cifrado.
  const ahora = Date.now; Date.now = () => ahora() + 7200000
  try { assert.equal((await tokenConexion('google')).access_token, 'acceso-fixture') } finally { Date.now = ahora }
  assert.equal(llamadas.filter(h => h === 'oauth2.googleapis.com').length, n + 1)
  await assert.rejects(importarConexiones(pedido()), e => e.status === 409)
})
test.after(() => { globalThis.fetch = original })
