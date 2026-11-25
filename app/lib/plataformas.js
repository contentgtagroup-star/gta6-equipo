// Fuente de verdad de plataformas por host, para todo el equipo.
// clip = sirve para CREAR CLIP (video descargable); publicacion = sirve para generar una publicación.
// enlaces.js (clips) y el leerLink del panel deben seguir esta lista; hay un test que lo verifica.
export const PLATAFORMAS = {
  'x.com': { nombre: 'X', publicacion: true },
  'twitter.com': { nombre: 'X', publicacion: true },
  'youtube.com': { nombre: 'YouTube', clip: true, publicacion: true },
  'youtu.be': { nombre: 'YouTube', clip: true, publicacion: true },
  'tiktok.com': { nombre: 'TikTok', publicacion: true },
  'instagram.com': { nombre: 'Instagram', publicacion: true },
  'facebook.com': { nombre: 'Facebook', publicacion: true },
  'fb.watch': { nombre: 'Facebook', publicacion: true },
  'fb.com': { nombre: 'Facebook', publicacion: true },
  'twitch.tv': { nombre: 'Twitch', clip: true, publicacion: true },
  'clips.twitch.tv': { nombre: 'Twitch', clip: true, publicacion: true },
  'kick.com': { nombre: 'Kick', clip: true, publicacion: true },
  'streamscharts.com': { nombre: 'Web', publicacion: true },
  'github.com': { nombre: 'Web', publicacion: true },
  'socialblade.com': { nombre: 'Web', publicacion: true }
}

// Saca www./m./web./mobile. (no toca clips., que es un host propio en el mapa).
export function hostBase (hostname) {
  return String(hostname || '').replace(/^(www|m|web|mobile)\./, '').toLowerCase()
}

export function plataformaDe (hostname) {
  return (PLATAFORMAS[hostBase(hostname)] || {}).nombre || ''
}

// Mapa host -> nombre de las plataformas admitidas como fuente de publicación.
export const DOMINIOS_PUBLICACION = Object.fromEntries(
  Object.entries(PLATAFORMAS).filter(([, v]) => v.publicacion).map(([h, v]) => [h, v.nombre])
)
