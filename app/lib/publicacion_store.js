import { randomUUID } from 'node:crypto'
import { db } from './comun.js'
import { errorPublicacion, redesValidas, REDES } from './publicacion.js'

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
export async function encolarPub (origen, d, por) {
  const creado = Date.now(), ids = []
  for (const plataforma of redesValidas(d.plataformas)) {
    const id = origen + '-' + plataforma
    if (!await leerPub('cola', id)) {
      try { await guardarPub('cola', id, { ...d, plataforma, origen_id: origen, estado: REDES[plataforma]?.modo === 'manual' ? 'manual' : 'pendiente', creado, aprobado_por: por, aprobado_el: d.aprobado_el || creado, proximo_el: creado }) }
      catch (e) { if (e.status !== 409) throw e }
    }
    try { await guardarPub('eventos', 'encolado-' + id, { accion: 'encolado', por, el: creado, item_id: id, plataforma, fuente_url: d.fuente_url || '', aprobado_por: por }) }
    catch (e) { if (e.status !== 409) throw e }
    ids.push(id)
  }
  return ids
}
