import { randomUUID } from 'node:crypto'
import { db } from './comun.js'
import { errorPublicacion, redesValidas, estadoInicialEnvio } from './publicacion.js'
import { proximaFranja } from './agenda_cola.js'

const TABLA = 'publicacion_docs'
function falloLectura (error) {
  console.error('publicacion_store: fallo de lectura', error?.code, error?.message)
  return errorPublicacion(['42P01', 'PGRST205'].includes(error.code)
    ? 'La base de Publicaciones todavía no está habilitada. Falta aplicar su preparación en Supabase.'
    : 'No se pudo acceder a la base de Publicaciones. Probá Actualizar; si sigue igual, hay que revisar la conexión del servidor.', 503)
}
export async function leerPub (col, id, sb = db()) {
  const { data, error } = await sb.from(TABLA).select('id,datos,version').eq('coleccion', col).eq('id', id).maybeSingle()
  if (error) throw falloLectura(error)
  return data
}
export async function listarPub (col, sb = db()) {
  const filas = []
  for (let n = 0; ; n += 1000) {
    const { data, error } = await sb.from(TABLA).select('id,datos,version').eq('coleccion', col).order('id').range(n, n + 999)
    if (error) throw falloLectura(error)
    filas.push(...(data || []))
    if ((data || []).length < 1000) return filas
  }
}
export const ACTIVIDAD_VENTANA = 48 * 60 * 60 * 1000
export const ACTIVIDAD_PAGINA = 40

export async function listarActividad ({ ancla, historial = false, cursor } = {}) {
  const fecha = 'datos->>el', corte = ancla - ACTIVIDAD_VENTANA
  let consulta = db().from(TABLA).select('id,datos,version').eq('coleccion', 'eventos')
  consulta = historial ? consulta.lt(fecha, String(corte)) : consulta.gte(fecha, String(corte)).lte(fecha, String(ancla))
  if (cursor) consulta = consulta.or(fecha + '.lt.' + cursor.el + ',and(' + fecha + '.eq.' + cursor.el + ',id.lt.' + cursor.id + ')')
  const { data, error } = await consulta.order(fecha, { ascending: false }).order('id', { ascending: false }).limit(ACTIVIDAD_PAGINA + 1)
  if (error) throw falloLectura(error)
  const filas = (data || []).slice(0, ACTIVIDAD_PAGINA)
  const ultimo = filas.at(-1)
  const siguiente = data?.length > ACTIVIDAD_PAGINA ? { el: ultimo.datos.el, id: ultimo.id } : null
  return { filas, siguiente }
}

// Trazabilidad con filtros, para su sección propia: por plataforma, acción y rango de fechas (ms), paginada por cursor.
export async function listarTrazabilidad ({ plataforma, accion, desde, hasta, cursor } = {}) {
  const fecha = 'datos->>el'
  let consulta = db().from(TABLA).select('id,datos,version').eq('coleccion', 'eventos')
  if (plataforma) consulta = consulta.eq('datos->>plataforma', plataforma)
  if (accion) consulta = consulta.eq('datos->>accion', accion)
  if (desde != null) consulta = consulta.gte(fecha, String(desde))
  if (hasta != null) consulta = consulta.lte(fecha, String(hasta))
  if (cursor) consulta = consulta.or(fecha + '.lt.' + cursor.el + ',and(' + fecha + '.eq.' + cursor.el + ',id.lt.' + cursor.id + ')')
  const { data, error } = await consulta.order(fecha, { ascending: false }).order('id', { ascending: false }).limit(ACTIVIDAD_PAGINA + 1)
  if (error) throw falloLectura(error)
  const filas = (data || []).slice(0, ACTIVIDAD_PAGINA)
  const ultimo = filas.at(-1)
  const siguiente = data?.length > ACTIVIDAD_PAGINA ? { el: ultimo.datos.el, id: ultimo.id } : null
  return { filas, siguiente }
}

export async function guardarPub (col, id, datos, version = 0, sb = db()) {
  const { data, error } = version
    ? await sb.from(TABLA).update({ datos, version: version + 1, actualizado: new Date().toISOString() }).eq('coleccion', col).eq('id', id).eq('version', version).select('version')
    : await sb.from(TABLA).insert({ coleccion: col, id, datos, version: 1 }).select('version')
  if (error || !data?.length) throw errorPublicacion('Otro integrante cambió este item. Actualizá y volvé a intentar.', 409)
  return { id, datos, version: version + 1 }
}
export async function eventoPub (accion, por, detalle = {}) {
  return guardarPub('eventos', Date.now() + '-' + randomUUID(), { accion, por, el: Date.now(), ...detalle })
}
// Un único documento CAS serializa las reservas entre computadoras del equipo.
async function reservarHorario (id, red, desde) {
  for (let intento = 0; intento < 12; intento++) {
    const config = (await leerPub('cadencia', 'global'))?.datos
    if (!config?.activo) return { fecha: desde, zona: config?.zona_horaria || 'America/Argentina/Cordoba' }
    if (!config.por_red?.[red]?.por_dia) throw errorPublicacion('La cadencia de esta red está en 0 publicaciones por día.', 422)
    const actual = await leerPub('programacion', 'global')
    const reservas = Object.fromEntries(Object.entries(actual?.datos?.reservas || {}).filter(([, r]) => r.fecha >= Date.now() - 2 * 86400000))
    if (reservas[id]) return { fecha: reservas[id].fecha, zona: reservas[id].zona }
    const ocupados = Object.values(reservas).filter(r => r.red === red).map(r => r.fecha)
    const fecha = proximaFranja(config, red, ocupados, desde)
    try {
      await guardarPub('programacion', 'global', { reservas: { ...reservas, [id]: { red, fecha, zona: config.zona_horaria } } }, actual?.version || 0)
      return { fecha, zona: config.zona_horaria }
    } catch (e) { if (e.status !== 409) throw e }
  }
  throw errorPublicacion('La agenda está ocupada. Volvé a intentar.', 409)
}
export async function posponerHorario (item, desde) {
  const config = (await leerPub('cadencia', 'global'))?.datos
  if (!config?.activo) return { fecha: desde, zona: item.datos.zona_horaria }
  for (let intento = 0; intento < 12; intento++) {
    const actual = await leerPub('programacion', 'global')
    const reservas = actual?.datos?.reservas || {}
    const ocupados = Object.entries(reservas).filter(([id, r]) => id !== item.id && r.red === item.datos.plataforma).map(([, r]) => r.fecha)
    const fecha = proximaFranja(config, item.datos.plataforma, ocupados, desde)
    try {
      await guardarPub('programacion', 'global', { reservas: { ...reservas, [item.id]: { red: item.datos.plataforma, fecha, zona: config.zona_horaria } } }, actual?.version || 0)
      return { fecha, zona: config.zona_horaria }
    } catch (e) { if (e.status !== 409) throw e }
  }
  throw errorPublicacion('La agenda cambió. Volvé a intentar.', 409)
}
export async function liberarHorario (id) {
  for (let intento = 0; intento < 12; intento++) {
    const actual = await leerPub('programacion', 'global')
    if (!actual?.datos?.reservas?.[id]) return
    const reservas = { ...actual.datos.reservas }
    delete reservas[id]
    try { await guardarPub('programacion', 'global', { reservas }, actual.version); return }
    catch (e) { if (e.status !== 409) throw e }
  }
  throw errorPublicacion('La agenda cambió. Volvé a intentar.', 409)
}
export async function encolarPub (origen, d, por) {
  const creado = Date.now(), ids = []
  for (const plataforma of redesValidas(d.plataformas)) {
    const id = origen + '-' + plataforma
    if (!await leerPub('cola', id)) {
      const { fecha, zona } = await reservarHorario(id, plataforma, creado)
      try { await guardarPub('cola', id, { ...d, plataforma, origen_id: origen, estado: estadoInicialEnvio(plataforma, d), creado, aprobado_por: por, aprobado_el: d.aprobado_el || creado, programado_el: fecha, zona_horaria: zona, proximo_el: fecha }) }
      catch (e) { if (e.status !== 409) throw e }
    }
    try { await guardarPub('eventos', 'encolado-' + id, { accion: 'encolado', por, el: creado, item_id: id, plataforma, fuente_url: d.fuente_url || '', aprobado_por: por }) }
    catch (e) { if (e.status !== 409) throw e }
    ids.push(id)
  }
  return ids
}
