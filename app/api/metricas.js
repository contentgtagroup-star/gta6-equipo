import { exigir, responder } from '../lib/comun.js'
import { REDES, errorPublicacion } from '../lib/publicacion.js'
import { leerPub, listarPub, guardarPub, eventoPub } from '../lib/publicacion_store.js'
import { obtenerMetricas } from '../lib/metricas_redes.js'

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  try {
    const datos = req.method === 'GET' ? req.query : req.body || {}
    const red = datos.red, ventana = datos.ventana || '7d'
    if (!REDES[red] || !['24h', '7d', '28d', 'historico'].includes(ventana)) throw errorPublicacion('Elegí una cuenta y una ventana válidas.')
    const id = red + '-' + ventana, actual = await leerPub('metricas', id)
    if (req.method === 'GET') return responder(res, 200, { datos: actual?.datos || null })
    if (req.method !== 'POST') throw errorPublicacion('Método no permitido.', 405)
    if (actual?.datos.sincronizada_el > Date.now() - 300000) return responder(res, 200, { datos: actual.datos })
    const publicaciones = (await listarPub('cola')).map(p => p.datos)
    const d = { ...await obtenerMetricas(red, ventana, publicaciones), red, ventana, sincronizada_el: Date.now() }
    await guardarPub('metricas', id, d, actual?.version || 0)
    await eventoPub('metricas_sincronizadas', yo, { plataforma: red, ventana })
    responder(res, 200, { datos: d })
  } catch (e) { responder(res, e.status || 500, { error: e.status ? e.message : 'No se pudieron sincronizar las métricas.' }) }
}
