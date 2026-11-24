import { db, exigir, responder, todas, BUCKET } from '../lib/comun.js'
import { eventoPub, listarPub } from '../lib/publicacion_store.js'
import { planReciclaje, planLimpiezaPendientes, humano } from '../lib/reciclaje.js'

const CONFIRMACION_LIMPIEZA = 'DESCARTAR_CLIPS_SIN_APROBAR'
// Según el PTM, datos y almacenamiento los opera Cuervo. La clave del panel
// identifica a cualquier integrante, así que el borrado necesita dueño explícito.
const DUEÑOS_LIMPIEZA = new Set(['Cuervo'])

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

async function cargarInventario (sb) {
  const [{ data: docs, error }, cola, sugerencias, trabajos, archivos] = await Promise.all([
    todas(() => sb.from('docs').select('coleccion,id,datos,version,actualizado').eq('coleccion', 'clips')),
    listarPub('cola', sb), listarPub('sugerencias', sb), listarPub('trabajos', sb), listarArchivos(sb)
  ])
  if (error) throw error
  return {
    docs: docs || [],
    cola: cola.map(d => d.datos),
    sugerencias: sugerencias.map(d => d.datos),
    trabajos: trabajos.map(d => d.datos),
    archivos,
    clips: (docs || []).map(d => ({ id: d.id, ...d.datos, _actualizado_db: d.actualizado }))
  }
}

async function descartarCandidato (sb, doc, candidato, yo, lote) {
  const ahora = new Date().toISOString()
  const bloqueado = { ...doc.datos, estado: 'limpiando', limpieza_id: lote, limpieza_iniciada: Date.now(), limpieza_por: yo }
  const { data: toma, error: errorToma } = await sb.from('docs').update({ datos: bloqueado, version: doc.version + 1, actualizado: ahora })
    .eq('coleccion', 'clips').eq('id', doc.id).eq('version', doc.version).eq('datos->>estado', 'listo').select('version')
  if (errorToma) return { id: doc.id, path: candidato.path, ok: false, error: errorToma.message }
  if (!toma?.length) return { id: doc.id, path: candidato.path, ok: false, omitido: true, error: 'El clip cambió antes de bloquearlo' }

  const { error: errorBorrado } = await sb.storage.from(BUCKET).remove([candidato.path])
  if (errorBorrado) {
    const { error: errorRestaurar } = await sb.from('docs').update({ datos: doc.datos, version: doc.version + 2, actualizado: new Date().toISOString() })
      .eq('coleccion', 'clips').eq('id', doc.id).eq('version', doc.version + 1).eq('datos->>limpieza_id', lote)
    if (errorRestaurar) console.error('No se pudo desbloquear el clip tras el fallo de borrado:', doc.id, errorRestaurar.message)
    return { id: doc.id, path: candidato.path, ok: false, error: errorBorrado.message, restaurado: !errorRestaurar }
  }

  const descartado = {
    ...bloqueado,
    estado: 'descartado',
    descartado_por: yo,
    descartado_el: Date.now(),
    motivo_descarte: 'limpieza_automatica_sin_aprobar',
    archivo_reciclado_path: candidato.path
  }
  delete descartado.video_path
  delete descartado.limpieza_id
  delete descartado.limpieza_iniciada
  const cerrar = version => sb.from('docs').update({ datos: descartado, version: version + 1, actualizado: new Date().toISOString() })
    .eq('coleccion', 'clips').eq('id', doc.id).eq('version', version).eq('datos->>limpieza_id', lote).select('version')
  let fin = await cerrar(doc.version + 1)
  if (fin.error || !fin.data?.length) {
    const { data: actuales } = await sb.from('docs').select('version,datos').eq('coleccion', 'clips').eq('id', doc.id).limit(1)
    const actual = actuales?.[0]
    if (actual?.datos?.limpieza_id === lote) fin = await cerrar(actual.version)
  }
  if (fin.error || !fin.data?.length) {
    console.error('Clip borrado sin cierre de metadata:', doc.id, lote, fin.error?.message || '')
    return { id: doc.id, path: candidato.path, ok: false, borrado: true, inconsistente: true, error: fin.error?.message || 'El archivo se borró pero no se pudo cerrar la metadata' }
  }
  try { await eventoPub('clip_sin_aprobar_descartado', yo, { clip_id: doc.id, bytes: candidato.bytes, antiguedad_dias: candidato.dias }) } catch (e) { console.error('No se pudo registrar el evento de limpieza:', e?.message || e) }
  return { id: doc.id, path: candidato.path, bytes: candidato.bytes, ok: true }
}

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  if (!['GET', 'POST'].includes(req.method)) return responder(res, 405, { error: 'Método no permitido.' })
  if (req.method === 'POST' && !DUEÑOS_LIMPIEZA.has(yo)) return responder(res, 403, { error: 'La limpieza de datos la ejecuta el dueño de almacenamiento.' })
  try {
    const sb = db()
    const dias = Math.min(365, Math.max(0, Number(req.query?.dias) || 7))
    const diasSinAprobar = Math.min(365, Math.max(1, Number(req.query?.dias_sin_aprobar ?? req.body?.dias_sin_aprobar ?? req.body?.dias) || 14))
    if (req.method === 'POST' && (req.body?.op !== 'limpiar_sin_aprobar' || req.body?.confirmar !== CONFIRMACION_LIMPIEZA)) {
      return responder(res, 400, { error: 'La limpieza requiere op="limpiar_sin_aprobar" y la confirmación explícita.' })
    }
    if (req.method === 'POST' && diasSinAprobar < 14) return responder(res, 400, { error: 'La limpieza no permite una antigüedad menor a 14 días.' })
    const { docs, cola, sugerencias, trabajos, archivos, clips } = await cargarInventario(sb)
    const plan = planReciclaje({
      cola, clips, sugerencias, trabajos, archivos
    }, { dias })
    const limpieza = planLimpiezaPendientes({
      cola, clips, sugerencias, trabajos, archivos
    }, { dias: diasSinAprobar })
    if (req.method === 'POST') {
      const maximo = Math.min(50, Math.max(1, Number(req.body?.maximo) || 10))
      const porId = new Map(docs.map(d => [d.id, d]))
      const lote = 'limpieza-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const resultados = []
      for (const candidato of limpieza.candidatos.slice(0, maximo)) {
        const doc = porId.get(candidato.id)
        if (doc) resultados.push(await descartarCandidato(sb, doc, { ...candidato, dias: diasSinAprobar }, yo, lote))
      }
      const borrados = resultados.filter(r => r.ok)
      return responder(res, 200, {
        ok: resultados.every(r => r.ok),
        simulacion: false,
        lote,
        dias: diasSinAprobar,
        candidatos_detectados: limpieza.candidatos.length,
        procesados: resultados.length,
        borrados: borrados.length,
        bytes_recuperados: borrados.reduce((s, r) => s + (r.bytes || 0), 0),
        bytes_recuperados_humano: humano(borrados.reduce((s, r) => s + (r.bytes || 0), 0)),
        resultados
      })
    }
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
      muestra_retenidos: plan.retenidos.slice(0, 50).map(r => ({ ...r, bytes_humano: humano(r.bytes) })),
      limpieza_sin_aprobar: {
        dias: diasSinAprobar,
        candidatos: limpieza.candidatos.length,
        bytes_recuperables: limpieza.bytes_total,
        bytes_recuperables_humano: humano(limpieza.bytes_total),
        retenidos: limpieza.retenidos.length,
        muestra_candidatos: limpieza.candidatos.slice(0, 50).map(c => ({ ...c, bytes_humano: humano(c.bytes) })),
        muestra_retenidos: limpieza.retenidos.slice(0, 50).map(r => ({ ...r, bytes_humano: humano(r.bytes) }))
      }
    })
  } catch (e) {
    const accion = req.method === 'POST' ? 'No se pudo ejecutar la limpieza. ' : 'No se pudo simular el reciclaje. '
    return responder(res, 500, { error: accion + (e?.message || '') })
  }
}
