import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/conexion/[proveedor].js'
import { descifrarConexion, estadosConexiones, tokenConexion } from '../lib/conexiones.js'

const clave = 'clave-de-equipo-para-pruebas-meta'
const permisos = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'read_insights']
const token = 'token-sistema-privado', paginaToken = 'token-pagina-privado'
const original = globalThis.fetch
let filas, llamadas, debug, pagina, fallo, sinPerfil
function reset () {
  Object.assign(process.env, { SUPABASE_URL: 'https://meta-test.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: JSON.stringify({ Cuervo: clave }), PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 7).toString('base64'), PUBLICACION_ORIGIN: 'https://panel.example', META_AUTH_MODE: 'system_user', META_APP_ID: '123', META_APP_SECRET: 'secreto-app-privado', META_PAGE_ID: '456', META_SYSTEM_USER_TOKEN: token })
  filas = []; llamadas = []; fallo = null; sinPerfil = false
  debug = { is_valid: true, app_id: '123', type: 'SYSTEM_USER', user_id: '789', scopes: [...permisos], expires_at: Math.floor(Date.now() / 1000) + 3600, data_access_expires_at: 0 }
  pagina = { id: '456', name: 'Gta 6 Clipeados', access_token: paginaToken, instagram_business_account: { id: '987' } }
}
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url), method = opciones.method || 'GET'
  llamadas.push({ u, method, headers: opciones.headers })
  if (u.hostname === 'graph.facebook.com') {
    assert.equal(method, 'GET', 'Conectar nunca publica ni cambia activos en Meta')
    if (fallo) return respuesta({ error: { message: token + ' ' + paginaToken, code: 190 } }, fallo)
    if (u.pathname.endsWith('/debug_token')) return respuesta({ data: debug })
    if (u.pathname.endsWith('/456')) return respuesta(pagina)
    if (u.pathname.endsWith('/987')) return sinPerfil ? respuesta({ error: { code: 200, message: token } }, 403) : respuesta({ id: '987', username: 'gta6clipeados' })
    throw new Error('Endpoint de Meta no esperado')
  }
  assert.equal(u.hostname, 'meta-test.supabase.co', 'No se permite acceso a servicios reales')
  assert.match(u.pathname, /publicacion_docs$/)
  const coincide = d => [...u.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(d[k]) === v.slice(3))
  let datos = filas.filter(coincide)
  if (method === 'POST') { const d = JSON.parse(opciones.body); filas.push(d); datos = [d] }
  if (method === 'PATCH') { const d = JSON.parse(opciones.body); for (const f of datos) Object.assign(f, d) }
  return respuesta(datos)
}
test.after(() => { globalThis.fetch = original })
async function conectar (autorizado = true) {
  let body
  const headers = {}
  const res = { setHeader(k, v) { headers[k] = v }, status(c) { this.codigo = c; return this }, json(d) { body = d } }
  await handler({ method: 'POST', query: { proveedor: 'meta' }, headers: autorizado ? { 'x-clave': clave } : {}, body: { op: 'iniciar' } }, res)
  return { codigo: res.codigo, body, headers }
}
const guardada = () => filas.find(d => d.coleccion === 'conexiones' && d.id === 'meta')

test('System User valida la app y la página, guarda cifrado y conecta sin OAuth ni publicaciones', async () => {
  reset()
  const r = await conectar()
  assert.equal(r.codigo, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.url, undefined)
  assert.equal(r.headers['Set-Cookie'], undefined)
  assert.equal(llamadas.filter(x => x.u.hostname === 'graph.facebook.com').length, 3)
  const registro = guardada()
  assert.equal(registro.datos.origen, 'system_user')
  const t = descifrarConexion('meta', registro.datos.sobre)
  assert.equal(t.access_token, paginaToken)
  assert.equal(t.page_id, '456')
  assert.equal(t.ig_id, '987')
  assert.equal(t.origen, 'system_user')
  assert.equal(t.expira_el, debug.expires_at * 1000)
  assert.equal((await tokenConexion('meta')).access_token, paginaToken)
  const estados = (await estadosConexiones()).filter(c => c.proveedor === 'meta')
  assert.ok(estados.every(c => c.estado === 'conectada' && c.metodo === 'system_user'))
  assert.doesNotMatch(JSON.stringify([r, filas, estados]), /token-sistema-privado|token-pagina-privado|secreto-app-privado/)
})
test('exige sesión del equipo antes de leer tokens o llamar a Meta', async () => {
  reset()
  assert.equal((await conectar(false)).codigo, 401)
  assert.equal(llamadas.length, 0)
  assert.equal(filas.length, 0)
})
test('System User sin token informa la variable faltante y no vuelve a OAuth', async () => {
  reset(); delete process.env.META_SYSTEM_USER_TOKEN
  const r = await conectar()
  assert.equal(r.codigo, 503)
  assert.match(r.body.error, /META_SYSTEM_USER_TOKEN/)
  assert.equal(llamadas.length, 0)
})
test('rechaza token inválido, de otra app, de usuario personal o vencido antes de guardar', async () => {
  for (const cambio of [{ is_valid: false }, { app_id: 'otra' }, { type: 'USER' }, { expires_at: 1 }, { data_access_expires_at: 1 }]) {
    reset(); Object.assign(debug, cambio)
    const r = await conectar()
    assert.equal(r.codigo, 424, JSON.stringify(cambio))
    assert.equal(guardada(), undefined)
    assert.doesNotMatch(JSON.stringify(r), /token-sistema-privado|secreto-app-privado/)
  }
})
test('explica los permisos faltantes y no guarda una conexión sin autorización de publicación', async () => {
  reset(); debug.scopes = ['pages_show_list']
  const r = await conectar()
  assert.equal(r.codigo, 424)
  assert.match(r.body.error, /pages_manage_posts/)
  assert.equal(guardada(), undefined)
})
test('rechaza página equivocada o sin token de página', async () => {
  for (const cambio of [{ id: 'otra' }, { access_token: '' }]) {
    reset(); Object.assign(pagina, cambio)
    const r = await conectar()
    assert.equal(r.codigo, 424)
    assert.equal(guardada(), undefined)
  }
})
test('permite Facebook sin Instagram y no muestra Instagram como conectado', async () => {
  reset(); delete pagina.instagram_business_account
  assert.equal((await conectar()).codigo, 200)
  const estados = await estadosConexiones()
  assert.equal(estados.find(c => c.id === 'facebook').estado, 'conectada')
  assert.equal(estados.find(c => c.id === 'instagram').estado, 'sin_conectar')
})
test('un rechazo de Meta o Instagram no filtra tokens ni reemplaza una conexión previa', async () => {
  for (const modo of ['meta', 'instagram']) {
    reset()
    assert.equal((await conectar()).codigo, 200)
    const antes = JSON.stringify(guardada())
    if (modo === 'meta') fallo = 400; else sinPerfil = true
    const r = await conectar()
    assert.ok(r.codigo >= 400)
    assert.doesNotMatch(JSON.stringify(r), /token-sistema-privado|token-pagina-privado|secreto-app-privado/)
    assert.equal(JSON.stringify(guardada()), antes)
  }
})
test('un token sin vencimiento declarado conserva expiración nula', async () => {
  reset(); debug.expires_at = 0
  assert.equal((await conectar()).codigo, 200)
  assert.equal(descifrarConexion('meta', guardada().datos.sobre).expira_el, null)
})
test('renovar relee el secreto de Vercel y reemplaza los accesos cifrados sin duplicar la conexión', async () => {
  reset(); await conectar()
  process.env.META_SYSTEM_USER_TOKEN = 'token-sistema-rotado'
  pagina.access_token = 'token-pagina-rotado'
  assert.equal((await conectar()).codigo, 200)
  assert.equal(filas.filter(d => d.coleccion === 'conexiones' && d.id === 'meta').length, 1)
  assert.equal((await tokenConexion('meta')).access_token, 'token-pagina-rotado')
  const inspeccion = llamadas.filter(x => x.u.pathname.endsWith('/debug_token')).at(-1)
  assert.equal(inspeccion.u.searchParams.get('input_token'), 'token-sistema-rotado')
})
test('sin META_AUTH_MODE usa el token del sistema en vez de volver a OAuth', async () => {
  reset(); delete process.env.META_AUTH_MODE
  const r = await conectar()
  assert.equal(r.codigo, 200)
  assert.equal(r.body.url, undefined)
  assert.equal(r.headers['Set-Cookie'], undefined)
  assert.equal(guardada().datos.origen, 'system_user')
})
test('Meta ya conectado con usuario del sistema no vuelve a OAuth si falta el token del servidor', async () => {
  reset(); await conectar()
  delete process.env.META_AUTH_MODE; delete process.env.META_SYSTEM_USER_TOKEN
  const r = await conectar()
  assert.equal(r.codigo, 503)
  assert.match(r.body.error, /META_SYSTEM_USER_TOKEN/)
  assert.equal(r.body.url, undefined)
  assert.equal((await estadosConexiones()).find(c => c.id === 'facebook').estado, 'config_incompleta')
})
test('META_AUTH_MODE=oauth fuerza el flujo anterior aunque exista el token', async () => {
  reset(); process.env.META_AUTH_MODE = 'oauth'
  const r = await conectar()
  assert.equal(r.codigo, 200)
  assert.match(r.body.url, /facebook\.com.*\/dialog\/oauth/)
  assert.equal(llamadas.some(x => x.u.hostname === 'graph.facebook.com'), false)
  assert.equal(guardada(), undefined)
})
