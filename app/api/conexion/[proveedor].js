import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { exigir, responder } from '../../lib/comun.js'
import { leerPub, guardarPub, eventoPub } from '../../lib/publicacion_store.js'
import { configOAuth, jsonRemoto, guardarConexion, tokenConexion, origenApp, GRAPH } from '../../lib/conexiones.js'
import { errorPublicacion } from '../../lib/publicacion.js'
import { importarConexiones } from '../../lib/importar_conexiones.js'

export default async function handler (req, res) {
  const p = String(req.query.proveedor || '')
  res.setHeader('Cache-Control', 'no-store')
  let etapa = 'iniciar'
  try {
    if (p === 'importar') return responder(res, 200, await importarConexiones(req))
    if (!['meta', 'google', 'tiktok', 'buffer'].includes(p)) throw errorPublicacion('Conexión desconocida.')
    if (req.method === 'POST') {
      const yo = exigir(req, res); if (!yo) return
      if (req.body?.op === 'renovar' && p !== 'meta') { await tokenConexion(p); return responder(res, 200, { ok: true }) }
      if (p === 'buffer') {
        const t = await tokenConexion(p)
        const datos = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { Authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `query { channel(input: {id: ${JSON.stringify(t.channel_id)}}) { id name service isDisconnected isLocked } }` }) })
        const canal = datos.data?.channel
        if (!canal || String(canal.service).toLowerCase() !== 'twitter' || canal.isDisconnected || canal.isLocked) throw errorPublicacion('El canal configurado en Buffer no es una cuenta de X conectada y disponible.', 424)
        const actual = await leerPub('conexiones', p)
        await guardarConexion(p, { ...t, cuenta: canal.name }, actual)
        return responder(res, 200, { ok: true })
      }
      const c = configOAuth(p), state = randomBytes(32).toString('hex')
      await guardarPub('oauth', createHash('sha256').update(state).digest('hex'), { proveedor: p, por: yo, vence: Date.now() + 600000, usado: false })
      res.setHeader('Set-Cookie', 'gta6_oauth_' + p + '=' + state + '; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/api/conexion')
      const url = new URL(c.auth)
      for (const [k, v] of Object.entries({ [p === 'tiktok' ? 'client_key' : 'client_id']: c.id, redirect_uri: c.callback, response_type: 'code', scope: c.scope, state, ...(p === 'google' ? { access_type: 'offline', prompt: 'consent' } : {}) })) url.searchParams.set(k, v)
      return responder(res, 200, { url: url.href })
    }
    if (req.method !== 'GET' || !req.query.state) throw errorPublicacion('Volvé a Conexiones para iniciar el acceso.')
    const state = String(req.query.state), cookie = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gta6_oauth_' + p + '='))?.split('=')[1] || ''
    if (!/^[a-f0-9]{64}$/.test(state) || !/^[a-f0-9]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw errorPublicacion('La sesión de conexión venció. Volvé a iniciarla.', 403)
    const id = createHash('sha256').update(state).digest('hex'), intento = await leerPub('oauth', id)
    if (!intento || intento.datos.usado || intento.datos.vence < Date.now() || intento.datos.proveedor !== p) throw errorPublicacion('El acceso venció. Volvé a conectar.', 403)
    await guardarPub('oauth', id, { ...intento.datos, usado: true }, intento.version)
    if (req.query.error || !req.query.code) throw errorPublicacion('No se completó el permiso de acceso.')
    const c = configOAuth(p), body = new URLSearchParams({ [p === 'tiktok' ? 'client_key' : 'client_id']: c.id, client_secret: c.secret, code: String(req.query.code), redirect_uri: c.callback, grant_type: 'authorization_code' })
    const tokenUrl = new URL(c.token)
    if (p === 'meta') for (const [k, v] of body) tokenUrl.searchParams.set(k, v)
    etapa = 'intercambiar_codigo'
    let t = await jsonRemoto(p === 'meta' ? tokenUrl : c.token, p === 'meta' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    if (!t.access_token) throw errorPublicacion('La red no devolvió un acceso válido.', 502)
    if (p === 'meta') {
      const larga = new URL(GRAPH + '/oauth/access_token')
      for (const [k, v] of Object.entries({ grant_type: 'fb_exchange_token', client_id: c.id, client_secret: c.secret, fb_exchange_token: t.access_token })) larga.searchParams.set(k, v)
      const largo = await jsonRemoto(larga)
      const cuentas = await jsonRemoto(GRAPH + '/me/accounts?fields=id,name,access_token,instagram_business_account', { headers: { Authorization: 'Bearer ' + largo.access_token } })
      const pagina = cuentas.data?.find(x => x.id === process.env.META_PAGE_ID)
      if (!pagina) throw errorPublicacion('La página configurada no está entre los activos autorizados. Revisá META_PAGE_ID y el acceso de Meta.', 424)
      t = { access_token: pagina.access_token, page_id: pagina.id, ig_id: pagina.instagram_business_account?.id, cuenta: pagina.name, expires_in: largo.expires_in }
    }
    if (p === 'google') {
      const canales = await jsonRemoto('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', { headers: { Authorization: 'Bearer ' + t.access_token } })
      const canal = canales.items?.find(x => !process.env.YOUTUBE_CHANNEL_ID || x.id === process.env.YOUTUBE_CHANNEL_ID)
      if (!canal) throw errorPublicacion('No se encontró el canal de YouTube configurado.', 424)
      t.channel_id = canal.id; t.cuenta = canal.snippet.title
    }
    if (p === 'tiktok') {
      etapa = 'consultar_cuenta'
      const user = await jsonRemoto('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', { headers: { Authorization: 'Bearer ' + t.access_token } })
      if (user.error?.code && user.error.code !== 'ok') throw errorPublicacion('TikTok no confirmó la cuenta.', 424)
      t.cuenta = user.data?.user?.display_name || 'TikTok'
    }
    etapa = 'guardar_conexion'
    const actual = await leerPub('conexiones', p)
    await guardarConexion(p, { ...t, refresh_token: t.refresh_token || undefined, expira_el: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : null }, actual)
    await eventoPub('conexion', intento.datos.por, { proveedor: p })
    res.setHeader('Set-Cookie', 'gta6_oauth_' + p + '=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/api/conexion')
    res.writeHead(303, { Location: origenApp() + '/#publicaciones' }); res.end()
  } catch (e) {
    if (p === 'tiktok' && e.remoto) {
      console.warn('conexion_tiktok_fallida', { etapa, codigo: e.codigoRemoto || 'error_no_identificado', http: e.remoto, referencia: e.referenciaRemota || null })
    }
    if (req.method === 'GET') { res.setHeader('Content-Type', 'text/plain; charset=utf-8'); return res.status(e.status || 500).send((e.status ? e.message : 'No se pudo completar la conexión.') + '\nVolvé al panel y probá Conectar otra vez.') }
    responder(res, e.status || 500, { error: e.status ? e.message : 'No se pudo completar la conexión.' })
  }
}
