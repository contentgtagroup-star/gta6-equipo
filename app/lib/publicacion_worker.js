import { listarPub, guardarPub, eventoPub, encolarPub } from './publicacion_store.js'
import { db } from './comun.js'
import { pasoPublicacion } from './publicar_redes.js'
import { marcarConexionVencida } from './conexiones.js'
import { REDES } from './publicacion.js'

export async function actualizarClipPublicado (clipId, yo) {
  if (!clipId) return
  const envios = (await listarPub('cola')).filter(p => p.datos.clip_id === clipId && p.datos.estado !== 'cancelado')
  if (!envios.length || envios.some(p => p.datos.estado !== 'publicado')) return
  const { data: c, error } = await db().from('docs').select('datos,version').eq('coleccion', 'clips').eq('id', clipId).maybeSingle()
  if (error || !c?.datos.publicacion_cola || c.datos.estado !== 'aprobado') return
  await db().from('docs').update({ datos: { ...c.datos, estado: 'publicado', publicado_el: Date.now(), publicado_por: yo }, version: c.version + 1 }).eq('coleccion', 'clips').eq('id', clipId).eq('version', c.version)
}

export async function procesarPublicaciones (yo) {
  // La aprobación guardada es la intención durable: repara una respuesta cortada
  // entre aprobar y completar todos los destinos, sin duplicar los ya encolados.
  const aprobadas = (await listarPub('sugerencias')).filter(s => s.datos.estado === 'aprobada' && !s.datos.encolado && s.datos.aprobado_por)
  for (const s of aprobadas.slice(0, 1)) {
    await encolarPub('sug-' + s.id, s.datos, s.datos.aprobado_por)
    try { await guardarPub('sugerencias', s.id, { ...s.datos, encolado: true }, s.version) } catch (e) { if (e.status !== 409) throw e }
  }
  const { data: clips, error: errorClips } = await db().from('docs').select('id,datos,version').eq('coleccion', 'clips').eq('datos->>publicacion_cola', 'true').in('datos->>estado', ['aprobado', 'publicado']).limit(100)
  if (!errorClips) for (const c of (clips || []).filter(c => !c.datos.publicacion_encolada && c.datos.publicacion_snapshot).slice(0, 1)) {
    await encolarPub('clip-' + c.id, c.datos.publicacion_snapshot, c.datos.aprobado_por)
    await db().from('docs').update({ datos: { ...c.datos, publicacion_encolada: true }, version: c.version + 1 }).eq('coleccion', 'clips').eq('id', c.id).eq('version', c.version)
  }
  if (process.env.PUBLICACION_ACTIVA !== '1') return { ok: true, activo: false }
  const cola = (await listarPub('cola')).filter(d => ['pendiente', 'procesando', 'enviando'].includes(d.datos.estado) && (d.datos.proximo_el || 0) <= Date.now()).sort((a, b) => (a.datos.proximo_el || 0) - (b.datos.proximo_el || 0))
  for (let d of cola) {
    if (!d.datos.aprobado_por) continue
    if (d.datos.estado === 'enviando') {
      if (d.datos.vence > Date.now()) continue
      await guardarPub('cola', d.id, { ...d.datos, estado: 'revisar', error: 'Se interrumpió un envío. Revisá la red antes de volver a enviar para evitar duplicados.' }, d.version)
      await eventoPub('envio_interrumpido', yo, { item_id: d.id }); continue
    }
    try { d = await guardarPub('cola', d.id, { ...d.datos, estado: 'enviando', vence: Date.now() + 180000, procesado_por: yo }, d.version) } catch (e) { if (e.status === 409) continue; throw e }
    const checkpoint = async cambios => { d = await guardarPub('cola', d.id, { ...d.datos, ...cambios }, d.version) }
    try {
      if (d.datos.clip_id) {
        const { data, error } = await db().from('docs').select('datos').eq('coleccion', 'clips').eq('id', d.datos.clip_id).maybeSingle()
        if (error || !data || !['aprobado', 'publicado'].includes(data.datos.estado)) {
          await checkpoint({ estado: d.datos.remoto_id ? 'revisar' : 'cancelado', error: 'El clip ya no está aprobado. Revisá la biblioteca antes de enviarlo.' })
          await eventoPub('aprobacion_retirada', yo, { item_id: d.id }); return { ok: true, item_id: d.id }
        }
      }
      const siguiente = await pasoPublicacion(d.datos, checkpoint)
      const estado = siguiente.estado || 'procesando'
      await checkpoint({ ...siguiente, estado, error: '', proximo_el: Date.now() + 30000, ...(estado === 'publicado' ? { publicado_el: Date.now() } : {}), ...(estado === 'borrador' ? { borrador_el: Date.now() } : {}) })
      await eventoPub(estado, yo, { item_id: d.id, plataforma: d.datos.plataforma, aprobado_por: d.datos.aprobado_por, fuente_url: d.datos.fuente_url, remoto_id: d.datos.remoto_id || '', resultado: estado })
      if (estado === 'publicado') { try { await actualizarClipPublicado(d.datos.clip_id, yo) } catch {} }
    } catch (e) {
      if (e.status === 409 && !['publicando', 'subiendo_borrador'].includes(d.datos.etapa)) {
        await checkpoint({ estado: 'procesando', proximo_el: Date.now() + 30000 })
        return { ok: true, item_id: d.id }
      }
      if (e.remoto === 401 || e.remoto === 403) {
        try { await marcarConexionVencida(REDES[d.datos.plataforma].proveedor) } catch {}
      }
      // Una respuesta perdida puede haber publicado: nunca se reintenta a ciegas.
      const estado = ['publicando', 'subiendo_borrador'].includes(d.datos.etapa) || !e.status ? 'revisar' : 'error'
      await checkpoint({ estado, error: e.status ? e.message : 'No se pudo confirmar la respuesta de la plataforma. Revisá la cuenta antes de reintentar.' })
      await eventoPub(estado, yo, { item_id: d.id, resultado: d.datos.error, aprobado_por: d.datos.aprobado_por })
    }
    return { ok: true, item_id: d.id }
  }
  return { ok: true, item_id: null }
}
