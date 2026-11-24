import { exigir, responder, BUCKET } from '../lib/comun.js'

// Temporal: configuración del bucket de Supabase. Solo Cuervo (dueño de datos).
const DUEÑOS = new Set(['Cuervo'])
const MIME = 'image/jpeg'

async function storage (opciones = {}) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const clave = process.env.SUPABASE_SERVICE_KEY || ''
  if (!base || !clave) throw new Error('Falta la configuración de Supabase en el servidor.')
  const r = await fetch(`${base}/storage/v1/bucket/${BUCKET}`, {
    ...opciones,
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' }
  })
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}`)
  return r.json()
}

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  if (!DUEÑOS.has(yo)) return responder(res, 403, { error: 'La configuración del bucket la ejecuta el dueño de almacenamiento.' })
  if (!['GET', 'POST'].includes(req.method)) return responder(res, 405, { error: 'Método no permitido.' })
  if (req.method === 'POST' && req.body?.op !== 'habilitar_jpeg') return responder(res, 400, { error: 'Operación no reconocida.' })

  try {
    const actual = await storage()
    const mimes = actual.allowed_mime_types || []
    const finales = mimes.includes(MIME) ? mimes : [...mimes, MIME]
    if (req.method === 'GET') return responder(res, 200, { bucket: BUCKET, mime_actuales: mimes, mime_finales: finales })
    if (mimes.includes(MIME)) return responder(res, 200, { ok: true, ya_habilitado: true, bucket: BUCKET, mime_despues: mimes })

    const cuerpo = {
      id: actual.id,
      name: actual.name,
      public: actual.public,
      allowed_mime_types: finales
    }
    if (actual.file_size_limit != null) cuerpo.file_size_limit = actual.file_size_limit
    await storage({ method: 'PUT', body: JSON.stringify(cuerpo) })
    const verificado = await storage()
    return responder(res, 200, {
      ok: (verificado.allowed_mime_types || []).includes(MIME),
      bucket: BUCKET,
      mime_antes: mimes,
      mime_despues: verificado.allowed_mime_types || [],
      publico: verificado.public
    })
  } catch (e) {
    return responder(res, 500, { error: 'No se pudo actualizar el bucket: ' + e.message })
  }
}
