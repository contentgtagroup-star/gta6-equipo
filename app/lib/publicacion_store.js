import { createHash, randomUUID } from 'node:crypto'
import { db } from './comun.js'
import { errorPublicacion, redesValidas, estadoInicialEnvio } from './publicacion.js'
import { proximaFranja, proximaFranjaShort } from './agenda_cola.js'

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
async function reservarShort (origen, redes, desde) {
  const minuto = createHash('sha256').update(origen).digest()[0] % 60
  for (let intento = 0; intento < 20; intento++) {
    const config = (await leerPub('cadencia', 'global'))?.datos
    if (!config?.activo) return { fecha: desde, zona: config?.zona_horaria || 'America/Argentina/Cordoba' }
    if (redes.some(red => !config.por_red?.[red]?.por_dia)) throw errorPublicacion('Una red del short tiene cadencia de 0 publicaciones por día.', 422)
    const actual = await leerPub('programacion', 'global')
    const reservas = Object.fromEntries(Object.entries(actual?.datos?.reservas || {}).filter(([, r]) => r.fecha >= Date.now() - 2 * 86400000))
    const previa = Object.values(reservas).find(r => r.short && r.origen === origen)
    const { fecha, franja } = previa || proximaFranjaShort(config, reservas, redes, desde, minuto)
    const nuevas = { ...reservas }
    for (const red of redes) nuevas[origen + '-' + red] = { red, fecha, zona: config.zona_horaria, origen, short: true, franja }
    if (redes.every(red => reservas[origen + '-' + red]?.fecha === fecha)) return { fecha, zona: config.zona_horaria }
    try {
      await guardarPub('programacion', 'global', { reservas: nuevas }, actual?.version || 0)
      return { fecha, zona: config.zona_horaria }
    } catch (e) { if (e.status !== 409) throw e }
  }
  throw errorPublicacion('La agenda compartida cambió. Volvé a intentar.', 409)
}
export async function posponerHorario (item, desde) {
  if (item.datos.video_path && item.datos.origen_id) throw errorPublicacion('Para mantener el mismo horario en todas las redes, un short no se pospone por destino.', 422)
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
export async function mantenerAgendaCola () {
  const config = (await leerPub('cadencia', 'global'))?.datos
  if (!config?.activo) return false
  const filas = await listarPub('cola')
  const grupos = new Map()
  for (const fila of filas.filter(f => f.datos.video_path && f.datos.origen_id)) {
    const grupo = grupos.get(fila.datos.origen_id) || []
    grupo.push(fila); grupos.set(fila.datos.origen_id, grupo)
  }
  for (const [origen, grupo] of grupos) {
    const pendientes = grupo.filter(f => f.datos.estado === 'pendiente')
    if (pendientes.length && pendientes.some(f => !f.datos.programado_el)) {
      await reservarShort(origen, pendientes.map(f => f.datos.plataforma), Date.now())
      continue
    }
    if (!grupo.every(f => f.datos.estado === 'pendiente')) continue
    const fechaVieja = grupo[0].datos.programado_el
    if (!fechaVieja || fechaVieja >= Date.now() - 15 * 60000) continue
    const redes = grupo.map(f => f.datos.plataforma)
    const minuto = createHash('sha256').update(origen).digest()[0] % 60
    for (let intento = 0; intento < 12; intento++) {
      const actual = await leerPub('programacion', 'global')
      const reservas = actual?.datos?.reservas || {}
      const previas = grupo.map(f => reservas[f.id]).filter(Boolean)
      if (!previas.length || previas[0].fecha !== fechaVieja) break
      const otras = Object.fromEntries(Object.entries(reservas).filter(([, r]) => r.origen !== origen))
      const { fecha, franja } = proximaFranjaShort(config, otras, redes, Date.now(), minuto)
      const nuevas = { ...otras }
      for (const fila of grupo) nuevas[fila.id] = { red: fila.datos.plataforma, fecha, zona: config.zona_horaria, origen, short: true, franja }
      try { await guardarPub('programacion', 'global', { reservas: nuevas }, actual.version); break }
      catch (e) { if (e.status !== 409) throw e }
    }
  }
  const agenda = (await leerPub('programacion', 'global'))?.datos?.reservas || {}
  for (const fila of filas.filter(f => f.datos.estado === 'pendiente' && f.datos.video_path)) {
    const reserva = agenda[fila.id]
    if (reserva && fila.datos.programado_el !== reserva.fecha) {
      try { await guardarPub('cola', fila.id, { ...fila.datos, programado_el: reserva.fecha, proximo_el: reserva.fecha, zona_horaria: reserva.zona }, fila.version) }
      catch (e) { if (e.status !== 409) throw e }
    }
  }
  for (const fila of filas.filter(f => f.datos.estado === 'pendiente' && !f.datos.video_path && !f.datos.programado_el)) {
    const { fecha, zona } = await reservarHorario(fila.id, fila.datos.plataforma, Date.now())
    try { await guardarPub('cola', fila.id, { ...fila.datos, programado_el: fecha, proximo_el: fecha, zona_horaria: zona }, fila.version) }
    catch (e) { if (e.status !== 409) throw e }
  }
  return true
}
export async function encolarPub (origen, d, por) {
  const creado = Date.now(), ids = []
  const plataformas = redesValidas(d.plataformas)
  const turnoShort = d.video_path ? await reservarShort(origen, plataformas, creado) : null
  for (const plataforma of plataformas) {
    const id = origen + '-' + plataforma
    if (!await leerPub('cola', id)) {
      const { fecha, zona } = turnoShort || await reservarHorario(id, plataforma, creado)
      try { await guardarPub('cola', id, { ...d, plataforma, origen_id: origen, estado: estadoInicialEnvio(plataforma, d), creado, aprobado_por: por, aprobado_el: d.aprobado_el || creado, programado_el: fecha, zona_horaria: zona, proximo_el: fecha }) }
      catch (e) { if (e.status !== 409) throw e }
    }
    try { await guardarPub('eventos', 'encolado-' + id, { accion: 'encolado', por, el: creado, item_id: id, plataforma, fuente_url: d.fuente_url || '', aprobado_por: por }) }
    catch (e) { if (e.status !== 409) throw e }
    ids.push(id)
  }
  return ids
}
