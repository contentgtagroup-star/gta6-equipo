import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { leerPub, guardarPub } from './publicacion_store.js'
import { errorPublicacion, REDES } from './publicacion.js'

export const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v27.0')
export function origenApp () {
  const url = process.env.PUBLICACION_ORIGIN
  if (!url || !/^https:\/\/[^/?#]+$/.test(url)) throw errorPublicacion('Falta configurar PUBLICACION_ORIGIN en el servidor.', 503)
  return url
}
function llave () {
  const key = Buffer.from(process.env.PUBLICACION_CIPHER_KEY || '', 'base64')
  if (key.length !== 32) throw errorPublicacion('Falta configurar PUBLICACION_CIPHER_KEY en el servidor.', 503)
  return key
}
export function cifrarConexion (proveedor, datos) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', llave(), iv)
  c.setAAD(Buffer.from(proveedor))
  const texto = Buffer.concat([c.update(JSON.stringify(datos)), c.final()])
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), texto: texto.toString('base64') }
}
export function descifrarConexion (proveedor, sobre) {
  const c = createDecipheriv('aes-256-gcm', llave(), Buffer.from(sobre.iv, 'base64'))
  c.setAAD(Buffer.from(proveedor)); c.setAuthTag(Buffer.from(sobre.tag, 'base64'))
  return JSON.parse(Buffer.concat([c.update(Buffer.from(sobre.texto, 'base64')), c.final()]).toString())
}
export async function jsonRemoto (url, opciones = {}) {
  const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(45000), redirect: 'error' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || (d.error && d.error.code !== 'ok' && d.error.code !== 0) || d.errors?.length) {
    const e = errorPublicacion(r.status === 401 || r.status === 403 ? 'La conexión venció o faltan permisos. Reconectá la cuenta.' : 'La plataforma rechazó la operación. Revisá permisos, formato y límites de la cuenta.', r.status === 401 || r.status === 403 ? 424 : 502)
    e.remoto = r.status
    throw e
  }
  return d
}
export async function guardarConexion (proveedor, datos, actual) {
  return guardarPub('conexiones', proveedor, { sobre: cifrarConexion(proveedor, datos), sincronizada_el: Date.now(), estado: 'conectada', cuenta: datos.cuenta || '', expira_el: datos.expira_el || null }, actual?.version || 0)
}
export async function marcarConexionVencida (proveedor) {
  const d = await leerPub('conexiones', proveedor)
  if (d) await guardarPub('conexiones', proveedor, { ...d.datos, estado: 'token_vencido' }, d.version)
}
export function configOAuth (p) {
  const callback = origenApp() + '/api/conexion/' + p
  const configs = {
    meta: { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET, auth: 'https://www.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v27.0') + '/dialog/oauth', token: GRAPH + '/oauth/access_token', scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_manage_insights,read_insights' },
    google: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly' },
    tiktok: { id: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET, auth: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/', scope: 'user.info.basic,user.info.stats,video.upload,video.list' }
  }
  const c = configs[p]
  if (!c?.id || !c.secret) throw errorPublicacion('Falta configurar la app de ' + p + ' en el servidor.', 503)
  llave()
  return { ...c, callback }
}
export async function tokenConexion (proveedor) {
  if (proveedor === 'buffer') {
    if (!process.env.BUFFER_API_KEY || !process.env.BUFFER_CHANNEL_ID) throw errorPublicacion('Falta conectar X en Buffer y configurar su integración.', 424)
    return { access_token: process.env.BUFFER_API_KEY, channel_id: process.env.BUFFER_CHANNEL_ID, organization_id: process.env.BUFFER_ORGANIZATION_ID }
  }
  const actual = await leerPub('conexiones', proveedor)
  if (!actual?.datos.sobre) throw errorPublicacion('Conectá la cuenta de ' + proveedor + ' antes de publicar.', 424)
  let t = descifrarConexion(proveedor, actual.datos.sobre)
  if (!t.expira_el || t.expira_el > Date.now() + 120000) return t
  if (!t.refresh_token || proveedor === 'meta') throw errorPublicacion('La conexión venció. Reconectá la cuenta.', 424)
  if (actual.datos.refrescando_hasta > Date.now()) throw errorPublicacion('La cuenta está renovando su acceso. Volvé a intentar en un momento.', 409)
  const bloqueo = await guardarPub('conexiones', proveedor, { ...actual.datos, refrescando_hasta: Date.now() + 60000 }, actual.version)
  const c = configOAuth(proveedor)
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_secret: c.secret, [proveedor === 'tiktok' ? 'client_key' : 'client_id']: c.id })
  const d = await jsonRemoto(c.token, { method: 'POST', body })
  t = { ...t, ...d, refresh_token: d.refresh_token || t.refresh_token, expira_el: Date.now() + Number(d.expires_in) * 1000 }
  await guardarConexion(proveedor, t, bloqueo)
  return t
}
export async function estadosConexiones () {
  const cache = {}
  for (const p of ['meta', 'google', 'tiktok', 'buffer']) {
    const d = await leerPub('conexiones', p)
    cache[p] = d?.datos || {}
    if (p === 'buffer' && process.env.BUFFER_API_KEY && process.env.BUFFER_CHANNEL_ID) cache[p] = { ...cache[p], estado: cache[p].estado || 'sin_verificar' }
  }
  return Object.entries(REDES).map(([id, r]) => {
    const d = cache[r.proveedor]
    const vencido = d.expira_el && d.expira_el <= Date.now()
    return { id, ...r, estado: vencido ? 'token_vencido' : d.estado || 'sin_conectar', sincronizada_el: d.sincronizada_el || null, cuenta_conectada: d.cuenta || '' }
  })
}
