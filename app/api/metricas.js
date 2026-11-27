import { exigir, responder } from '../lib/comun.js'
import { REDES, errorPublicacion } from '../lib/publicacion.js'
import { leerPub, listarPub, guardarPub, eventoPub } from '../lib/publicacion_store.js'
import { obtenerMetricas } from '../lib/metricas_redes.js'
import { avanceMonetizacion } from '../lib/monetizacion.js'

const VENTANAS = ['24h', '7d', '28d', 'historico']

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  try {
    const datos = req.method === 'GET' ? req.query : req.body || {}
    // Serie histórica: snapshots diarios guardados en cada sincronización, para la tabla por fecha.
    if (req.method === 'GET' && datos.serie) {
      if (datos.red && !REDES[datos.red]) throw errorPublicacion('Cuenta inválida.')
      if (datos.ventana != null && !VENTANAS.includes(datos.ventana)) throw errorPublicacion('Elegí una ventana válida.')
      const porVentana = new Map()
      for (const m of await listarPub('metricas')) {
        const s = m.datos
        if (!m.id.startsWith('dia-') || (datos.red && s.red !== datos.red) || (datos.ventana && s.ventana !== datos.ventana)) continue
        const clave = `dia-${s.red}-${s.dia}-${s.ventana || ''}`
        const previa = porVentana.get(clave)
        if (!previa || (s.capturado_el || 0) > (previa.capturado_el || 0)) porVentana.set(clave, s)
      }
      const serie = [...porVentana.values()].sort((a, b) => a.dia.localeCompare(b.dia) || (a.capturado_el || 0) - (b.capturado_el || 0))
      return responder(res, 200, { serie })
    }
    // Monetización: avance por red hacia los requisitos, usando el último informe sincronizado de cada red.
    if (req.method === 'GET' && datos.monetizacion) {
      const docs = await listarPub('metricas')
      const monetizacion = Object.fromEntries(Object.keys(REDES).map(red => {
        const mejor = docs.filter(m => m.id.startsWith(red + '-') && m.datos.actual)
          .sort((a, b) => (b.datos.sincronizada_el || 0) - (a.datos.sincronizada_el || 0))[0]
        return [red, avanceMonetizacion(red, mejor?.datos.actual || {})]
      }))
      return responder(res, 200, { monetizacion })
    }
    const red = datos.red, ventana = datos.ventana || '7d'
    if (!REDES[red] || !VENTANAS.includes(ventana)) throw errorPublicacion('Elegí una cuenta y una ventana válidas.')
    const id = red + '-' + ventana, actual = await leerPub('metricas', id)
    if (req.method === 'GET') return responder(res, 200, { datos: actual?.datos || null })
    if (req.method !== 'POST') throw errorPublicacion('Método no permitido.', 405)
    const informeViejoYouTube = red === 'youtube' && actual && !Object.hasOwn(actual.datos, 'vistas_canal')
    if (!informeViejoYouTube && actual?.datos.sincronizada_el > Date.now() - 300000) return responder(res, 200, { datos: actual.datos })
    const publicaciones = (await listarPub('cola')).map(p => p.datos)
    const d = { ...await obtenerMetricas(red, ventana, publicaciones), red, ventana, sincronizada_el: Date.now() }
    await guardarPub('metricas', id, d, actual?.version || 0)
    // Snapshot diario (un doc por red, día y ventana) para la serie histórica.
    const dia = new Date(d.sincronizada_el).toISOString().slice(0, 10), a = d.actual || {}
    const snapId = `dia-${red}-${dia}-${ventana}`
    const campos = ['seguidores', 'vistas', 'likes', 'comentarios', 'compartidos', 'alcance', 'guardados', 'interacciones', 'engagement', 'tiempo_medio', 'retencion']
    const snap = { red, dia, ventana, capturado_el: d.sincronizada_el }
    for (const k of campos) if (typeof a[k] === 'number') snap[k] = a[k]
    if (Number.isFinite(d.vistas_canal)) snap.vistas_canal = d.vistas_canal
    const prevSnap = await leerPub('metricas', snapId)
    await guardarPub('metricas', snapId, snap, prevSnap?.version || 0)
    await eventoPub('metricas_sincronizadas', yo, { plataforma: red, ventana })
    responder(res, 200, { datos: d })
  } catch (e) { responder(res, e.status || 500, { error: e.status ? e.message : 'No se pudieron sincronizar las métricas.' }) }
}
