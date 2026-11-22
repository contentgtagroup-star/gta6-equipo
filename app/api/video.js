import { db, exigir, responder, BUCKET } from '../lib/comun.js'

const pathValido = p => typeof p === 'string' && /^[A-Za-z0-9_\-]{1,40}\/[A-Za-z0-9_\-.]{1,120}\.mp4$/.test(p)

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  const sb = db().storage.from(BUCKET)
  if (req.method === 'GET') {          // link temporal para ver o bajar un video
    const { path, descargar } = req.query
    if (!pathValido(path)) return responder(res, 400, { error: 'Video inválido' })
    const { data, error } = await sb.createSignedUrl(path, 3600, descargar ? { download: path.split('/').pop() } : undefined)
    return error ? responder(res, 404, { error: error.message }) : responder(res, 200, { url: data.signedUrl })
  }
  if (req.method !== 'POST') return responder(res, 405, { error: 'Método no permitido' })
  const { op, path } = req.body || {}
  if (op === 'subida') {               // link para subir un clip directo a Supabase (sin pasar por Vercel)
    const nuevo = `${yo}/${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.mp4`
    const { data, error } = await sb.createSignedUploadUrl(nuevo)
    return error ? responder(res, 500, { error: error.message }) : responder(res, 200, { path: nuevo, url: data.signedUrl })
  }
  if (op === 'borrar') {
    if (!pathValido(path)) return responder(res, 400, { error: 'Video inválido' })
    const { error } = await sb.remove([path])
    return error ? responder(res, 500, { error: error.message }) : responder(res, 200, { ok: true })
  }
  responder(res, 400, { error: 'Operación inválida' })
}
