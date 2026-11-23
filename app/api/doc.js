import { categoriaPorId, validarContenido } from '../lib/categorias.js'
import { db, exigir, responder, todas, coleccionValida, idValido } from '../lib/comun.js'

// Une campos (solo primer nivel; {"__delete__": true} borra el campo)
function unir (base, cambios) {
  const out = { ...base }
  for (const [k, v] of Object.entries(cambios || {})) {
    if (v && typeof v === 'object' && v.__delete__ === true) delete out[k]
    else out[k] = v
  }
  return out
}

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  const sb = db()
  if (req.method === 'GET') {
    const { col, id } = req.query
    if (!coleccionValida(col)) return responder(res, 400, { error: 'Colección inválida' })
    if (id) {
      if (!idValido(id)) return responder(res, 400, { error: 'Id inválido' })
      const { data, error } = await sb.from('docs').select('id,datos,version').eq('coleccion', col).eq('id', id).maybeSingle()
      if (error) return responder(res, 500, { error: error.message })
      return responder(res, 200, data ? { existe: true, ...data } : { existe: false })
    }
    const { data, error } = await todas(() => sb.from('docs').select('coleccion,id,datos,version').eq('coleccion', col))
    if (error) return responder(res, 500, { error: error.message })
    return responder(res, 200, { docs: data })
  }
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido' })
  const { op, col, id, datos, version } = req.body || {}
  if (!coleccionValida(col) || !idValido(id)) return responder(res, 400, { error: 'Colección o id inválido' })
  if (col === 'turnos') return responder(res, 403, { error: 'Los turnos se gestionan desde el panel' })
  if (JSON.stringify(datos || {}).length > 200000) return responder(res, 413, { error: 'Documento muy grande' })
  const { data: actual, error: e1 } = await sb.from('docs').select('datos,version').eq('coleccion', col).eq('id', id).maybeSingle()
  if (e1) return responder(res, 500, { error: e1.message })
  if (version != null && actual && actual.version !== version) return responder(res, 409, { error: 'El documento cambió', version: actual.version })
  if (op === 'borrar') {
    if (!actual) return responder(res, 200, { ok: true })
    const { error } = await sb.from('docs').delete().eq('coleccion', col).eq('id', id).eq('version', actual.version)
    return error ? responder(res, 500, { error: error.message }) : responder(res, 200, { ok: true })
  }
  if (op !== 'set' && op !== 'update') return responder(res, 400, { error: 'Operación inválida' })
  if (op === 'update' && !actual) return responder(res, 404, { error: 'No existe' })
  let nuevos = op === 'set' ? (datos || {}) : unir(actual.datos, datos)
  if (col === 'clips') {
    if (nuevos.estado === 'corregir' && datos?.estado === 'corregir') nuevos = { ...nuevos, corrige_por: yo }
    if (nuevos.estado === 'corrigiendo') {
      const dueño = actual?.datos?.corrige_por || actual?.datos?.responsable
      if (dueño !== yo) return responder(res, 403, { error: 'Esta corrección espera a la compu de quien la pidió' })
      nuevos = { ...nuevos, corrige_por: dueño, corrige_ahora: yo }
    }
    if (actual?.datos?.estado === 'corrigiendo' && nuevos.estado === 'listo' &&
        (actual.datos.corrige_por || actual.datos.responsable) !== yo) {
      return responder(res, 403, { error: 'Esta corrección pertenece a otra compu' })
    }
    // Conservá la categoría y calidad al actualizar metadatos o corregir clips.
    if (actual?.datos?.categoria && !nuevos.categoria) nuevos = { ...nuevos, categoria: actual.datos.categoria, calidad: nuevos.calidad || actual.datos.calidad }
    if (nuevos.turno_id && !nuevos.tipo) {
      const { data: global, error: et } = await sb.from('docs').select('datos').eq('coleccion', 'turnos').eq('id', 'global').maybeSingle()
      if (et) return responder(res, 500, { error: et.message })
      const t = [global?.datos, ...(global?.datos?.pedidos || [])].find(t => t?.pedido_id === nuevos.turno_id)
      if (t?.categoria) {
        if (nuevos.categoria && nuevos.categoria !== t.categoria) return responder(res, 400, { error: 'La categoría no coincide con el pedido' })
        nuevos = { ...nuevos, categoria: t.categoria }
      }
    }
    let c
    try { c = categoriaPorId(nuevos.categoria) } catch (e) { return responder(res, 400, { error: e.message }) }
    if (c) {
      if (nuevos.receta) nuevos = { ...nuevos, receta: { ...nuevos.receta, categoria: c.id, categoria_version: c.configurationVersion } }
      nuevos.categoria_version = c.configurationVersion
      if (nuevos.estado === 'listo' && nuevos.tipo !== 'recopilacion') {
        const anteriores = []
        for (let desde = 0; ; desde += 1000) {
          const { data, error } = await sb.from('docs').select('id,datos').eq('coleccion', 'clips').range(desde, desde + 999)
          if (error) return responder(res, 500, { error: error.message })
          anteriores.push(...(data || []).filter(x => x.id !== id).map(x => x.datos))
          if ((data || []).length < 1000) break
        }
        const errores = validarContenido(nuevos, anteriores)
        if (errores.length) return responder(res, 400, { error: 'El clip no cumple la categoría', detalles: errores })
      }
    }
  }
  if (!actual) {
    const { error } = await sb.from('docs').insert({ coleccion: col, id, datos: nuevos, version: 1 })
    return error ? responder(res, 409, { error: error.message }) : responder(res, 200, { ok: true, version: 1 })
  }
  const { data, error } = await sb.from('docs').update({ datos: nuevos, version: actual.version + 1, actualizado: new Date().toISOString() })
    .eq('coleccion', col).eq('id', id).eq('version', actual.version).select('version')
  if (error) return responder(res, 500, { error: error.message })
  if (!data || !data.length) return responder(res, 409, { error: 'El documento cambió' })
  return responder(res, 200, { ok: true, version: data[0].version })
}
