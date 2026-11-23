import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/publicacion.js'
import { procesarPublicaciones } from '../lib/publicacion_worker.js'
import { cifrarConexion, tokenConexion } from '../lib/conexiones.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: '{"Eze":"clave-de-prueba-suficientemente-larga"}', PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 2).toString('base64') })
const tablas = { docs: [], publicacion_docs: [] }, remotas = []
const original = globalThis.fetch
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  if (u.hostname === 'oauth2.googleapis.com') { remotas.push(u.href); return new Response('{"access_token":"fixture-renovado","refresh_token":"fixture-refresco","expires_in":3600}', { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  if (u.hostname !== 'unit.supabase.co') { remotas.push(u.href); throw new Error('La prueba no permite llamadas a redes.') }
  const tabla = tablas[u.pathname.split('/').at(-1)]
  assert.ok(tabla, u.pathname)
  const coincide = d => [...u.searchParams].every(([k, v]) => {
    if (v.startsWith('eq.')) return String(d[k]) === v.slice(3)
    if (k === 'datos->>estado' && v.startsWith('in.')) return v.slice(4, -1).split(',').includes(d.datos.estado)
    return true
  })
  const metodo = opciones.method || 'GET'
  let filas = tabla.filter(coincide)
  if (metodo === 'POST') {
    const dato = JSON.parse(opciones.body)
    if (tabla.some(d => d.id === dato.id && d.coleccion === dato.coleccion)) return new Response('{"code":"23505"}', { status: 409 })
    tabla.push(dato); filas = [dato]
  } else if (metodo === 'PATCH') {
    const cambios = JSON.parse(opciones.body)
    for (const d of filas) Object.assign(d, cambios)
  }
  const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 1000)
  return new Response(JSON.stringify(filas.slice(offset, offset + limit)), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
async function llamada(body, method = 'POST', clave = true) {
  let salida
  const res = { setHeader() {}, status(codigo) { this.codigo = codigo; return this }, json(datos) { salida = { codigo: this.codigo, datos } } }
  await handler({ method, query: {}, headers: clave ? { 'x-clave': 'clave-de-prueba-suficientemente-larga' } : {}, body }, res)
  return salida
}
function reset() { tablas.docs.length = 0; tablas.publicacion_docs.length = 0; remotas.length = 0; delete process.env.PUBLICACION_ACTIVA }
const sugerencia = () => ({ coleccion: 'sugerencias', id: 's1', version: 1, datos: { titulo: 'Una caja en GTA 6', descripcion: '¿Qué tiene adentro?', plataformas: ['instagram', 'youtube'], hashtags: ['#GTA6'], media: 'reusar', video_path: 'Eze/clip.mp4', imagenes: [], estado: 'pendiente', media_lista: true } })

test('publicaciones exige la clave del equipo antes de leer o escribir', async () => {
  reset(); assert.equal((await llamada({ op: 'importar_fuentes' }, 'POST', false)).codigo, 401)
  assert.equal(tablas.publicacion_docs.length, 0)
})
test('aprobar crea un envío por red y la repetición no duplica la cola', async () => {
  reset(); tablas.publicacion_docs.push(sugerencia())
  const a = await llamada({ op: 'aprobar', id: 's1', version: 1 })
  assert.equal(a.codigo, 200)
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 3 })).codigo, 200)
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola')
  assert.equal(cola.length, 2)
  assert.ok(cola.every(x => x.datos.aprobado_por === 'Eze'))
  assert.equal(remotas.length, 0)
})
test('no aprueba material sin revisar ni permite publicar imágenes como Short', async () => {
  reset(); const d = sugerencia(); d.datos.media_lista = false; tablas.publicacion_docs.push(d)
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 1 })).codigo, 422)
  d.datos.media_lista = true; d.datos.video_path = ''; d.datos.imagenes = ['Eze/uno.png']
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 1 })).codigo, 422)
  assert.equal(tablas.publicacion_docs.filter(x => x.coleccion === 'cola').length, 0)
})
test('una edición vieja no pisa la de otro integrante', async () => {
  reset(); const d = sugerencia(); tablas.publicacion_docs.push(d)
  assert.equal((await llamada({ op: 'sugerencia_guardar', id: 's1', version: 7, datos: d.datos })).codigo, 409)
  assert.equal(tablas.publicacion_docs[0].version, 1)
})
test('el worker apagado y los items sin aprobación nunca llaman redes', async () => {
  reset(); tablas.publicacion_docs.push({ coleccion: 'cola', id: 'uno', version: 1, datos: { estado: 'pendiente', plataforma: 'instagram' } })
  assert.equal((await procesarPublicaciones('Eze')).activo, false)
  process.env.PUBLICACION_ACTIVA = '1'
  await procesarPublicaciones('Eze')
  assert.equal(remotas.length, 0)
})
test('recupera una aprobación cortada antes de completar la cola sin duplicados', async () => {
  reset(); const s = sugerencia(); s.datos.estado = 'aprobada'; s.datos.aprobado_por = 'Eze'; tablas.publicacion_docs.push(s)
  await procesarPublicaciones('Eze')
  await procesarPublicaciones('Eze')
  assert.equal(tablas.publicacion_docs.filter(x => x.coleccion === 'cola').length, 2)
  assert.equal(tablas.publicacion_docs.filter(x => x.coleccion === 'eventos' && x.datos.accion === 'encolado').length, 2)
  assert.equal(remotas.length, 0)
})
test('un envío interrumpido queda para revisión sin repetir la publicación', async () => {
  reset(); process.env.PUBLICACION_ACTIVA = '1'
  tablas.publicacion_docs.push({ coleccion: 'cola', id: 'uno', version: 1, datos: { estado: 'enviando', aprobado_por: 'Eze', vence: 1, plataforma: 'x', etapa: 'publicando' } })
  await procesarPublicaciones('Eze')
  assert.equal(tablas.publicacion_docs.find(x => x.id === 'uno').datos.estado, 'revisar')
  assert.equal(remotas.length, 0)
})
test('el panel muestra estado de conexión sin devolver tokens ni sobres cifrados', async () => {
  reset(); const secreto = 'token-secreto-de-prueba'
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'google', version: 1, datos: { estado: 'conectada', cuenta: 'Canal', sobre: cifrarConexion('google', { access_token: secreto }) } })
  const d = await llamada(null, 'GET')
  assert.equal(d.codigo, 200)
  assert.ok(!JSON.stringify(d.datos).includes(secreto))
  assert.ok(!JSON.stringify(d.datos).includes('sobre'))
})
test('dos compus no renuevan simultáneamente el mismo refresh token', async () => {
  reset()
  Object.assign(process.env, { PUBLICACION_ORIGIN: 'https://equipo.example', GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture' })
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'google', version: 1, datos: { sobre: cifrarConexion('google', { access_token: 'fixture-vencido', refresh_token: 'fixture', expira_el: 1 }) } })
  const resultados = await Promise.allSettled([tokenConexion('google'), tokenConexion('google')])
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(resultados.find(r => r.status === 'rejected').reason.status, 409)
  assert.equal(remotas.length, 1)
})
test('cada compu toma solo sus trabajos editoriales, incluso si los ajenos vencieron', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'fuentes', id: 'f1', version: 1, datos: { activa: true } })
  for (const [id, pedido_por, estado] of [['ajeno', 'Luis', 'pendiente'], ['vencido', 'Luis', 'ejecutando'], ['sin-dueno', undefined, 'pendiente'], ['propio', 'Eze', 'pendiente']]) {
    tablas.publicacion_docs.push({ coleccion: 'trabajos', id, version: 1, datos: { pedido_por, estado, vence: 1, fuente_id: 'f1', creado: 1 } })
  }
  const r = await llamada({ op: 'tomar_trabajo' })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.trabajo.id, 'propio')
  assert.equal((await llamada({ op: 'tomar_trabajo' })).datos.trabajo, null)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'vencido').version, 1)
})
test('rastreo automático y publicaciones de otro integrante esperan a su compu', async () => {
  reset(); process.env.PUBLICACION_ACTIVA = '1'
  tablas.publicacion_docs.push({ coleccion: 'fuentes', id: 'ajena', version: 1, datos: { activa: true, automatica: true, creado_por: 'Luis', tipo: 'perfil', intervalo_horas: 6 } })
  const s = sugerencia(); s.datos.estado = 'aprobada'; s.datos.aprobado_por = 'Luis'; tablas.publicacion_docs.push(s)
  tablas.publicacion_docs.push({ coleccion: 'cola', id: 'envio-ajeno', version: 1, datos: { estado: 'enviando', vence: 1, aprobado_por: 'Luis', plataforma: 'x' } })
  assert.equal((await llamada({ op: 'programar_fuentes' })).codigo, 200)
  await procesarPublicaciones('Eze')
  assert.equal(tablas.publicacion_docs.filter(d => d.coleccion === 'trabajos').length, 0)
  assert.equal(tablas.publicacion_docs.filter(d => d.coleccion === 'cola').length, 1)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'envio-ajeno').datos.estado, 'enviando')
  assert.equal(remotas.length, 0)
})
test('X aprobado queda a mano y nunca llama a redes aunque el worker esté activo', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'sugerencias', id: 'sx', version: 1, datos: { titulo: 'Caja en GTA 6', descripcion: '¿Qué hay adentro?', plataformas: ['x'], hashtags: ['#GTA6'], media: 'reusar', video_path: '', imagenes: [], estado: 'pendiente', media_lista: true } })
  assert.equal((await llamada({ op: 'aprobar', id: 'sx', version: 1 })).codigo, 200)
  const item = tablas.publicacion_docs.find(d => d.coleccion === 'cola')
  assert.equal(item.datos.plataforma, 'x')
  assert.equal(item.datos.estado, 'manual')
  process.env.PUBLICACION_ACTIVA = '1'
  await procesarPublicaciones('Eze')
  assert.equal(tablas.publicacion_docs.find(d => d.coleccion === 'cola').datos.estado, 'manual')
  assert.equal(remotas.length, 0)
})
test('confirmar_manual publica X con un link de x.com y rechaza otros hosts', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cola', id: 'cx', version: 1, datos: { estado: 'manual', plataforma: 'x', aprobado_por: 'Eze', titulo: 't', descripcion: 'd' } })
  assert.equal((await llamada({ op: 'confirmar_manual', id: 'cx', version: 1, url: 'https://youtube.com/watch?v=a' })).codigo, 400)
  assert.equal((await llamada({ op: 'confirmar_manual', id: 'cx', version: 1, url: 'https://x.com/Gta6univers0/status/123' })).codigo, 200)
  const item = tablas.publicacion_docs.find(d => d.id === 'cx')
  assert.equal(item.datos.estado, 'publicado')
  assert.equal(item.datos.enlace, 'https://x.com/Gta6univers0/status/123')
})
test.after(() => { globalThis.fetch = original })
