import { exigir, responder } from '../lib/comun.js'

// Radar de Twitch con la API oficial (Helix): clips y VODs más vistos de la categoría de GTA VI.
// Las claves viven solo en Vercel (TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET); las compus del equipo nunca las ven.
const JUEGO = 'Grand Theft Auto VI'
const CLIP_MIN_S = 20     // el render necesita al menos 20 s
const VOD_MIN_S = 5 * 60
let token = null

function segundosVod (txt) {
  const m = String(txt || '').match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0
}

export default async function handler (req, res) {
  const yo = exigir(req, res); if (!yo) return
  const id = process.env.TWITCH_CLIENT_ID
  const secreto = process.env.TWITCH_CLIENT_SECRET
  if (!id || !secreto) return responder(res, 503, { error: 'Falta configurar TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET en Vercel' })
  try {
    if (!token || token.vence < Date.now() + 60000) {
      const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secreto, grant_type: 'client_credentials' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error('no se pudo autenticar (' + (d.message || r.status) + ')')
      token = { valor: d.access_token, vence: Date.now() + d.expires_in * 1000 }
    }
    const helix = async ruta => {
      const r = await fetch('https://api.twitch.tv/helix/' + ruta, { headers: { 'Client-Id': id, Authorization: 'Bearer ' + token.valor } })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) token = null
      if (!r.ok) throw new Error(ruta.split('?')[0] + ' respondió ' + (d.message || r.status))
      return d.data || []
    }
    const [juego] = await helix('games?name=' + encodeURIComponent(JUEGO))
    if (!juego) return responder(res, 404, { error: 'Twitch no tiene la categoría ' + JUEGO })
    const horas = Math.min(Math.max(Number(req.query.horas) || 24, 1), 168)
    const desde = new Date(Date.now() - horas * 3600e3).toISOString()
    const [clips, vods] = await Promise.all([
      helix(`clips?game_id=${juego.id}&started_at=${desde}&first=50`),
      helix(`videos?game_id=${juego.id}&period=${horas <= 24 ? 'day' : 'week'}&sort=views&type=archive&first=50`)
    ])
    const vph = (vistas, fecha) => Math.round(vistas / Math.max((Date.now() - Date.parse(fecha)) / 3600e3, 1))
    const videos = [
      ...vods.filter(v => segundosVod(v.duration) >= VOD_MIN_S).map(v => ({
        id: 'twitch_v' + v.id, titulo: v.title, canal: v.user_name, vistas: v.view_count, vph: vph(v.view_count, v.created_at),
        fecha: String(v.created_at).slice(0, 10), idioma: v.language === 'other' ? '' : v.language, url: 'https://www.twitch.tv/videos/' + v.id,
        tipo: 'vod', duracion: segundosVod(v.duration) })),
      ...clips.filter(c => c.duration >= CLIP_MIN_S).map(c => ({
        id: 'twitch_c' + c.id, titulo: c.title, canal: c.broadcaster_name, vistas: c.view_count, vph: vph(c.view_count, c.created_at),
        fecha: String(c.created_at).slice(0, 10), idioma: c.language === 'other' ? '' : c.language, url: 'https://clips.twitch.tv/' + c.id,
        tipo: 'clip', duracion: Math.round(c.duration) }))
    ].sort((a, b) => b.vistas - a.vistas)
    return responder(res, 200, { juego: juego.name, horas, videos })
  } catch (e) {
    return responder(res, 502, { error: 'Twitch: ' + e.message })
  }
}
