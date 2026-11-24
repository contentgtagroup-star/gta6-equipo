import { db, exigir, responder, todas, BUCKET } from '../lib/comun.js'
import { listarPub } from '../lib/publicacion_store.js'
import { planReciclaje, humano } from '../lib/reciclaje.js'

// Lista todos los archivos del bucket con su tamaño (una pasada por carpeta de usuario).
async function listarArchivos (sb) {
  const bucket = sb.storage.from(BUCKET)
  const archivos = [], carpetas = []
  const { data: raiz, error } = await bucket.list('', { limit: 1000 })
  if (error) throw error
  for (const e of raiz || []) { if (e.id) archivos.push({ path: e.name, size: e.metadata?.size || 0 }); else carpetas.push(e.name) }
  for (const carpeta of carpetas) {
    for (let off = 0; ; off += 1000) {
      const { data, error: e } = await bucket.list(carpeta, { limit: 1000, offset: off })
      if (e) throw e
      for (const x of data || []) if (x.id) archivos.push({ path: carpeta + '/' + x.name, size: x.metadata?.size || 0 })
      if (!data || data.length < 1000) break
    }
  }
  return archivos
}

// SIMULACIÓN de reciclaje: solo lectura. Lista candidatos, motivo y bytes recuperables.
// No borra nada. El borrado real es una entrega posterior, previa autorización.
export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  if (req.method !== 'GET') return responder(res, 405, { error: 'Método no permitido. Esta ruta solo simula, no borra.' })
  try {
    const sb = db()
    const dias = Math.min(365, Math.max(0, Number(req.query?.dias) || 7))
    const [{ data: docs, error }, cola, sugerencias, trabajos, archivos] = await Promise.all([
      todas(() => sb.from('docs').select('id,datos').eq('coleccion', 'clips')),
      listarPub('cola'), listarPub('sugerencias'), listarPub('trabajos'), listarArchivos(sb)
    ])
    if (error) return responder(res, 500, { error: error.message })
    const plan = planReciclaje({
      cola: cola.map(d => d.datos),
      clips: (docs || []).map(d => ({ id: d.id, ...d.datos })),
      sugerencias: sugerencias.map(d => d.datos),
      trabajos: trabajos.map(d => d.datos),
      archivos
    }, { dias })
    return responder(res, 200, {
      simulacion: true,
      aviso: 'Solo simulación: no se borró ningún archivo.',
      bucket: BUCKET,
      dias,
      archivos_totales: archivos.length,
      bytes_bucket: archivos.reduce((s, a) => s + (a.size || 0), 0),
      bytes_bucket_humano: humano(archivos.reduce((s, a) => s + (a.size || 0), 0)),
      candidatos: plan.candidatos.length,
      bytes_recuperables: plan.bytes_total,
      bytes_recuperables_humano: humano(plan.bytes_total),
      retenidos: plan.retenidos.length,
      muestra_candidatos: plan.candidatos.slice(0, 50).map(c => ({ ...c, bytes_humano: humano(c.bytes) })),
      muestra_retenidos: plan.retenidos.slice(0, 50).map(r => ({ ...r, bytes_humano: humano(r.bytes) }))
    })
  } catch (e) { return responder(res, 500, { error: 'No se pudo simular el reciclaje. ' + (e?.message || '') }) }
}
