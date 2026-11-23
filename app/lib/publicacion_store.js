import { randomUUID } from 'node:crypto'
import { db } from './comun.js'
import { errorPublicacion, redesValidas } from './publicacion.js'
import { elegirHorario, diaArgentina, ZONA_PUBLICACION, MAX_DIARIO } from './programacion.js'

const TABLA = 'publicacion_docs'
function falloLectura (error) {
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
async function agendaPub (origen, iniciar, ahora = Date.now()) {
  for (let intento = 0; intento < 12; intento++) {
    const actual = await leerPub('conexiones', 'programacion-global')
    const reservas = { ...actual?.datos.reservas }, ejecuciones = { ...actual?.datos.ejecuciones }
    let reserva = reservas[origen], listo = false
    const dia = diaArgentina(ahora), iniciados = ejecuciones[dia] || {}
    if (!reserva) reserva = elegirHorario(reservas, ejecuciones, ahora)
    if (iniciar && iniciados[origen]) listo = true
    else if (iniciar && reserva.programado_el <= ahora) {
      if (reserva.dia !== dia || ahora - reserva.programado_el > 15 * 60000 || Object.keys(iniciados).length >= MAX_DIARIO) {
        reserva = elegirHorario(reservas, ejecuciones, ahora)
      } else {
        ejecuciones[dia] = { ...iniciados, [origen]: ahora }; listo = true
      }
    }
    reservas[origen] = reserva
    try {
      await guardarPub('conexiones', 'programacion-global', { reservas, ejecuciones }, actual?.version || 0)
      return { ...reserva, zona_horaria: ZONA_PUBLICACION, listo }
    } catch (e) { if (e.status !== 409) throw e }
  }
  throw errorPublicacion('La agenda está recibiendo varias aprobaciones. Volvé a intentar en un momento.', 409)
}
export const programarPub = origen => agendaPub(origen, false)
export const admitirPub = (origen, ahora) => agendaPub(origen, true, ahora)
export async function encolarPub (origen, d, por) {
  const creado = Date.now(), ids = []
  const { programado_el, zona_horaria } = await programarPub(origen)
  for (const plataforma of redesValidas(d.plataformas)) {
    const id = origen + '-' + plataforma
    if (!await leerPub('cola', id)) {
      try { await guardarPub('cola', id, { ...d, plataforma, origen_id: origen, estado: 'pendiente', creado, aprobado_por: por, aprobado_el: d.aprobado_el || creado, programado_el, zona_horaria, proximo_el: programado_el }) }
      catch (e) { if (e.status !== 409) throw e }
    }
    try { await guardarPub('eventos', 'encolado-' + id, { accion: 'encolado', por, el: creado, item_id: id, plataforma, fuente_url: d.fuente_url || '', aprobado_por: por }) }
    catch (e) { if (e.status !== 409) throw e }
    ids.push(id)
  }
  return ids
}
