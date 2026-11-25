import { REDES, ventanaMetricas, errorPublicacion } from './publicacion.js'
import { jsonRemoto, tokenConexion, GRAPH } from './conexiones.js'

const auth = t => ({ headers: { Authorization: 'Bearer ' + t.access_token } })
const fecha = ms => new Date(ms).toISOString().slice(0, 10)
function params (base, datos) { const u = new URL(base); for (const [k, v] of Object.entries(datos)) u.searchParams.set(k, v); return u }
const mapaYT = { views: 'vistas', likes: 'likes', comments: 'comentarios', shares: 'compartidos', subscribersGained: 'follows', averageViewDuration: 'tiempo_medio', averageViewPercentage: 'retencion' }
export function filaYouTube (d, fila) { return Object.fromEntries(d.columnHeaders.map((c, i) => [mapaYT[c.name] || c.name, fila[i]])) }
async function videosRecientesYouTube (t, canal, desde, hasta) {
  const lista = canal.contentDetails?.relatedPlaylists?.uploads
  if (!lista) return []
  const items = await jsonRemoto(params('https://www.googleapis.com/youtube/v3/playlistItems', { part: 'contentDetails', playlistId: lista, maxResults: 50 }), auth(t))
  const ids = (items.items || []).map(x => x.contentDetails?.videoId).filter(Boolean)
  if (!ids.length) return []
  const videos = await jsonRemoto(params('https://www.googleapis.com/youtube/v3/videos', { part: 'snippet,statistics', id: ids.join(',') }), auth(t))
  return (videos.items || []).filter(x => {
    const creado = Date.parse(x.snippet?.publishedAt || '')
    return creado >= desde && creado <= hasta
  }).map(x => ({ id: x.id, titulo: x.snippet?.title, enlace: 'https://www.youtube.com/watch?v=' + x.id,
    creado: Date.parse(x.snippet.publishedAt), vistas: Number(x.statistics?.viewCount ?? 0),
    likes: x.statistics?.likeCount == null ? null : Number(x.statistics.likeCount),
    comentarios: x.statistics?.commentCount == null ? null : Number(x.statistics.commentCount) }))
}
export async function obtenerMetricas (red, ventana, publicaciones = []) {
  const t = await tokenConexion(REDES[red].proveedor), v = ventanaMetricas(ventana)
  const hasta = Date.now(), desde = ventana === 'historico' ? Date.UTC(2020, 0, 1) : v.desde
  if (red === 'youtube') {
    const errorAcceso = e => {
      if (e.status === 424) {
        const razon = e.detalleRemoto || ''
        if (/accessNotConfigured|serviceDisabled|API_KEY_SERVICE_BLOCKED/i.test(razon)) throw errorPublicacion('Habilitá YouTube Analytics API en el proyecto de Google que emitió el token del canal.', 424)
        if (/insufficientPermissions|insufficientAuthenticationScopes|forbidden/i.test(razon)) throw errorPublicacion('El token de YouTube permite publicar, pero no leer Analytics. Autorizá yt-analytics.readonly y renová el token.', 424)
        throw errorPublicacion('YouTube Analytics rechazó el acceso. Revisá la API habilitada y el permiso yt-analytics.readonly del token.', 424)
      }
      throw e
    }
    const hastaDia = new Date(hasta); hastaDia.setUTCHours(0, 0, 0, 0)
    const dur = ventana === 'historico' ? hastaDia.getTime() - desde : hasta - desde
    const rango = { desde: Math.max(Date.UTC(2020, 0, 1), hastaDia.getTime() - dur), hasta: hastaDia.getTime() - 1 }
    async function reporte (a, b, detalle) {
      const q = { ids: 'channel==MINE', startDate: fecha(a), endDate: fecha(b), metrics: Object.keys(mapaYT).join(',') }
      if (detalle) Object.assign(q, { dimensions: 'video', sort: '-views', maxResults: '25' })
      const d = await jsonRemoto(params('https://youtubeanalytics.googleapis.com/v2/reports', q), auth(t)).catch(errorAcceso)
      return (d.rows || []).map(f => filaYouTube(d, f))
    }
    const [cuenta, anterior, canal] = await Promise.all([
      reporte(rango.desde, rango.hasta),
      ventana === 'historico' ? null : reporte(rango.desde - dur, rango.desde - 1),
      jsonRemoto('https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&mine=true', auth(t))
    ])
    const actual = cuenta[0] || {}
    actual.seguidores = canal.items?.[0]?.statistics?.hiddenSubscriberCount ? null : Number(canal.items?.[0]?.statistics?.subscriberCount ?? NaN)
    if (process.env.YOUTUBE_CHANNEL_ID && canal.items?.[0]?.id !== process.env.YOUTUBE_CHANNEL_ID) throw errorPublicacion('El token de YouTube apunta a otro canal. Revisá YOUTUBE_CHANNEL_ID y reconectá.', 424)
    let recientes = [], detalleRecienteNoDisponible = false
    try { recientes = await videosRecientesYouTube(t, canal.items?.[0] || {}, desde, hasta) } catch { detalleRecienteNoDisponible = true }
    return { actual, anterior: anterior?.[0] || null, posts: recientes, rango,
      recientes: detalleRecienteNoDisponible ? null : { videos: recientes.length, vistas: recientes.reduce((s, p) => s + p.vistas, 0) },
      nota: 'YouTube Analytics tarda normalmente 48 a 72 horas en procesar datos. El período de arriba usa Analytics; la tabla muestra contadores actuales acumulados de videos publicados en la ventana (hasta 50 recientes).' + (detalleRecienteNoDisponible ? ' YouTube no devolvió el detalle reciente en esta sincronización.' : '') }
  }
  if (red === 'x') {
    if (!t.organization_id) throw errorPublicacion('Configurá la organización de Buffer para leer sus métricas.', 424)
    const inicio = Math.max(desde, hasta - 364 * 86400000)
    const nombres = { postcount: 'publicaciones_buffer', reactions: 'reacciones', impressions: 'impresiones', reach: 'alcance', likes: 'likes', comments: 'comentarios', shares: 'compartidos', saves: 'guardados', clicks: 'clics', views: 'vistas' }
    const mapear = metricas => Object.fromEntries((metricas || []).filter(m => nombres[m.type.toLowerCase()] && m.value != null && Number.isFinite(Number(m.value))).map(m => [nombres[m.type.toLowerCase()], Number(m.value)]))
    async function agregado (a, b) {
      const query = `query { aggregatedPostMetrics(input: { organizationId: ${JSON.stringify(t.organization_id)}, channelIds: [${JSON.stringify(t.channel_id)}], startDateTime: ${JSON.stringify(new Date(a).toISOString())}, endDateTime: ${JSON.stringify(new Date(b).toISOString())} }) { metrics { type value unit } metricsUpdatedAt } }`
      const d = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      return mapear(d.data?.aggregatedPostMetrics?.metrics)
    }
    let detalleParcial = false
    const ids = publicaciones.filter(p => p.plataforma === 'x' && p.remoto_id && p.estado === 'publicado' && p.publicado_el >= inicio).sort((a, b) => b.publicado_el - a.publicado_el).slice(0, 10)
    let posts = []
    if (ids.length) {
      const query = 'query {' + ids.map((p, i) => ' p' + i + ': post(input: { id: ' + JSON.stringify(p.remoto_id) + ' }) { id externalLink metrics { type value unit } }').join(' ') + ' }'
      try {
        const d = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
        posts = ids.map((p, i) => ({ id: p.remoto_id, titulo: p.titulo, enlace: d.data?.['p' + i]?.externalLink || p.enlace, ...mapear(d.data?.['p' + i]?.metrics) }))
      } catch (e) {
        if (!e.status) throw e
        detalleParcial = true
      }
    }
    return { actual: await agregado(inicio, hasta), anterior: ventana === 'historico' ? null : await agregado(v.anterior_desde, v.anterior_hasta), posts, rango: { desde: inicio, hasta }, nota: 'Las impresiones son el total de los posts del canal incluidos por Buffer en esta ventana; no corresponden a un solo post. Buffer sincroniza aproximadamente una vez por día. El detalle incluye hasta 10 publicaciones registradas por esta app; sus contadores son acumulados.' + (detalleParcial ? ' Buffer no devolvió el detalle por publicación en esta sincronización.' : '') }
  }
  if (red === 'tiktok') {
    const permisos = String(t.scope || '').split(/[\s,]+/)
    const faltan = ['user.info.stats', 'video.list'].filter(p => !permisos.includes(p))
    if (faltan.length) throw errorPublicacion('TikTok todavía no autorizó estas métricas. Faltan permisos: ' + faltan.join(', ') + '. Aplicá los cambios del sandbox y reconectá la cuenta.', 424)
    const [u, videos] = await Promise.all([
      jsonRemoto('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', auth(t)),
      jsonRemoto('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,view_count,like_count,comment_count,share_count', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) })
    ])
    const posts = (videos.data?.videos || []).map(p => ({ id: p.id, titulo: p.title, enlace: p.share_url, creado: p.create_time * 1000, vistas: p.view_count, likes: p.like_count, comentarios: p.comment_count, compartidos: p.share_count }))
    const enVentana = posts.filter(p => p.creado >= desde && p.creado <= hasta)
    const sumar = k => enVentana.reduce((s, p) => s + (Number(p[k]) || 0), 0)
    return { actual: { seguidores: u.data?.user?.follower_count ?? null }, anterior: null, posts: enVentana, rango: { desde, hasta },
      recientes: { videos: enVentana.length, vistas: sumar('vistas'), interacciones: sumar('likes') + sumar('comentarios') + sumar('compartidos') },
      nota: 'El resumen de videos suma contadores acumulados de hasta 20 publicaciones recientes creadas en la ventana. No representa vistas o interacciones ganadas durante esos días. Retención, guardados y follows por post no están disponibles con esta integración.' }
  }
  const id = red === 'instagram' ? t.ig_id : t.page_id
  if (!id) throw errorPublicacion('Conectá la cuenta de Meta correspondiente.', 424)
  const seguidores = await jsonRemoto(params(GRAPH + '/' + id, { fields: red === 'instagram' ? 'followers_count' : 'followers_count' }), auth(t))
  const metricas = red === 'instagram' ? { views: 'vistas', reach: 'alcance', likes: 'likes', comments: 'comentarios', shares: 'compartidos', saves: 'guardados' } : { page_media_view: 'vistas', page_total_media_view_unique: 'alcance', page_post_engagements: 'interacciones' }
  async function agregado (a, b) {
    const out = {}, noDisponibles = []
    // Algunas métricas dependen del permiso o de la cuenta: una faltante no oculta las demás.
    await Promise.all(Object.entries(metricas).map(async ([m, nombre]) => {
      try {
        const q = { metric: m, period: 'day', since: Math.floor(a / 1000), until: Math.floor(b / 1000) }
        if (red === 'instagram') q.metric_type = 'total_value'
        if (red === 'facebook' && nombre === 'alcance') {
          if (ventana === 'historico') { noDisponibles.push(nombre); return }
          q.period = { '24h': 'day', '7d': 'week', '28d': 'days_28' }[ventana]
        }
        const d = await jsonRemoto(params(GRAPH + '/' + id + '/insights', q), auth(t)), valor = d.data?.[0]
        if (valor?.total_value?.value !== undefined) out[nombre] = valor.total_value.value
        else if (red === 'facebook' && nombre === 'alcance' && typeof valor?.values?.at(-1)?.value === 'number') out[nombre] = valor.values.at(-1).value
        else if (valor?.values?.length && !(nombre === 'alcance' && valor.values.length > 1)) out[nombre] = valor.values.reduce((s, x) => s + (typeof x.value === 'number' ? x.value : 0), 0)
        else noDisponibles.push(nombre)
      } catch (e) { if (e.remoto === 401 || e.remoto === 403) throw e; noDisponibles.push(nombre) }
    }))
    if (out.alcance > 0) {
      const interacciones = out.interacciones ?? ['likes', 'comentarios', 'compartidos', 'guardados'].reduce((s, k) => s + (out[k] || 0), 0)
      if (out.interacciones !== undefined || ['likes', 'comentarios', 'compartidos', 'guardados'].some(k => out[k] !== undefined)) out.engagement = interacciones / out.alcance
    }
    return { out, noDisponibles }
  }
  // La ventana histórica se limita al rango que admite cada proveedor, y se informa.
  const inicio = Math.max(desde, hasta - (red === 'instagram' ? 90 : 730) * 86400000)
  const [actual, anterior] = await Promise.all([agregado(inicio, hasta), ventana === 'historico' ? null : agregado(v.anterior_desde, v.anterior_hasta)])
  actual.out.seguidores = seguidores.followers_count ?? null
  const posts = []
  if (red === 'instagram') {
    const d = await jsonRemoto(GRAPH + '/' + id + '/media?fields=id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count&limit=10', auth(t))
    await Promise.all((d.data || []).filter(p => Date.parse(p.timestamp) >= desde).map(async p => {
      const out = { id: p.id, titulo: String(p.caption || p.id).slice(0, 80), enlace: p.permalink, creado: Date.parse(p.timestamp), likes: p.like_count, comentarios: p.comments_count }
      try {
        const metric = 'views,reach,saved,shares' + (p.media_product_type === 'REELS' ? ',ig_reels_avg_watch_time' : '')
        const d = await jsonRemoto(params(GRAPH + '/' + p.id + '/insights', { metric }), auth(t))
        const nombres = { views: 'vistas', reach: 'alcance', saved: 'guardados', shares: 'compartidos', ig_reels_avg_watch_time: 'tiempo_medio' }
        for (const m of d.data || []) {
          const n = m.total_value?.value ?? m.values?.[0]?.value
          if (typeof n === 'number') out[nombres[m.name]] = m.name === 'ig_reels_avg_watch_time' ? n / 1000 : n
        }
      } catch {}
      posts.push(out)
    }))
  } else {
    await Promise.all(publicaciones.filter(p => p.plataforma === 'facebook' && p.publicacion_remota && p.estado === 'publicado' && p.publicado_el >= desde).slice(0, 10).map(async p => {
      const out = { id: p.publicacion_remota, titulo: p.titulo, enlace: p.enlace }
      try {
        const d = await jsonRemoto(GRAPH + '/' + p.publicacion_remota + '?fields=reactions.limit(0).summary(true),comments.limit(0).summary(true),shares', auth(t))
        out.likes = d.reactions?.summary?.total_count; out.comentarios = d.comments?.summary?.total_count; out.compartidos = d.shares?.count
        if (p.video_path) {
          const insight = await jsonRemoto(params(GRAPH + '/' + p.publicacion_remota + '/video_insights', { metric: 'total_video_views,total_video_avg_time_watched' }), auth(t))
          for (const m of insight.data || []) if (typeof m.values?.[0]?.value === 'number') out[m.name === 'total_video_views' ? 'vistas' : 'tiempo_medio'] = m.name === 'total_video_views' ? m.values[0].value : m.values[0].value / 1000
        }
      } catch {}
      posts.push(out)
    }))
  }
  return { actual: actual.out, anterior: anterior?.out || null, posts, rango: { desde: inicio, hasta }, no_disponibles: actual.noDisponibles, nota: 'Datos oficiales de Meta. Las métricas sin soporte se muestran sin valor. El detalle incluye hasta 10 publicaciones recientes (en Facebook, las registradas por esta app), con contadores acumulados. El histórico se limita al rango disponible en la API.' }
}
