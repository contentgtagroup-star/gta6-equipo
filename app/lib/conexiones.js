import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { leerPub, guardarPub } from './publicacion_store.js'
import { errorPublicacion, REDES } from './publicacion.js'

export const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v27.0')

// YouTube puede usar el token renovable que ya tenía gta-publicador, sin app OAuth nueva.
export function usarYoutubeTokens () {
  const modo = String(process.env.YOUTUBE_AUTH_MODE || process.env.GOOGLE_AUTH_MODE || '').trim().toLowerCase()
  if (modo) return modo === 'refresh_token'
  return !!process.env.YT_REFRESH_TOKEN
}
export function youtubeRenovable (datos = {}) {
  const modo = String(process.env.YOUTUBE_AUTH_MODE || process.env.GOOGLE_AUTH_MODE || '').trim().toLowerCase()
  return modo ? modo === 'refresh_token' : usarYoutubeTokens() || datos.origen === 'refresh_token'
}
function faltanYoutube () {
  return ['YT_CLIENT_ID', 'YT_CLIENT_SECRET', 'YT_REFRESH_TOKEN'].filter(k => !process.env[k])
}
async function renovarYoutube () {
  const faltan = faltanYoutube()
  if (faltan.length) throw errorPublicacion('Falta configurar ' + faltan.join(', ') + ' en Vercel para conectar YouTube.', 503)
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.YT_CLIENT_ID, client_secret: process.env.YT_CLIENT_SECRET, refresh_token: process.env.YT_REFRESH_TOKEN })
  let d
  try { d = await jsonRemoto('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) }
  catch (e) {
    if (e.codigoRemoto === 'invalid_grant') { const error = errorPublicacion('El acceso renovable de YouTube dejó de ser válido. Reconectá el canal.', 424); error.codigoRemoto = 'invalid_grant'; throw error }
    throw e
  }
  if (!d.access_token) throw errorPublicacion('Google no devolvió un acceso válido para YouTube.', 502)
  return { access_token: d.access_token, expira_el: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null }
}
export async function verificarYoutubeTokens (por) {
  const canalId = process.env.YOUTUBE_CHANNEL_ID
  if (!canalId) throw errorPublicacion('Falta configurar YOUTUBE_CHANNEL_ID en Vercel para conectar YouTube.', 503)
  const acceso = await renovarYoutube()
  const canales = await jsonRemoto('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { Authorization: 'Bearer ' + acceso.access_token } })
  const canal = (canales.items || []).find(x => String(x.id) === String(canalId))
  if (!canal) throw errorPublicacion('El token de YouTube no da acceso al canal configurado en YOUTUBE_CHANNEL_ID.', 424)
  return { ...acceso, channel_id: canal.id, cuenta: canal.snippet?.title || 'YouTube', origen: 'refresh_token', por }
}
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
function detalleTikTok (datos) {
  let codigo = typeof datos.error === 'string' ? datos.error : datos.error?.code
  const mensajes = {
    invalid_client: 'La app rechazó sus credenciales. Revisá que Client Key y Client Secret sean del mismo sandbox.',
    invalid_grant: 'El código de acceso venció, ya se usó o no coincide con la app o su dirección de retorno. Iniciá una conexión nueva desde el panel.',
    invalid_request: 'TikTok rechazó el formato o algún parámetro de la solicitud de acceso.',
    redirect_uri_mismatch: 'La dirección de retorno no coincide con la usada para autorizar. Revisá el callback del panel en Login Kit.',
    invalid_scope: 'La app no tiene habilitados los permisos solicitados.',
    unauthorized_client: 'La app no está autorizada para este tipo de conexión.',
    access_denied: 'La cuenta no autorizó el acceso solicitado.',
    scope_not_authorized: 'La cuenta no autorizó el permiso necesario para consultar su perfil.',
    scope_permission_missed: 'Falta un permiso para consultar los datos solicitados.',
    access_token_invalid: 'TikTok rechazó el acceso de la cuenta. Iniciá una conexión nueva.',
    rate_limit_exceeded: 'TikTok limitó temporalmente las solicitudes. Esperá antes de volver a conectar.',
    server_error: 'TikTok tiene un error temporal. Probá más tarde.',
    temporarily_unavailable: 'TikTok no está disponible temporalmente. Probá más tarde.'
  }
  if (codigo === 'invalid_request' && /redirect_?uri/i.test(String(datos.error_description || ''))) codigo = 'redirect_uri_mismatch'
  if (!Object.hasOwn(mensajes, codigo)) codigo = 'error_no_identificado'
  const referencia = datos.log_id || datos.error?.log_id
  return { codigo, mensaje: mensajes[codigo] || 'TikTok rechazó la solicitud; hace falta revisar la configuración de la conexión.',
    referencia: typeof referencia === 'string' && /^[A-Za-z0-9]{12,80}$/.test(referencia) ? referencia : null }
}
export async function jsonRemoto (url, opciones = {}) {
  const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(45000), redirect: 'error' })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || (d.error && d.error.code !== 'ok' && d.error.code !== 0) || d.errors?.length) {
    const e = errorPublicacion(r.status === 401 ? 'La plataforma rechazó el acceso. Verificá o reconectá la cuenta.' : r.status === 403 ? 'La plataforma denegó esta operación. Revisá los permisos de la cuenta.' : 'La plataforma rechazó la operación. Revisá permisos, formato y límites de la cuenta.', r.status === 401 || r.status === 403 ? 424 : 502)
    e.remoto = r.status
    const codigo = typeof d.error === 'string' ? d.error : d.error?.code
    if (['invalid_grant', 'invalid_token', 'access_token_invalid'].includes(codigo)) e.codigoRemoto = codigo
    if (new URL(url).hostname === 'graph.facebook.com' && Number(codigo) === 190) e.codigoRemoto = 'invalid_token'
    if (d.errors?.length) e.detalleRemoto = d.errors.map(x => x.message).filter(Boolean).join(' | ').slice(0, 300)
    if (new URL(url).hostname === 'youtubeanalytics.googleapis.com') e.detalleRemoto = String(d.error?.errors?.[0]?.reason || d.error?.status || '').slice(0, 80)
    if (new URL(url).hostname === 'open.tiktokapis.com') {
      const detalle = detalleTikTok(d)
      e.message = `TikTok (${detalle.codigo}): ${detalle.mensaje}`
      e.codigoRemoto = detalle.codigo
      e.referenciaRemota = detalle.referencia
    }
    throw e
  }
  return d
}
export async function guardarConexion (proveedor, datos, actual) {
  const fila = { sobre: cifrarConexion(proveedor, datos), sincronizada_el: Date.now(), estado: 'conectada', cuenta: datos.cuenta || '', expira_el: datos.expira_el || null, refresh_expira_el: datos.refresh_expira_el || null }
  for (const k of ['origen', 'ig_id', 'permisos', 'faltan_permisos']) if (datos[k] !== undefined) fila[k] = datos[k]
  return guardarPub('conexiones', proveedor, fila, actual?.version || 0)
}
export async function marcarConexionVencida (proveedor) {
  const d = await leerPub('conexiones', proveedor)
  if (d) await guardarPub('conexiones', proveedor, { ...d.datos, estado: 'token_vencido' }, d.version)
}
export function configOAuth (p) {
  const callback = origenApp() + '/api/conexion/' + p
  const sandboxTikTok = process.env.TIKTOK_ENV === 'sandbox'
  const configs = {
    meta: { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET, auth: 'https://www.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v27.0') + '/dialog/oauth', token: GRAPH + '/oauth/access_token', scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts,instagram_manage_insights,read_insights' },
    google: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly' },
    tiktok: { id: sandboxTikTok ? process.env.TIKTOK_SANDBOX_CLIENT_KEY : process.env.TIKTOK_CLIENT_KEY, secret: sandboxTikTok ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET : process.env.TIKTOK_CLIENT_SECRET, auth: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/', scope: 'user.info.basic,user.info.stats,video.upload,video.list' }
  }
  const c = configs[p]
  if (!c?.id || !c.secret) throw errorPublicacion('Falta configurar la app de ' + p + ' en el servidor.', 503)
  llave()
  return { ...c, callback }
}
export async function tokenConexion (proveedor) {
  if (proveedor === 'buffer') {
    const faltan = ['BUFFER_API_KEY', 'BUFFER_CHANNEL_ID'].filter(k => !process.env[k])
    if (faltan.length) throw errorPublicacion('Falta configurar ' + faltan.join(', ') + ' en Vercel para conectar X con Buffer.', 424)
    return { access_token: process.env.BUFFER_API_KEY, channel_id: process.env.BUFFER_CHANNEL_ID, organization_id: process.env.BUFFER_ORGANIZATION_ID }
  }
  const actual = await leerPub('conexiones', proveedor)
  if (!actual?.datos.sobre) throw errorPublicacion('Conectá la cuenta de ' + proveedor + ' antes de publicar.', 424)
  let t = descifrarConexion(proveedor, actual.datos.sobre)
  if (!t.expira_el || t.expira_el > Date.now() + 120000) return t
  if (proveedor === 'google' && youtubeRenovable(actual.datos)) {
    try { t = { ...t, ...(await renovarYoutube()) } }
    catch (e) { if (e.codigoRemoto === 'invalid_grant') await marcarConexionVencida(proveedor); throw e }
    await guardarConexion(proveedor, t, actual)
    return t
  }
  if (proveedor === 'tiktok' && t.refresh_expira_el && t.refresh_expira_el <= Date.now()) {
    await marcarConexionVencida(proveedor)
    throw errorPublicacion('El acceso renovable de TikTok venció. Reconectá la cuenta.', 424)
  }
  if (!t.refresh_token || proveedor === 'meta') throw errorPublicacion('La conexión venció. Reconectá la cuenta.', 424)
  if (actual.datos.refrescando_hasta > Date.now()) throw errorPublicacion('La cuenta está renovando su acceso. Volvé a intentar en un momento.', 409)
  const bloqueo = await guardarPub('conexiones', proveedor, { ...actual.datos, refrescando_hasta: Date.now() + 60000 }, actual.version)
  const c = configOAuth(proveedor)
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_secret: c.secret, [proveedor === 'tiktok' ? 'client_key' : 'client_id']: c.id })
  let d
  try { d = await jsonRemoto(c.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) }
  catch (e) { if (e.codigoRemoto === 'invalid_grant') await marcarConexionVencida(proveedor); throw e }
  t = { ...t, ...d, refresh_token: d.refresh_token || t.refresh_token, expira_el: Date.now() + Number(d.expires_in) * 1000,
    refresh_expira_el: d.refresh_expires_in ? Date.now() + Number(d.refresh_expires_in) * 1000 : t.refresh_expira_el }
  await guardarConexion(proveedor, t, bloqueo)
  return t
}
export async function estadosConexiones () {
  const cache = {}
  for (const p of ['meta', 'google', 'tiktok', 'buffer']) {
    const d = await leerPub('conexiones', p)
    cache[p] = d?.datos || {}
    if (p === 'buffer' && process.env.BUFFER_API_KEY && process.env.BUFFER_CHANNEL_ID) cache[p] = { ...cache[p], estado: cache[p].estado || 'sin_verificar' }
    if (p === 'buffer') {
      const faltan = ['BUFFER_API_KEY', 'BUFFER_CHANNEL_ID'].filter(k => !process.env[k])
      if (faltan.length) cache[p] = { ...cache[p], estado: 'config_incompleta', falta_config: faltan.join(', ') }
    }
    if (p === 'google' && youtubeRenovable(cache[p])) {
      const faltan = faltanYoutube()
      if (!process.env.YOUTUBE_CHANNEL_ID) faltan.push('YOUTUBE_CHANNEL_ID')
      if (faltan.length) cache[p] = { ...cache[p], estado: 'config_incompleta', falta_config: faltan.join(', ') }
    }
    if (p === 'tiktok' && cache[p].sobre) {
      const nombres = process.env.TIKTOK_ENV === 'sandbox' ? ['TIKTOK_SANDBOX_CLIENT_KEY', 'TIKTOK_SANDBOX_CLIENT_SECRET'] : ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']
      const faltan = nombres.filter(k => !process.env[k])
      if (faltan.length) cache[p] = { ...cache[p], estado: 'config_incompleta', falta_config: faltan.join(', ') }
    }
    if (p === 'meta' && cache[p].origen === 'system_user') {
      const faltan = ['META_SYSTEM_USER_TOKEN', 'META_APP_ID', 'META_APP_SECRET', 'META_PAGE_ID'].filter(k => !process.env[k])
      if (faltan.length) cache[p] = { ...cache[p], estado: 'config_incompleta', falta_config: faltan.join(', ') }
    }
  }
  return Object.entries(REDES).map(([id, r]) => {
    // Instagram no tiene conexión propia: solo aparece conectada si la página de Meta trajo una cuenta de negocio.
    const d = id === 'instagram' ? (cache.meta?.ig_id ? cache.meta : {}) : (cache[r.proveedor] || {})
    const renovable = (r.proveedor === 'google' && youtubeRenovable(d) || r.proveedor === 'tiktok') && !!d.sobre && (!d.refresh_expira_el || d.refresh_expira_el > Date.now())
    const vencido = d.estado === 'token_vencido' || (d.refresh_expira_el && d.refresh_expira_el <= Date.now()) || (!renovable && d.expira_el && d.expira_el <= Date.now() && d.estado !== 'config_incompleta')
    let permisos = d.permisos || []
    if (id === 'tiktok' && d.sobre) {
      try { permisos = String(descifrarConexion('tiktok', d.sobre).scope || '').split(/[\s,]+/).filter(Boolean) } catch {}
    }
    return { id, ...r, estado: vencido ? 'token_vencido' : d.estado || 'sin_conectar', sincronizada_el: d.sincronizada_el || null, cuenta_conectada: d.cuenta || '',
      metodo: d.origen || (d.sobre ? 'oauth' : undefined), permisos, faltan_permisos: d.faltan_permisos || [], falta_config: d.falta_config || '',
      ...(id === 'tiktok' ? { entorno: process.env.TIKTOK_ENV === 'sandbox' ? 'sandbox' : 'production' } : {}) }
  })
}
