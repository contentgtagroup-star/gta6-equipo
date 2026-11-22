import { categoriasPublicas } from '../lib/categorias.js'
import { db, exigir, responder, todas, BUCKET } from '../lib/comun.js'
import { VERSION_TURNOS } from '../lib/turnos.js'

// Todo lo que muestra la web de una sola vez, con links temporales a los videos
export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  const sb = db()
  const [{ data, error }, { data: turnoDoc, error: errorTurno }] = await Promise.all([
    todas(() => sb.from('docs').select('coleccion,id,datos,version').in('coleccion', ['clips', 'radar', 'escucha', 'equipo', 'fuentes'])),
    sb.from('docs').select('datos').eq('coleccion', 'turnos').eq('id', 'global').maybeSingle()
  ])
  if (error) return responder(res, 500, { error: error.message })
  if (errorTurno) return responder(res, 500, { error: errorTurno.message })
  const out = { categorias: categoriasPublicas(), yo, clips: [], feedback: [], radar: null, referencias: [], escucha: {}, equipo: {}, turno: null, turnos: [], version_actual: VERSION_TURNOS, ahora: Date.now() }
  for (const d of data) {
    if (d.coleccion === 'clips') {
      if (d.datos.estado !== 'descartado') out.clips.push({ ...d.datos, id: d.id, _version: d.version })
      if (d.datos.calificaciones) out.feedback.push({ id: d.id, calificaciones: d.datos.calificaciones, tipo: d.datos.tipo, titulo: d.datos.titulo, gancho: d.datos.gancho, motivo: d.datos.motivo, canal: d.datos.canal })
    }
    else if (d.coleccion === 'radar' && d.id === 'actual') out.radar = d.datos
    else if (d.coleccion === 'fuentes' && d.id === 'referencias') out.referencias = (d.datos && d.datos.items) || []
    else if (d.coleccion === 'escucha') out.escucha[d.id] = d.datos
    else if (d.coleccion === 'equipo') out.equipo[d.id] = d.datos
  }
  if (turnoDoc) {
    const global = turnoDoc.datos || {}
    const publico = t => ({ estado: t.estado, pedido_id: t.pedido_id, pedido_por: t.pedido_por, pedido_el: t.pedido_el,
      asignado: t.asignado, asignado_el: t.asignado_el, cantidad: t.cantidad, categoria: t.categoria, categoria_version: t.categoria_version, fuente: t.fuente || 'youtube', iniciado_el: t.iniciado_el, latido: t.latido,
      terminado_el: t.terminado_el, pausa_compatible: t.pausa_compatible, etapa: t.etapa,
      avance: t.avance, avance_base: t.avance_base,
      pausado_el: t.pausado_el, resumen: t.resumen, tiempos: t.tiempos, reanudar_el: t.reanudar_el })
    if (global.pedido_id) out.turno = publico(global)
    out.turnos = [...(global.pedido_id ? [global] : []), ...(global.pedidos || [])].map(publico)
      .sort((a, b) => (b.pedido_el || 0) - (a.pedido_el || 0))
  }
  const paths = out.clips.map(c => c.video_path).filter(Boolean)
  if (paths.length) {
    const { data: firmados } = await sb.storage.from(BUCKET).createSignedUrls(paths, 21600)
    const mapa = Object.fromEntries((firmados || []).map(f => [f.path, f.signedUrl]))
    for (const c of out.clips) if (c.video_path) c.video_url = mapa[c.video_path] || null
  }
  responder(res, 200, out)
}
