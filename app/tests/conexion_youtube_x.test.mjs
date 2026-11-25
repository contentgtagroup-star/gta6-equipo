import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/conexion/[proveedor].js'
import { cifrarConexion, descifrarConexion, estadosConexiones, tokenConexion } from '../lib/conexiones.js'

const clave = 'clave-de-equipo-para-pruebas-youtube'
const secreto = 'yt-cliente-secreto-privado', refresh = 'yt-refresh-privado', claveBuffer = 'buffer-privado'
const original = globalThis.fetch
let filas, llamadas, canales, acceso, falloToken, falloCanal, falloBuffer, pausaBuffer, tiktokOpenId
function reset () {
  Object.assign(process.env, { SUPABASE_URL: 'https://yt-test.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: JSON.stringify({ Cuervo: clave }), PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 9).toString('base64'), PUBLICACION_ORIGIN: 'https://panel.example', YOUTUBE_CHANNEL_ID: 'canal-correcto', YT_CLIENT_ID: 'yt-id', YT_CLIENT_SECRET: secreto, YT_REFRESH_TOKEN: refresh, BUFFER_API_KEY: claveBuffer, BUFFER_CHANNEL_ID: 'canal-x', BUFFER_ORGANIZATION_ID: 'org-x' })
  delete process.env.YOUTUBE_AUTH_MODE; delete process.env.GOOGLE_AUTH_MODE
  delete process.env.TIKTOK_ENV; delete process.env.TIKTOK_SANDBOX_CLIENT_KEY; delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET
  filas = []; llamadas = []; falloToken = false; falloCanal = false; falloBuffer = false; pausaBuffer = false; tiktokOpenId = 'tt-correcto'
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
    return respuesta({ data: { channels: [{ id: 'canal-x', name: '@Gta6univers0', service: 'twitter', isQueuePaused: pausaBuffer }] } })
  }
  if (u.hostname === 'open.tiktokapis.com') {
    if (u.pathname.includes('/user/info/')) return respuesta({ data: { user: { open_id: tiktokOpenId, display_name: 'TikTok GTA 6' } }, error: { code: 'ok' } })
    return respuesta({ access_token: 'tt-nuevo', refresh_token: 'tt-refresh-nuevo', expires_in: 7200, refresh_expires_in: 100000, error: { code: 'ok' } })
  }
  assert.equal(u.hostname, 'yt-test.supabase.co', 'No se permite acceso a servicios reales')
  const coincide = d => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(d[k]) === v.slice(3))
  let datos = filas.filter(coincide)
  if (method === 'POST') { const d = JSON.parse(opciones.body); filas.push(d); datos = [d] }
  if (method === 'PATCH') { const d = JSON.parse(opciones.body); for (const f of datos) Object.assign(f, d) }
  return respuesta(datos)
}
test.after(() => { globalThis.fetch = original })
async function conectar (proveedor, autorizado = true, op = 'iniciar') {
  let body
  const headers = {}
  const res = { setHeader(k, v) { headers[k] = v }, status(c) { this.codigo = c; return this }, json(d) { body = d } }
  await handler({ method: 'POST', query: { proveedor }, headers: autorizado ? { 'x-clave': clave } : {}, body: { op } }, res)
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
test('YouTube ya renovable no cambia a OAuth si falta un secreto del servidor', async () => {
  reset(); await conectar('google')
  delete process.env.YT_REFRESH_TOKEN
  const r = await conectar('google')
  assert.equal(r.codigo, 503)
  assert.match(r.body.error, /YT_REFRESH_TOKEN/)
  assert.equal(r.body.url, undefined)
  const estado = (await estadosConexiones()).find(c => c.id === 'youtube')
  assert.equal(estado.estado, 'config_incompleta')
  assert.match(estado.falta_config, /YT_REFRESH_TOKEN/)
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
test('YouTube renovable conserva estado conectado al vencer el acceso corto', async () => {
  reset(); await conectar('google')
  guardada('google').datos.expira_el = 1
  assert.equal((await estadosConexiones()).find(c => c.id === 'youtube').estado, 'conectada')
})
test('YouTube marca vencido solo cuando Google rechaza el refresh token', async () => {
  reset(); await conectar('google')
  const registro = guardada('google')
  registro.datos.sobre = cifrarConexion('google', { ...descifrarConexion('google', registro.datos.sobre), expira_el: 1 })
  falloToken = true
  await assert.rejects(tokenConexion('google'), /Reconectá el canal/)
  assert.equal((await estadosConexiones()).find(c => c.id === 'youtube').estado, 'token_vencido')
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
test('Buffer distingue cola pausada y organización faltante', async () => {
  reset(); pausaBuffer = true
  assert.equal((await conectar('buffer')).codigo, 200)
  assert.equal((await estadosConexiones()).find(c => c.id === 'x').estado, 'pausada')
  reset(); delete process.env.BUFFER_ORGANIZATION_ID
  const r = await conectar('buffer')
  assert.equal(r.codigo, 424)
  assert.match(r.body.error, /BUFFER_ORGANIZATION_ID/)
  assert.equal((await estadosConexiones()).find(c => c.id === 'x').falta_config, '')
})
test('TikTok renueva el acceso corto y conserva el refresh token rotado', async () => {
  reset()
  Object.assign(process.env, { TIKTOK_ENV: 'sandbox', TIKTOK_SANDBOX_CLIENT_KEY: 'tt-key', TIKTOK_SANDBOX_CLIENT_SECRET: 'tt-secret' })
  filas.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: { estado: 'conectada', expira_el: 1, refresh_expira_el: Date.now() + 100000,
    sobre: cifrarConexion('tiktok', { access_token: 'tt-viejo', refresh_token: 'tt-refresh-viejo', expira_el: 1, refresh_expira_el: Date.now() + 100000 }) } })
  assert.equal((await estadosConexiones()).find(c => c.id === 'tiktok').estado, 'conectada')
  const t = await tokenConexion('tiktok')
  assert.equal(t.access_token, 'tt-nuevo')
  assert.equal(descifrarConexion('tiktok', guardada('tiktok').datos.sobre).refresh_token, 'tt-refresh-nuevo')
  assert.equal((await estadosConexiones()).find(c => c.id === 'tiktok').estado, 'conectada')
})
test('TikTok distingue un refresh token vencido', async () => {
  reset()
  filas.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: { estado: 'conectada', expira_el: 1, refresh_expira_el: 1,
    sobre: cifrarConexion('tiktok', { access_token: 'tt-viejo', refresh_token: 'tt-refresh-viejo', expira_el: 1, refresh_expira_el: 1 }) } })
  assert.equal((await estadosConexiones()).find(c => c.id === 'tiktok').estado, 'token_vencido')
  await assert.rejects(tokenConexion('tiktok'), /Reconectá la cuenta/)
})
test('TikTok informa si faltan las credenciales de su sandbox', async () => {
  reset(); process.env.TIKTOK_ENV = 'sandbox'
  filas.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: { estado: 'conectada', sobre: cifrarConexion('tiktok', { access_token: 'tt', refresh_token: 'tt-refresh', expira_el: 1 }) } })
  const estado = (await estadosConexiones()).find(c => c.id === 'tiktok')
  assert.equal(estado.estado, 'config_incompleta')
  assert.match(estado.falta_config, /TIKTOK_SANDBOX_CLIENT_KEY/)
})
test('Verificar TikTok consulta la cuenta sin iniciar OAuth y rechaza otra identidad', async () => {
  reset()
  filas.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: { estado: 'conectada', cuenta: 'Anterior', expira_el: Date.now() + 3600000,
    sobre: cifrarConexion('tiktok', { access_token: 'tt-vigente', refresh_token: 'tt-refresh', open_id: 'tt-correcto', expira_el: Date.now() + 3600000 }) } })
  const r = await conectar('tiktok', true, 'verificar')
  assert.equal(r.codigo, 200)
  assert.equal(r.body.cuenta, 'TikTok GTA 6')
  assert.equal(r.body.url, undefined)
  assert.equal(guardada('tiktok').datos.cuenta, 'TikTok GTA 6')
  tiktokOpenId = 'otra-cuenta'
  const malo = await conectar('tiktok', true, 'verificar')
  assert.equal(malo.codigo, 424)
  assert.match(malo.body.error, /otra cuenta/)
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
