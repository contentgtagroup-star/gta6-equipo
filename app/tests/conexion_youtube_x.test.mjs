import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/conexion/[proveedor].js'
import { cifrarConexion, descifrarConexion, estadosConexiones, tokenConexion } from '../lib/conexiones.js'

const clave = 'clave-de-equipo-para-pruebas-youtube'
const secreto = 'yt-cliente-secreto-privado', refresh = 'yt-refresh-privado', claveBuffer = 'buffer-privado'
const original = globalThis.fetch
let filas, llamadas, canales, acceso, falloToken, falloCanal, falloBuffer
function reset () {
  Object.assign(process.env, { SUPABASE_URL: 'https://yt-test.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: JSON.stringify({ Cuervo: clave }), PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLICACION_ORIGIN: 'https://panel.example', YOUTUBE_CHANNEL_ID: 'canal-correcto', YT_CLIENT_ID: 'yt-id', YT_CLIENT_SECRET: secreto, YT_REFRESH_TOKEN: refresh, BUFFER_API_KEY: claveBuffer, BUFFER_CHANNEL_ID: 'canal-x', BUFFER_ORGANIZATION_ID: 'org-x' })
  delete process.env.YOUTUBE_AUTH_MODE; delete process.env.GOOGLE_AUTH_MODE
  filas = []; llamadas = []; falloToken = false; falloCanal = false; falloBuffer = false
  acceso = 'yt-access-privado'
  canales = { items: [{ id: 'canal-correcto', snippet: { title: 'Clips GTA 6' } }] }
}
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url), method = opciones.method || 'GET'
  llamadas.push({ u, method, headers: opciones.headers, body: opciones.body })
  if (u.hostname === 'oauth2.googleapis.com') {
    assert.equal(method, 'POST', 'La renovación de YouTube va como formulario')
    if (falloToken) return respuesta({ error: 'invalid_grant' }, 400)
    return respuesta({ access_token: acceso, expires_in: 3600 })
  }
  if (u.hostname === 'www.googleapis.com') {
    assert.equal(method, 'GET', 'Comprobar el canal nunca modifica YouTube')
    if (falloCanal) return respuesta({ error: { code: 403 } }, 403)
    return respuesta(canales)
  }
  if (u.hostname === 'api.buffer.com') {
    assert.equal(method, 'POST')
    if (falloBuffer) return respuesta({ errors: [{ message: 'Cannot query field isDisconnected on type Channel.' }] })
    return respuesta({ data: { channels: [{ id: 'canal-x', name: '@Gta6univers0', service: 'twitter', isQueuePaused: false }] } })
  }
  assert.equal(u.hostname, 'yt-test.supabase.co', 'No se permite acceso a servicios reales')
  const coincide = d => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(d[k]) === v.slice(3))
  let datos = filas.filter(coincide)
  if (method === 'POST') { const d = JSON.parse(opciones.body); filas.push(d); datos = [d] }
  if (method === 'PATCH') { const d = JSON.parse(opciones.body); for (const f of datos) Object.assign(f, d) }
  return respuesta(datos)
}
test.after(() => { globalThis.fetch = original })
async function conectar (proveedor, autorizado = true) {
  let body
  const headers = {}
  const res = { setHeader(k, v) { headers[k] = v }, status(c) { this.codigo = c; return this }, json(d) { body = d } }
  await handler({ method: 'POST', query: { proveedor }, headers: autorizado ? { 'x-clave': clave } : {}, body: { op: 'iniciar' } }, res)
  return { codigo: res.codigo, body, headers }
}
const guardada = id => filas.find(d => d.coleccion === 'conexiones' && d.id === id)

test('YouTube con token renovable verifica el canal, guarda cifrado y no abre OAuth', async () => {
  reset()
  const r = await conectar('google')
  assert.equal(r.codigo, 200)
  assert.equal(r.body.metodo, 'refresh_token')
  assert.equal(r.body.url, undefined)
  assert.equal(r.headers['Set-Cookie'], undefined)
  assert.equal(llamadas.filter(x => x.u.hostname !== 'yt-test.supabase.co').length, 2)
  const registro = guardada('google')
  const t = descifrarConexion('google', registro.datos.sobre)
  assert.equal(t.access_token, 'yt-access-privado')
  assert.equal(t.channel_id, 'canal-correcto')
  assert.equal(t.origen, 'refresh_token')
  const estados = await estadosConexiones()
  assert.equal(estados.find(c => c.id === 'youtube').estado, 'conectada')
  assert.equal(estados.find(c => c.id === 'youtube').metodo, 'refresh_token')
  assert.doesNotMatch(JSON.stringify([r, filas, estados]), /yt-access-privado|yt-refresh-privado|yt-cliente-secreto-privado/)
})
test('YouTube sin secretos dice cuáles faltan y no llama a Google ni guarda', async () => {
  reset(); delete process.env.YT_CLIENT_SECRET
  const r = await conectar('google')
  assert.equal(r.codigo, 503)
  assert.match(r.body.error, /YT_CLIENT_SECRET/)
  assert.equal(llamadas.some(x => x.u.hostname !== 'yt-test.supabase.co'), false)
  assert.equal(guardada('google'), undefined)
})
test('un token que no da acceso al canal configurado no se guarda', async () => {
  reset(); canales = { items: [{ id: 'otro-canal', snippet: { title: 'Otro canal' } }] }
  const r = await conectar('google')
  assert.equal(r.codigo, 424)
  assert.equal(guardada('google'), undefined)
  assert.doesNotMatch(JSON.stringify(r), /yt-access-privado|yt-refresh-privado/)
})
test('un fallo de Google no filtra secretos ni deja una conexión a medias', async () => {
  for (const modo of ['token', 'canal']) {
    reset()
    if (modo === 'token') falloToken = true; else falloCanal = true
    const r = await conectar('google')
    assert.ok(r.codigo >= 400)
    assert.doesNotMatch(JSON.stringify(r), /yt-access-privado|yt-refresh-privado|yt-cliente-secreto-privado/)
    assert.equal(guardada('google'), undefined)
  }
})
test('el acceso vencido de YouTube se renueva con las variables de Vercel', async () => {
  reset(); await conectar('google')
  const registro = guardada('google')
  registro.datos.sobre = cifrarConexion('google', { ...descifrarConexion('google', registro.datos.sobre), expira_el: 1 })
  acceso = 'yt-access-rotado'
  const t = await tokenConexion('google')
  assert.equal(t.access_token, 'yt-access-rotado')
  const inspeccion = llamadas.filter(x => x.u.hostname === 'oauth2.googleapis.com').at(-1)
  assert.equal(inspeccion.body.get('refresh_token'), refresh)
  assert.doesNotMatch(JSON.stringify(filas), /yt-refresh-privado/)
})
test('X conecta con Buffer y sin la clave dice qué variable falta', async () => {
  reset()
  assert.equal((await conectar('buffer')).codigo, 200)
  const consulta = JSON.stringify(llamadas.find(x => x.u.hostname === 'api.buffer.com').body)
  assert.match(consulta, /channels\(input/)
  assert.doesNotMatch(consulta, /isDisconnected|isLocked/)
  assert.equal((await tokenConexion('buffer')).access_token, claveBuffer)
  assert.equal((await estadosConexiones()).find(c => c.id === 'x').estado, 'conectada')
  reset(); delete process.env.BUFFER_API_KEY
  const r = await conectar('buffer')
  assert.equal(r.codigo, 424)
  assert.match(r.body.error, /BUFFER_API_KEY/)
  const x = (await estadosConexiones()).find(c => c.id === 'x')
  assert.equal(x.falta_config, 'BUFFER_API_KEY')
})
test('un error de GraphQL de Buffer se muestra sin filtrar la clave', async () => {
  reset(); falloBuffer = true
  const r = await conectar('buffer')
  assert.equal(r.codigo, 502)
  assert.match(r.body.error, /Buffer rechazó la consulta: Cannot query field/)
  assert.doesNotMatch(JSON.stringify(r), /buffer-privado/)
  assert.equal(guardada('buffer'), undefined)
})
test('sin sesión del equipo no se leen tokens de YouTube ni de Buffer', async () => {
  reset()
  for (const proveedor of ['google', 'buffer']) {
    assert.equal((await conectar(proveedor, false)).codigo, 401)
  }
  assert.equal(llamadas.length, 0)
})
