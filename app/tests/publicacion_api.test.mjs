import test from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/publicacion.js'
import { idFuente } from '../lib/publicacion.js'
import { obtenerMetricas } from '../lib/metricas_redes.js'
import { procesarPublicaciones } from '../lib/publicacion_worker.js'
import { encolarPub, mantenerAgendaCola } from '../lib/publicacion_store.js'
import { cifrarConexion, tokenConexion } from '../lib/conexiones.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', TEAM_KEYS: '{"Eze":"clave-de-prueba-suficientemente-larga"}', PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 2).toString('base64'), BUFFER_API_KEY: 'buffer-privado', BUFFER_CHANNEL_ID: 'canal-x' })
const tablas = { docs: [], publicacion_docs: [] }, remotas = []
let estadoGraph = 'processing', publishReel = false
const original = globalThis.fetch
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(url)
  if (u.hostname === 'oauth2.googleapis.com') { remotas.push(u.href); return new Response('{"access_token":"fixture-renovado","refresh_token":"fixture-refresco","expires_in":3600}', { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  if (u.hostname === 'graph.facebook.com') {
    remotas.push(u.href)
    return new Response(JSON.stringify({ status: { processing_phase: { status: estadoGraph }, publishing_phase: { publish_status: publishReel ? 'published' : 'draft' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (u.hostname !== 'unit.supabase.co') { remotas.push(u.href); throw new Error('La prueba no permite llamadas a redes.') }
  const tabla = tablas[u.pathname.split('/').at(-1)]
  assert.ok(tabla, u.pathname)
  const coincide = d => [...u.searchParams].every(([k, v]) => {
    if (k === 'datos->>el') {
      const limite = Number(v.split('.')[1])
      if (v.startsWith('gte.')) return d.datos.el >= limite
      if (v.startsWith('lte.')) return d.datos.el <= limite
      if (v.startsWith('lt.')) return d.datos.el < limite
    }
    if (k === 'or') {
      const [, el, id] = v.match(/^\(datos->>el\.lt\.(\d+),and\(datos->>el\.eq\.\d+,id\.lt\.([\w-]+)\)\)$/)
      return d.datos.el < Number(el) || d.datos.el === Number(el) && d.id < id
    }
    if (v.startsWith('eq.')) return String(d[k]) === v.slice(3)
    if (k === 'datos->>estado' && v.startsWith('in.')) return v.slice(4, -1).split(',').includes(d.datos.estado)
    return true
  })
  const metodo = opciones.method || 'GET'
  let filas = tabla.filter(coincide)
  if (u.searchParams.get('order') === 'datos->>el.desc,id.desc') filas.sort((a, b) => b.datos.el - a.datos.el || b.id.localeCompare(a.id))
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
function reset() { tablas.docs.length = 0; tablas.publicacion_docs.length = 0; remotas.length = 0; estadoGraph = 'processing'; publishReel = false; delete process.env.PUBLICACION_ACTIVA }
const sugerencia = () => ({ coleccion: 'sugerencias', id: 's1', version: 1, datos: { titulo: 'Una caja en GTA 6', descripcion: '¿Qué tiene adentro?', plataformas: ['instagram', 'youtube'], hashtags: ['#GTA6'], media: 'reusar', video_path: 'Eze/clip.mp4', imagenes: [], estado: 'pendiente', media_lista: true } })
const conexionMeta = () => ({ coleccion: 'conexiones', id: 'meta', version: 1, datos: { sobre: cifrarConexion('meta', { access_token: 'fixture', page_id: 'pagina', expira_el: Date.now() + 9999999 }) } })

test('dos aprobaciones simultáneas toman franjas distintas y el cupo diario se respeta', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 2, horarios: ['18:00', '19:00'] } } } })
  await Promise.all(['a', 'b', 'c'].map(id => encolarPub(id, { plataformas: ['x'], titulo: id, descripcion: 'Prueba' }, 'Eze')))
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos)
  assert.equal(cola.length, 3)
  assert.equal(new Set(cola.map(x => x.programado_el)).size, 3)
  const dia = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  assert.equal(cola.filter(x => dia(x.programado_el) === dia(cola[0].programado_el)).length, 2)
})

test('«publicar ahora» saltea la franja y no toma reserva de la agenda', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 2, horarios: ['23:50'] }, youtube: { por_dia: 2, horarios: ['23:50'] } } } })
  await encolarPub('ya', { plataformas: ['x', 'youtube'], video_path: 'Eze/clip.mp4', titulo: 'Sale ya', descripcion: 'Prueba' }, 'Eze', true)
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos)
  assert.equal(cola.length, 2)
  for (const item of cola) {
    assert.ok(item.programado_el > 0 && item.programado_el <= Date.now(), 'queda listo para el próximo envío, no en una franja futura')
    assert.equal(item.proximo_el, item.programado_el)
    assert.equal(item.zona_horaria, 'America/Argentina/Buenos_Aires')
  }
  assert.equal(tablas.publicacion_docs.find(x => x.coleccion === 'programacion'), undefined, 'no ocupa una franja de la agenda compartida')
  assert.ok(tablas.publicacion_docs.some(x => x.coleccion === 'eventos' && x.datos.accion === 'encolado_ahora'))
})

test('«en su turno» sigue tomando franja aunque otra pieza haya salido ya', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 2, horarios: [] } } } })
  await encolarPub('ya', { plataformas: ['x'], titulo: 'Sale ya', descripcion: 'Prueba' }, 'Eze', true)
  await encolarPub('turno', { plataformas: ['x'], titulo: 'Espera', descripcion: 'Prueba' }, 'Eze')
  const cola = Object.fromEntries(tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => [x.datos.origen_id, x.datos]))
  assert.ok(cola.ya.programado_el <= Date.now())
  assert.ok(cola.turno.programado_el >= Date.now() + 14 * 60000, 'la pieza en turno conserva su franja')
})

test('shorts simultáneos comparten horario entre redes y seis turnos para el equipo', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 20, horarios: [] }, youtube: { por_dia: 20, horarios: [] } } } })
  await Promise.all(Array.from({ length: 7 }, (_, i) => encolarPub('short-' + i, { plataformas: ['x', 'youtube'], video_path: 'Eze/clip.mp4', titulo: 'Short ' + i, descripcion: 'Prueba' }, 'Eze')))
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos)
  assert.equal(cola.length, 14)
  for (let i = 0; i < 7; i++) {
    const grupo = cola.filter(x => x.origen_id === 'short-' + i)
    assert.equal(grupo.length, 2)
    assert.equal(grupo[0].programado_el, grupo[1].programado_el)
  }
  const dia = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  assert.ok(new Set(cola.map(x => x.origen_id).filter(id => dia(cola.find(x => x.origen_id === id).programado_el) === dia(Date.now()))).size <= 6)
})

test('un short vencido se reprograma junto en todas sus redes antes de enviarse', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 6, horarios: [] }, youtube: { por_dia: 6, horarios: [] } } } })
  await encolarPub('viejo', { plataformas: ['x', 'youtube'], video_path: 'Eze/clip.mp4', titulo: 'Short', descripcion: 'Prueba' }, 'Eze')
  const vencido = Date.now() - 20 * 60000
  for (const fila of tablas.publicacion_docs.filter(x => x.coleccion === 'cola')) { fila.datos.programado_el = vencido; fila.datos.proximo_el = vencido }
  const agenda = tablas.publicacion_docs.find(x => x.coleccion === 'programacion')
  for (const reserva of Object.values(agenda.datos.reservas)) reserva.fecha = vencido
  await mantenerAgendaCola()
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos)
  assert.equal(cola[0].programado_el, cola[1].programado_el)
  assert.ok(cola[0].programado_el >= Date.now() + 14 * 60000)
})

test('la cola anterior sin horario recibe un turno al activar la agenda', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 6, horarios: [] }, youtube: { por_dia: 6, horarios: [] } } } })
  for (const red of ['x', 'youtube']) tablas.publicacion_docs.push({ coleccion: 'cola', id: 'legado-' + red, version: 1, datos: { origen_id: 'legado', plataforma: red, estado: 'pendiente', video_path: 'Eze/clip.mp4', aprobado_por: 'Eze', titulo: 'Legado' } })
  await mantenerAgendaCola()
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos)
  assert.equal(cola[0].programado_el, cola[1].programado_el)
  assert.ok(cola[0].programado_el >= Date.now() + 14 * 60000)
})

test('un short aprobado con la agenda apagada se programa al activarla', async () => {
  reset()
  await encolarPub('apagado', { plataformas: ['x', 'youtube'], video_path: 'Eze/clip.mp4', titulo: 'Short', descripcion: 'Prueba' }, 'Eze')
  assert.ok(tablas.publicacion_docs.filter(x => x.coleccion === 'cola').every(x => !x.datos.programado_el))
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 6, horarios: [] }, youtube: { por_dia: 6, horarios: [] } } } })
  await mantenerAgendaCola()
  const horarios = tablas.publicacion_docs.filter(x => x.coleccion === 'cola').map(x => x.datos.programado_el)
  assert.equal(horarios[0], horarios[1])
  assert.ok(horarios[0] >= Date.now() + 14 * 60000)
})

test('reintentar un short explícitamente no se sobrescribe con su reserva anterior', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 6, horarios: [] } } } })
  await encolarPub('retry', { plataformas: ['x'], video_path: 'Eze/clip.mp4', titulo: 'Short', descripcion: 'Prueba' }, 'Eze')
  const fila = tablas.publicacion_docs.find(x => x.coleccion === 'cola')
  fila.datos.estado = 'error'
  const agenda = tablas.publicacion_docs.find(x => x.coleccion === 'programacion')
  agenda.datos.reservas[fila.id].fecha = Date.now() - 3600000
  assert.equal((await llamada({ op: 'cola_reintentar', id: fila.id, version: 1 })).codigo, 200)
  const fechaReintento = fila.datos.programado_el
  await mantenerAgendaCola()
  assert.equal(fila.datos.programado_el, fechaReintento)
  assert.ok(fila.datos.reintento_el)
})

test('descartar un destino conserva el turno del short hasta descartar el último', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cadencia', id: 'global', version: 1, datos: { activo: true, zona_horaria: 'America/Argentina/Buenos_Aires', por_red: { x: { por_dia: 6, horarios: [] }, youtube: { por_dia: 6, horarios: [] } } } })
  await encolarPub('descartar', { plataformas: ['x', 'youtube'], video_path: 'Eze/clip.mp4', titulo: 'Short', descripcion: 'Prueba' }, 'Eze')
  const reservas = () => Object.values(tablas.publicacion_docs.find(x => x.coleccion === 'programacion').datos.reservas)
  assert.equal(reservas().length, 2)
  assert.equal((await llamada({ op: 'cola_desestimar', id: 'descartar-x', version: 1 })).codigo, 200)
  assert.equal(reservas().length, 1)
  assert.equal((await llamada({ op: 'cola_desestimar', id: 'descartar-youtube', version: 1 })).codigo, 200)
  assert.equal(reservas().length, 0)
})

test('publicaciones exige la clave del equipo antes de leer o escribir', async () => {
  reset(); assert.equal((await llamada({ op: 'importar_fuentes' }, 'POST', false)).codigo, 401)
  assert.equal(tablas.publicacion_docs.length, 0)
})
test('aprobar crea un envío por red y la repetición no duplica la cola', async () => {
  reset()
  tablas.publicacion_docs.push(sugerencia(), { ...conexionMeta(), datos: { estado: 'conectada', ig_id: 'ig' } })
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 1, plataformas: ['instagram'] })).codigo, 422)
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 1, revisado: true, plataformas: ['youtube'] })).codigo, 422)
  assert.equal(tablas.publicacion_docs.filter(x => x.coleccion === 'cola').length, 0)
  const a = await llamada({ op: 'aprobar', id: 's1', version: 1, revisado: true, plataformas: ['instagram'] })
  assert.equal(a.codigo, 200)
  assert.equal((await llamada({ op: 'aprobar', id: 's1', version: 3 })).codigo, 200)
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola')
  assert.deepEqual(cola.map(c => c.datos.plataforma), ['instagram'])
  assert.ok(cola.every(x => x.datos.aprobado_por === 'Eze'))
  assert.equal(remotas.length, 0)
})
test('la descripción confirmada deja las fuentes en la ficha interna', async () => {
  reset()
  const s = sugerencia()
  const fuente = 'https://www.youtube.com/watch?v=test'
  s.datos.fuente_url = fuente
  tablas.publicacion_docs.push(s, { ...conexionMeta(), datos: { estado: 'conectada', ig_id: 'ig' } })
  const descripcion = '¿Cuál te voló más la cabeza?\n\nOriginales:\n' + fuente + '\n\n#GTA6'
  const r = await llamada({ op: 'aprobar', id: 's1', version: 1, revisado: true, plataformas: ['instagram'], descripcion })
  assert.equal(r.codigo, 200)
  const envio = tablas.publicacion_docs.find(d => d.coleccion === 'cola')
  assert.equal(envio.datos.fuente_url, fuente)
  assert.equal(envio.datos.descripcion, '¿Cuál te voló más la cabeza?\n\n#GTA6')
})
test('aprobar desde Biblioteca conserva el copy editado en la ficha y en cada destino elegido', async () => {
  reset()
  tablas.docs.push({ coleccion: 'clips', id: 'c1', version: 1, datos: {
    estado: 'listo', titulo: 'Título anterior', descripcion: 'Texto anterior', video_path: 'Eze/clip.mp4'
  } })
  tablas.publicacion_docs.push({ ...conexionMeta(), datos: { estado: 'conectada', ig_id: 'ig' } })
  const r = await llamada({ op: 'aprobar_clip', id: 'c1', version: 1, revisado: true,
    plataformas: ['instagram'], titulo: 'Título editado', descripcion: 'Copy nuevo', hashtags: '#GTA6 #GTAVI' })
  assert.equal(r.codigo, 200)
  const envios = tablas.publicacion_docs.filter(d => d.coleccion === 'cola')
  assert.deepEqual(envios.map(d => d.datos.plataforma), ['instagram'])
  for (const datos of [tablas.docs[0].datos, envios[0].datos]) {
    assert.equal(datos.titulo, 'Título editado')
    assert.equal(datos.descripcion, 'Copy nuevo')
    assert.deepEqual(datos.hashtags, ['#GTA6', '#GTAVI'])
  }
})
test('un carrusel revisado crea una tarea manual de YouTube y conserva el orden de sus placas', async () => {
  reset(); const d = sugerencia()
  d.datos.video_path = ''; d.datos.imagenes = ['Eze/uno.jpg', 'Eze/dos.jpg']
  tablas.publicacion_docs.push(d)
  const aprobar = { op: 'aprobar', id: 's1', version: 1, plataformas: ['youtube'] }
  assert.equal((await llamada(aprobar)).codigo, 422)
  assert.equal((await llamada({ ...aprobar, revisado: true, plataformas: ['tiktok'] })).codigo, 422)
  assert.equal((await llamada({ ...aprobar, revisado: true, titulo: 'Comparación editada' })).codigo, 200)
  const cola = tablas.publicacion_docs.filter(x => x.coleccion === 'cola')
  assert.equal(cola.length, 1)
  const [tarea] = cola
  assert.equal(tarea.datos.estado, 'manual')
  assert.equal(tarea.datos.titulo, 'Comparación editada')
  assert.deepEqual(tarea.datos.imagenes, d.datos.imagenes)
  process.env.PUBLICACION_ACTIVA = '1'
  await procesarPublicaciones('Eze')
  assert.equal(remotas.length, 0)
  const confirmar = { op: 'confirmar_manual', id: tarea.id, version: tarea.version }
  assert.equal((await llamada({ ...confirmar, url: 'https://www.youtube.com/watch?v=video' })).codigo, 400)
  assert.equal((await llamada({ ...confirmar, url: 'https://www.youtube.com/post/Ugkx-uno' })).codigo, 200)
  assert.equal(tarea.datos.estado, 'publicado')
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
test('X aprobado vuelve a la cola automática y el worker intenta publicarlo', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'sugerencias', id: 'sx', version: 1, datos: { titulo: 'Caja en GTA 6', descripcion: '¿Qué hay adentro?', plataformas: ['x'], hashtags: ['#GTA6'], media: 'reusar', video_path: '', imagenes: [], estado: 'pendiente', media_lista: true } })
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'buffer', version: 1, datos: { estado: 'conectada' } })
  assert.equal((await llamada({ op: 'aprobar', id: 'sx', version: 1, revisado: true, plataformas: ['x'] })).codigo, 200)
  const item = tablas.publicacion_docs.find(d => d.coleccion === 'cola')
  assert.equal(item.datos.plataforma, 'x')
  assert.equal(item.datos.estado, 'pendiente')
  process.env.PUBLICACION_ACTIVA = '1'
  await procesarPublicaciones('Eze')
  assert.ok(remotas.some(u => u.includes('api.buffer.com')), 'el worker debe consultar Buffer')
})
test('un reel viejo se cierra como publicado si Graph ya lo confirmó', async () => {
  reset(); process.env.PUBLICACION_ACTIVA = '1'; estadoGraph = 'complete'; publishReel = true
  const viejo = Date.now() - 31 * 60000
  tablas.publicacion_docs.push(conexionMeta(), { coleccion: 'cola', id: 'fb-viejo', version: 1, datos: { estado: 'procesando', aprobado_por: 'Eze', plataforma: 'facebook', remoto_id: '1506599864725142', etapa: 'procesando', creado: viejo, aprobado_el: viejo } })
  await procesarPublicaciones('Eze')
  const item = tablas.publicacion_docs.find(d => d.id === 'fb-viejo')
  assert.equal(item.datos.estado, 'publicado')
  assert.ok(tablas.publicacion_docs.some(u => u.coleccion === 'eventos' && u.datos.accion === 'publicado'))
  assert.ok(!tablas.publicacion_docs.some(u => u.coleccion === 'eventos' && u.datos.accion === 'procesando_vencido'))
})
test('un reel que sigue procesando después del timeout pasa a revisar', async () => {
  reset(); process.env.PUBLICACION_ACTIVA = '1'; estadoGraph = 'processing'; publishReel = false
  const viejo = Date.now() - 31 * 60000
  tablas.publicacion_docs.push(conexionMeta(), { coleccion: 'cola', id: 'fb-viejo', version: 1, datos: { estado: 'procesando', aprobado_por: 'Eze', plataforma: 'facebook', remoto_id: '1506599864725142', etapa: 'procesando', creado: viejo, aprobado_el: viejo } })
  await procesarPublicaciones('Eze')
  const item = tablas.publicacion_docs.find(d => d.id === 'fb-viejo')
  assert.equal(item.datos.estado, 'revisar')
  assert.match(item.datos.error, /no confirmó la publicación a tiempo/)
  assert.ok(tablas.publicacion_docs.some(u => u.coleccion === 'eventos' && u.datos.accion === 'procesando_vencido'))
  assert.ok(remotas.some(u => u.includes('graph.facebook.com')))
})
test('detener reintentos deja el envío con remoto_id en revisar', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cola', id: 'fb-stop', version: 1, datos: { estado: 'procesando', aprobado_por: 'Eze', plataforma: 'facebook', remoto_id: '1506599864725142' } })
  assert.equal((await llamada({ op: 'cola_detener', id: 'fb-stop', version: 1 })).codigo, 200)
  const item = tablas.publicacion_docs.find(d => d.id === 'fb-stop')
  assert.equal(item.datos.estado, 'revisar')
  assert.equal(item.datos.remoto_id, '1506599864725142')
  assert.equal((await llamada({ op: 'cola_detener', id: 'fb-stop', version: 2 })).codigo, 409)
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
  assert.ok(tablas.publicacion_docs.some(e => e.coleccion === 'eventos' && e.datos.accion === 'publicado' && e.datos.plataforma === 'x' && e.datos.manual), 'confirmar emite evento publicado')
})
test('confirmar_manual de un borrador de YouTube lo deja publicado y lo cuenta', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'cola', id: 'cy', version: 1, datos: { estado: 'borrador', plataforma: 'youtube', aprobado_por: 'Eze', titulo: 't', descripcion: 'd' } })
  assert.equal((await llamada({ op: 'confirmar_manual', id: 'cy', version: 1, url: 'https://youtube.com/watch?v=abc' })).codigo, 200)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'cy').datos.estado, 'publicado')
  assert.ok(tablas.publicacion_docs.some(e => e.coleccion === 'eventos' && e.datos.accion === 'publicado' && e.datos.plataforma === 'youtube'))
})
const enCola = (id, datos) => ({ coleccion: 'cola', id, version: 1, datos: { plataforma: 'instagram', titulo: 'Envío ' + id, aprobado_por: 'Eze', creado: 1, proximo_el: 1, ...datos } })

test('administración de cola: reintentar reencola fallados y trabados sin id remoto, y bloquea un «revisar» con id remoto', async () => {
  reset()
  tablas.publicacion_docs.push(
    enCola('c-err', { estado: 'error', error: 'falló la red' }),
    enCola('c-trab', { estado: 'revisar', error: 'se interrumpió' }),
    enCola('c-rev', { estado: 'revisar', error: 'se interrumpió', remoto_id: 'r9' }))
  const ok = await llamada({ op: 'cola_reintentar', id: 'c-err', version: 1 })
  assert.equal(ok.codigo, 200)
  const reencolado = tablas.publicacion_docs.find(d => d.id === 'c-err')
  assert.equal(reencolado.datos.estado, 'pendiente')
  assert.equal(reencolado.datos.error, '')
  assert.ok(reencolado.datos.proximo_el > 1)
  // Un trabado SIN id remoto sí se puede reintentar.
  assert.equal((await llamada({ op: 'cola_reintentar', id: 'c-trab', version: 1 })).codigo, 200)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'c-trab').datos.estado, 'pendiente')
  // Un «revisar» CON id remoto (pudo publicarse) sigue bloqueado.
  assert.equal((await llamada({ op: 'cola_reintentar', id: 'c-rev', version: 1 })).codigo, 409)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'c-rev').datos.estado, 'revisar')
})

test('administración de cola: reintento en masa reencola solo los fallados sin remoto_id', async () => {
  reset()
  tablas.publicacion_docs.push(
    enCola('m1', { estado: 'error' }), enCola('m2', { estado: 'error' }),
    enCola('m3', { estado: 'error', remoto_id: 'x1' }), enCola('m4', { estado: 'pendiente' }))
  const r = await llamada({ op: 'cola_reintentar_masa' })
  assert.equal(r.codigo, 200)
  assert.equal(r.datos.reintentados, 2)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'm3').datos.estado, 'error')
  assert.equal(tablas.publicacion_docs.filter(d => d.coleccion === 'cola' && d.datos.estado === 'pendiente').length, 3)
})

test('administración de cola: priorizar adelanta el proximo_el y posponer lo atrasa', async () => {
  reset()
  tablas.publicacion_docs.push(enCola('p1', { estado: 'pendiente', proximo_el: Date.now() + 999999 }))
  await llamada({ op: 'cola_prioridad', id: 'p1', version: 1, cuando: 'ya' })
  assert.ok(tablas.publicacion_docs.find(d => d.id === 'p1').datos.proximo_el <= Date.now())
  const v = tablas.publicacion_docs.find(d => d.id === 'p1').version
  await llamada({ op: 'cola_prioridad', id: 'p1', version: v, cuando: 'posponer' })
  assert.ok(tablas.publicacion_docs.find(d => d.id === 'p1').datos.proximo_el > Date.now() + 1000000)
})

test('el GET devuelve ETag y responde 304 cuando nada cambió (ahorro de egress)', async () => {
  reset()
  const h1 = {}
  const res1 = { setHeader (k, v) { h1[k] = v }, status (c) { this.codigo = c; return this }, json (d) { this.datos = d } }
  await handler({ method: 'GET', query: {}, headers: { 'x-clave': 'clave-de-prueba-suficientemente-larga' } }, res1)
  assert.equal(res1.codigo, 200)
  assert.ok(h1.ETag, 'debe mandar ETag')
  const res2 = { setHeader () {}, status (c) { this.codigo = c; return this }, json () {}, statusCode: 0, end () { this.ended = true } }
  await handler({ method: 'GET', query: {}, headers: { 'x-clave': 'clave-de-prueba-suficientemente-larga', 'if-none-match': h1.ETag } }, res2)
  assert.equal(res2.statusCode, 304)
  assert.ok(res2.ended, 'un 304 no manda cuerpo')
})

test('Actividad limita el poll a 48 horas y carga páginas separadas sin repetir eventos', async () => {
  reset()
  const ahora = Date.now()
  const evento = (id, el) => ({ coleccion: 'eventos', id, version: 1, datos: { el, accion: 'prueba' } })
  tablas.publicacion_docs.push(evento('viejo', ahora - 49 * 3600000))
  for (let i = 0; i < 43; i++) tablas.publicacion_docs.push(evento('reciente-' + String(i).padStart(2, '0'), ahora - 1000))
  const { datos: d } = await llamada(undefined, 'GET')
  assert.equal(d.eventos.length, 40)
  assert.ok(d.eventos.every(e => e.id.startsWith('reciente-')))
  const { datos: mas } = await llamada({ op: 'actividad_pagina', ...d.actividad, cursor: d.actividad.siguiente })
  assert.deepEqual(mas.eventos.map(e => e.id), ['reciente-02', 'reciente-01', 'reciente-00'])
  const { datos: historial } = await llamada({ op: 'actividad_pagina', ancla: d.actividad.ancla, historial: true })
  assert.deepEqual(historial.eventos.map(e => e.id), ['viejo'])
})

test('Buffer usa post(input) para el detalle y conserva las métricas agregadas', async () => {
  const anteriorFetch = globalThis.fetch
  const anteriorOrganizacion = process.env.BUFFER_ORGANIZATION_ID
  process.env.BUFFER_ORGANIZATION_ID = 'organizacion-test'
  const queries = []
  globalThis.fetch = async (url, opciones) => {
    assert.equal(new URL(url).hostname, 'api.buffer.com')
    const { query } = JSON.parse(opciones.body)
    queries.push(query)
    const data = query.includes('aggregatedPostMetrics')
      ? { aggregatedPostMetrics: { metrics: [{ type: 'reactions', value: 7 }] } }
      : { p0: { externalLink: 'https://x.com/cuenta/status/1', metrics: [{ type: 'impressions', value: 12 }] } }
    return Response.json({ data })
  }
  try {
    const data = await obtenerMetricas('x', 'historico', [{ plataforma: 'x', remoto_id: 'test-post', estado: 'publicado', publicado_el: Date.now() }])
    assert.match(queries[0], /post\(input: \{ id: "test-post" \}\)/)
    assert.equal(data.actual.reacciones, 7)
    assert.equal(data.posts[0].impresiones, 12)
    assert.ok(data.rango.hasta - data.rango.desde < 365 * 86400000)
  } finally {
    globalThis.fetch = anteriorFetch
    if (anteriorOrganizacion === undefined) delete process.env.BUFFER_ORGANIZATION_ID
    else process.env.BUFFER_ORGANIZATION_ID = anteriorOrganizacion
  }
})

test('TikTok sandbox informa los permisos de métricas faltantes sin consultar endpoints no autorizados', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: {
    estado: 'conectada', sobre: cifrarConexion('tiktok', { access_token: 'sandbox', scope: 'user.info.basic,video.upload', expira_el: Date.now() + 3600000 })
  } })
  await assert.rejects(obtenerMetricas('tiktok', '7d'), e => e.status === 424 && /user.info.stats, video.list/.test(e.message))
  assert.equal(remotas.length, 0)
})

test('TikTok separa seguidores actuales de contadores acumulados de videos recientes', async () => {
  reset()
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'tiktok', version: 1, datos: {
    estado: 'conectada', sobre: cifrarConexion('tiktok', { access_token: 'sandbox', scope: 'user.info.basic,user.info.stats,video.list', expira_el: Date.now() + 3600000 })
  } })
  const antes = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    if (new URL(url).hostname !== 'open.tiktokapis.com') return antes(url, opciones)
    if (String(url).includes('/user/info/')) return Response.json({ data: { user: { follower_count: 1 } }, error: { code: 'ok' } })
    return Response.json({ data: { videos: [
      { id: 'a', create_time: Math.floor(Date.now() / 1000) - 60, view_count: 191, like_count: 7, comment_count: 0, share_count: 0 },
      { id: 'b', create_time: Math.floor(Date.now() / 1000) - 120, view_count: 169, like_count: 11, comment_count: 1, share_count: 2 }
    ] }, error: { code: 'ok' } })
  }
  try {
    const d = await obtenerMetricas('tiktok', '7d')
    assert.equal(d.actual.seguidores, 1)
    assert.deepEqual(d.recientes, { videos: 2, vistas: 360, interacciones: 21 })
    assert.equal(d.posts.length, 2)
  } finally { globalThis.fetch = antes }
})

test('YouTube muestra contadores actuales de videos aunque Analytics todavía no los procese', async () => {
  reset()
  const antesCanal = process.env.YOUTUBE_CHANNEL_ID
  process.env.YOUTUBE_CHANNEL_ID = 'canal-test'
  tablas.publicacion_docs.push({ coleccion: 'conexiones', id: 'google', version: 1, datos: {
    estado: 'conectada', sobre: cifrarConexion('google', { access_token: 'youtube', expira_el: Date.now() + 3600000 })
  } })
  const antes = globalThis.fetch
  globalThis.fetch = async (url, opciones) => {
    const u = new URL(url)
    if (u.hostname === 'unit.supabase.co') return antes(url, opciones)
    if (u.hostname === 'youtubeanalytics.googleapis.com') return Response.json({ columnHeaders: [{ name: 'views' }], rows: [] })
    if (u.pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'canal-test', statistics: { subscriberCount: '0', viewCount: '917' }, contentDetails: { relatedPlaylists: { uploads: 'lista' } } }] })
    if (u.pathname.endsWith('/playlistItems')) return Response.json({ items: [{ contentDetails: { videoId: 'video1' } }] })
    if (u.pathname.endsWith('/videos')) return Response.json({ items: [{ id: 'video1', snippet: { title: 'Short reciente', publishedAt: new Date(Date.now() - 3600000).toISOString() }, statistics: { viewCount: '838', likeCount: '4' } }] })
    throw new Error('Ruta inesperada: ' + u.pathname)
  }
  try {
    const d = await obtenerMetricas('youtube', '7d')
    assert.equal(d.actual.vistas, undefined)
    assert.equal(d.vistas_canal, 917)
    assert.deepEqual(d.recientes, { videos: 1, vistas: 838 })
    assert.equal(d.posts[0].vistas, 838)
  } finally {
    globalThis.fetch = antes
    if (antesCanal === undefined) delete process.env.YOUTUBE_CHANNEL_ID
    else process.env.YOUTUBE_CHANNEL_ID = antesCanal
  }
})

test('descartar oculta la propuesta, bloquea su aprobación y habilita otra desde el mismo enlace', async () => {
  reset()
  const url = 'https://x.com/cuenta/status/123'
  const fuente = idFuente(url)
  const s = sugerencia()
  s.id = idFuente(fuente + url)
  Object.assign(s.datos, { fuente_id: fuente, fuente_url: url })
  tablas.publicacion_docs.push(s, { coleccion: 'fuentes', id: fuente, version: 1,
    datos: { url, tipo: 'publicacion', activa: true, generada_el: Date.now() } })
  assert.equal((await llamada({ op: 'generar_link', url })).codigo, 409)
  assert.equal((await llamada({ op: 'sugerencia_descartar', id: s.id, version: 1 })).codigo, 200)
  assert.equal((await llamada(undefined, 'GET')).datos.sugerencias.length, 0)
  assert.equal((await llamada({ op: 'aprobar', id: s.id, version: 2, revisado: true, plataformas: ['x'] })).codigo, 409)
  const nuevo = await llamada({ op: 'generar_link', url, enfoque: 'Fauna' })
  assert.equal(nuevo.codigo, 200)
  const { trabajo } = (await llamada({ op: 'tomar_trabajo' })).datos
  assert.match(trabajo.prompt, /Fauna/)
  assert.match(trabajo.prompt, /pedir_enfoque_distinto/)
  const cerrar = await llamada({ op: 'cerrar_trabajo', id: trabajo.id, run_id: trabajo.run_id,
    resultado: { ...sugerencia().datos, fuente_url: url, titulo: 'Fauna de Vice City' } })
  assert.equal(cerrar.codigo, 200)
  const visibles = (await llamada(undefined, 'GET')).datos.sugerencias
  assert.equal(visibles.length, 1)
  assert.equal(visibles[0].titulo, 'Fauna de Vice City')
  assert.notEqual(visibles[0].id, s.id)
})

test('el avance editorial sube por etapas y llega a 100 solo al guardar el resultado', async () => {
  reset()
  const url = 'https://x.com/cuenta/status/456'
  assert.equal((await llamada({ op: 'generar_link', url })).codigo, 200)
  const { trabajo } = (await llamada({ op: 'tomar_trabajo' })).datos
  assert.equal(trabajo.porcentaje, 10)
  const latido = { op: 'latido_trabajo', id: trabajo.id, run_id: trabajo.run_id }
  assert.equal((await llamada({ ...latido, avance: { porcentaje: 70, etapa: 'modelando' } })).codigo, 200)
  await llamada({ ...latido, avance: { porcentaje: 35, etapa: 'preparando' } })
  await llamada({ ...latido, avance: { porcentaje: 100, etapa: 'guardando' } })
  const actual = () => tablas.publicacion_docs.find(d => d.id === trabajo.id).datos
  assert.equal(actual().porcentaje, 70)
  assert.equal(actual().etapa, 'modelando')
  assert.equal((await llamada({ op: 'cerrar_trabajo', id: trabajo.id, run_id: trabajo.run_id,
    resultado: { ...sugerencia().datos, fuente_url: url } })).codigo, 200)
  assert.equal(actual().porcentaje, 100)
  assert.equal(actual().estado, 'terminado')
})

test('generar_subido crea un trabajo editorial para un video propio y cierra sin exigir URL', async () => {
  reset()
  const video = 'Eze/pub-abc.mp4'
  assert.equal((await llamada({ op: 'generar_subido', video_path: video, nota: 'resaltá el choque' })).codigo, 200)
  const fuente = tablas.publicacion_docs.find(d => d.coleccion === 'fuentes')
  assert.equal(fuente.datos.tipo, 'subido')
  assert.equal(fuente.datos.video_subido, video)
  const { trabajo } = (await llamada({ op: 'tomar_trabajo' })).datos
  assert.match(trabajo.prompt, /resaltá el choque/)
  assert.match(trabajo.prompt, /video PROPIO/)
  const cerrar = await llamada({ op: 'cerrar_trabajo', id: trabajo.id, run_id: trabajo.run_id, resultado: { ...sugerencia().datos, video_path: video, fuente_url: '', titulo: 'Mirá este choque' } })
  assert.equal(cerrar.codigo, 200)
  const sugs = (await llamada(undefined, 'GET')).datos.sugerencias
  assert.equal(sugs.length, 1)
  assert.equal(sugs[0].video_path, video)
})

test('generar_subido rechaza un video_path inválido', async () => {
  reset()
  assert.equal((await llamada({ op: 'generar_subido', video_path: 'http://malo/x' })).codigo, 400)
})

test('cadencia_guardar persiste la config y el GET la devuelve limpia', async () => {
  reset()
  const r = await llamada({ op: 'cadencia_guardar', datos: { por_red: { youtube: { por_dia: 6, horarios: ['09:00', '18:00'] } }, activo: true } })
  assert.equal(r.codigo, 200)
  const out = (await llamada(undefined, 'GET')).datos
  assert.equal(out.cadencia.por_red.youtube.por_dia, 6)
  assert.deepEqual(out.cadencia.por_red.youtube.horarios, ['09:00', '18:00'])
  assert.equal(out.cadencia.activo, true)
})

test('cola_desestimar frena un envío (lo cancela) y bloquea uno en curso en la red', async () => {
  reset()
  tablas.publicacion_docs.push(enCola('d1', { estado: 'error' }), enCola('d2', { estado: 'revisar' }), enCola('d3', { estado: 'enviando', remoto_id: 'r1' }))
  assert.equal((await llamada({ op: 'cola_desestimar', id: 'd1', version: 1 })).codigo, 200)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'd1').datos.estado, 'cancelado')
  assert.equal((await llamada({ op: 'cola_desestimar', id: 'd2', version: 1 })).codigo, 200)
  assert.equal(tablas.publicacion_docs.find(d => d.id === 'd2').datos.estado, 'cancelado')
  assert.equal((await llamada({ op: 'cola_desestimar', id: 'd3', version: 1 })).codigo, 409)
})

test.after(() => { globalThis.fetch = original })
