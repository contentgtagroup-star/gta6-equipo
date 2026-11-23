// Normaliza links de video para el pedido directo. La misma semántica que usa
// el panel (leerLink) y el motor (fuente_de): el servidor es el que manda.
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/
const SLUG = /^[A-Za-z0-9_-]{3,100}$/
const CANAL = /^[A-Za-z0-9_]{1,50}$/
const RESERVADOS_TWITCH = new Set(['directory', 'p', 'search', 'settings', 'downloads', 'wallet', 'subscriptions', 'inventory', 'messages'])

export function normalizarEnlace (texto) {
  let s = String(texto == null ? '' : texto).trim()
  if (!s || s.length > 500) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  let u
  try { u = new URL(s) } catch { return null }
  if (!['http:', 'https:'].includes(u.protocol)) return null
  const host = u.hostname.toLowerCase()
  const h = host.replace(/^(www|m|clips)\./, '')
  const partes = u.pathname.split('/').filter(Boolean)

  if (h === 'youtu.be') {
    const id = partes[0]
    if (!ID_YOUTUBE.test(id || '')) return null
    return { id, url: 'https://www.youtube.com/watch?v=' + id, plataforma: 'youtube' }
  }
  if (h === 'youtube.com' || h === 'music.youtube.com') {
    const id = u.searchParams.get('v') || (['shorts', 'live', 'embed'].includes(partes[0]) ? partes[1] : null)
    if (!ID_YOUTUBE.test(id || '')) return null
    return { id, url: 'https://www.youtube.com/watch?v=' + id, plataforma: 'youtube' }
  }
  if (h === 'twitch.tv') {
    if (partes[0] === 'videos' && /^\d+$/.test(partes[1] || '')) {
      const id = 'twitch_v' + partes[1]
      return { id, url: 'https://www.twitch.tv/videos/' + partes[1], plataforma: 'twitch' }
    }
    const clip = partes[1] === 'clip' ? partes[2] : (host.startsWith('clips.') ? partes[0] : null)
    if (clip) {
      const slug = clip.slice(0, 100)
      if (!SLUG.test(slug)) return null
      return { id: 'twitch_c' + slug, url: 'https://clips.twitch.tv/' + slug, plataforma: 'twitch',
        canal: partes[1] === 'clip' ? (partes[0] || '') : '' }
    }
    if (partes.length === 1 && !RESERVADOS_TWITCH.has(partes[0].toLowerCase()) && CANAL.test(partes[0])) {
      return { id: 'twitch_live_' + partes[0], url: 'https://www.twitch.tv/' + partes[0], plataforma: 'twitch', canal: partes[0] }
    }
    return null
  }
  if (h === 'kick.com' && partes[0] && CANAL.test(partes[0])) {
    const canal = partes[0]
    const clip = u.searchParams.get('clip') || (['clips', 'clip'].includes(partes[1]) ? partes[2] : null)
    if (clip) {
      const slug = clip.slice(0, 100)
      if (!SLUG.test(slug)) return null
      return { id: 'kick_c' + slug, url: 'https://kick.com/' + canal + '/clips/' + slug, plataforma: 'twitch', canal }
    }
    if (partes[1] === 'videos' && partes[2]) {
      const video = partes[2].slice(0, 100)
      if (!SLUG.test(video)) return null
      return { id: 'kick_v' + video, url: 'https://kick.com/' + canal + '/videos/' + video, plataforma: 'twitch', canal }
    }
  }
  return null
}

// La nota es texto libre del usuario: se guarda como dato, nunca como instrucción.
export function normalizarNota (valor) {
  if (valor == null) return ''
  if (typeof valor !== 'string') throw new TypeError('La nota debe ser texto')
  const nota = valor.trim()
  if (nota.length > 200) throw new RangeError('La nota no puede superar 200 caracteres')
  return nota
}
