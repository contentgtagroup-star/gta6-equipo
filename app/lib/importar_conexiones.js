import { createHash, timingSafeEqual } from 'node:crypto'
import { leerPub, guardarPub } from './publicacion_store.js'
import { guardarConexion, jsonRemoto } from './conexiones.js'
import { errorPublicacion } from './publicacion.js'

// Puente de un solo uso desde el repositorio privado del publicador.
// El permiso temporal solo permite importar estas dos cuentas verificadas.
export async function importarConexiones (req) {
  const permiso = process.env.IMPORTACION_CONEXIONES_TOKEN
  if (!permiso || req.method !== 'POST') throw errorPublicacion('No disponible.', 404)
  const hash = s => createHash('sha256').update(String(s || '')).digest()
  if (!timingSafeEqual(hash(permiso), hash(req.headers['x-importacion']))) throw errorPublicacion('Acceso inválido.', 403)
  const b = req.body || {}
  if (JSON.stringify(b).length > 20000 || !['yt_client_id', 'yt_client_secret', 'yt_refresh_token', 'buffer_api_key'].every(k => typeof b[k] === 'string' && b[k].length > 5 && b[k].length < 8000)) throw errorPublicacion('Faltan los accesos de las integraciones existentes.', 422)
  if (!process.env.YOUTUBE_CHANNEL_ID || !process.env.BUFFER_CHANNEL_ID) throw errorPublicacion('Faltan los canales esperados.', 503)
  const id = 'importacion-' + hash(permiso).toString('hex'), actual = await leerPub('oauth', id)
  if (actual?.datos.usado || actual?.datos.vence > Date.now()) throw errorPublicacion('Esta importación ya se usó o está en curso.', 409)
  let intento = await guardarPub('oauth', id, { usado: false, vence: Date.now() + 300000 }, actual?.version || 0)
  try {
    const t = await jsonRemoto('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: b.yt_client_id, client_secret: b.yt_client_secret, refresh_token: b.yt_refresh_token }) })
    if (!t.access_token || !Number.isFinite(Number(t.expires_in))) throw errorPublicacion('YouTube no confirmó su acceso.', 424)
    const canales = await jsonRemoto('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { Authorization: 'Bearer ' + t.access_token } })
    const youtube = canales.items?.find(c => c.id === process.env.YOUTUBE_CHANNEL_ID)
    if (!youtube) throw errorPublicacion('El acceso no corresponde al canal de YouTube del equipo.', 424)
    const respuesta = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { Authorization: 'Bearer ' + b.buffer_api_key, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query { channel(input: {id: ${JSON.stringify(process.env.BUFFER_CHANNEL_ID)}}) { id name service isDisconnected isLocked } }` }) })
    const x = respuesta.data?.channel
    if (x?.id !== process.env.BUFFER_CHANNEL_ID || String(x.service).toLowerCase() !== 'twitter' || x.isDisconnected || x.isLocked) throw errorPublicacion('El acceso no corresponde al canal de X disponible del equipo.', 424)
    await guardarConexion('google', { access_token: t.access_token, refresh_token: b.yt_refresh_token, client_id: b.yt_client_id, client_secret: b.yt_client_secret, expira_el: Date.now() + Number(t.expires_in) * 1000, channel_id: youtube.id, cuenta: youtube.snippet.title, origen: 'gta-publicador' }, await leerPub('conexiones', 'google'))
    await guardarConexion('buffer', { access_token: b.buffer_api_key, channel_id: x.id, organization_id: process.env.BUFFER_ORGANIZATION_ID, cuenta: x.name, origen: 'gta-publicador' }, await leerPub('conexiones', 'buffer'))
    intento = await guardarPub('oauth', id, { usado: true, terminado_el: Date.now() }, intento.version)
    return { ok: true, cuentas: { youtube: youtube.snippet.title, x: x.name } }
  } catch (e) {
    try { await guardarPub('oauth', id, { usado: false, vence: 0, fallido_el: Date.now() }, intento.version) } catch {}
    throw e
  }
}
