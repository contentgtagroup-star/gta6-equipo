import { exigir, responder } from '../lib/comun.js'
import { REDES, errorPublicacion } from '../lib/publicacion.js'
import { listarTrazabilidad } from '../lib/publicacion_store.js'

// Lectura propia de la trazabilidad (eventos), filtrable por plataforma, acción y rango de fechas.
export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  try {
    if (req.method !== 'GET') throw errorPublicacion('Método no permitido.', 405)
    const q = req.query || {}
    if (q.plataforma && !REDES[q.plataforma]) throw errorPublicacion('Plataforma inválida.')
    const accion = q.accion ? String(q.accion).slice(0, 60) : ''
    const desde = q.desde != null && q.desde !== '' ? Number(q.desde) : null
    const hasta = q.hasta != null && q.hasta !== '' ? Number(q.hasta) : null
    if ((desde != null && !Number.isFinite(desde)) || (hasta != null && !Number.isFinite(hasta))) throw errorPublicacion('Rango de fechas inválido.')
    const cursor = q.cursor_el && q.cursor_id ? { el: Number(q.cursor_el), id: String(q.cursor_id) } : null
    const { filas, siguiente } = await listarTrazabilidad({ plataforma: q.plataforma || '', accion, desde, hasta, cursor })
    responder(res, 200, { eventos: filas.map(f => ({ ...f.datos, id: f.id })), siguiente })
  } catch (e) { responder(res, e.status || 500, { error: e.status ? e.message : 'No se pudo leer la trazabilidad.' }) }
}
