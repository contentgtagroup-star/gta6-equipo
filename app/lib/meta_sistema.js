import { errorPublicacion } from './publicacion.js'
import { GRAPH, jsonRemoto } from './conexiones.js'

// Permisos que Meta puede dar al usuario del sistema para este panel.
export const PERMISOS_META_SISTEMA = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'read_insights']
// Sin estos no se puede llegar a la página ni publicar. Los de métricas se avisan, pero no bloquean.
const IMPRESCINDIBLES = ['pages_show_list', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish']

function falta (nombre) {
  throw errorPublicacion('Falta configurar ' + nombre + ' en Vercel para conectar Meta con usuario del sistema.', 503)
}
function vencido (valor, ahora) {
  const numero = Number(valor)
  return Number.isFinite(numero) && numero > 0 && numero * 1000 <= ahora
}
function get (url) {
  return jsonRemoto(url)
}

export async function verificarMetaSistema (por) {
  const token = process.env.META_SYSTEM_USER_TOKEN
  if (!token) falta('META_SYSTEM_USER_TOKEN')
  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET, pageId = process.env.META_PAGE_ID
  if (!appId || !appSecret) falta('META_APP_ID o META_APP_SECRET')
  if (!pageId) falta('META_PAGE_ID')
  const ahora = Date.now()

  const inspeccion = new URL(GRAPH + '/debug_token')
  inspeccion.searchParams.set('input_token', token)
  inspeccion.searchParams.set('access_token', appId + '|' + appSecret)
  const info = (await get(inspeccion)).data || {}
  if (!info.is_valid || String(info.app_id) !== String(appId) || info.type !== 'SYSTEM_USER') {
    throw errorPublicacion('El token no corresponde a un usuario del sistema de esta app de Meta. Generalo en Configuración del negocio → Usuarios del sistema.', 424)
  }
  if (vencido(info.expires_at, ahora) || vencido(info.data_access_expires_at, ahora)) {
    throw errorPublicacion('El token del usuario del sistema venció. Generá uno nuevo y actualizá el secreto en Vercel.', 424)
  }
  const scopes = Array.isArray(info.scopes) ? info.scopes.map(String) : []
  const faltan = PERMISOS_META_SISTEMA.filter(p => !scopes.includes(p))
  const bloqueantes = faltan.filter(p => IMPRESCINDIBLES.includes(p))
  if (bloqueantes.length) {
    throw errorPublicacion('Faltan permisos para publicar: ' + bloqueantes.join(', ') + '. Generá el token otra vez con esos permisos y actualizá el secreto en Vercel.', 424)
  }

  const paginaUrl = new URL(GRAPH + '/' + encodeURIComponent(pageId))
  paginaUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account')
  paginaUrl.searchParams.set('access_token', token)
  const pagina = await get(paginaUrl)
  if (String(pagina.id) !== String(pageId) || !pagina.access_token) {
    throw errorPublicacion('El usuario del sistema no tiene acceso a la página configurada en META_PAGE_ID o no devolvió un token de página.', 424)
  }

  let perfilIg = null
  if (pagina.instagram_business_account?.id) {
    const igUrl = new URL(GRAPH + '/' + encodeURIComponent(pagina.instagram_business_account.id))
    igUrl.searchParams.set('fields', 'id,username')
    igUrl.searchParams.set('access_token', pagina.access_token)
    try { perfilIg = await get(igUrl) } catch {
      throw errorPublicacion('Instagram no confirmó la cuenta de negocio vinculada a la página. Revisá los permisos del token.', 424)
    }
  }

  return { access_token: pagina.access_token, page_id: String(pagina.id), ig_id: perfilIg?.id ? String(perfilIg.id) : undefined,
    cuenta: pagina.name || 'Página de GTA 6', origen: 'system_user', por,
    expira_el: info.expires_at ? Number(info.expires_at) * 1000 : null,
    permisos: scopes, faltan_permisos: faltan }
}
