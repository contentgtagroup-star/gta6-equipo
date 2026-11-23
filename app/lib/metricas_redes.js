import { REDES, ventanaMetricas, errorPublicacion } from './publicacion.js'
import { jsonRemoto, tokenConexion, GRAPH } from './conexiones.js'

const auth = t => ({ headers: { Authorization: 'Bearer ' + t.access_token } })
const fecha = ms => new Date(ms).toISOString().slice(0, 10)
function params (base, datos) { const u = new URL(base); for (const [k, v] of Object.entries(datos)) u.searchParams.set(k, v); return u }
const mapaYT = { views: 'vistas', likes: 'likes', comments: 'comentarios', shares: 'compartidos', subscribersGained: 'follows', averageViewDuration: 'tiempo_medio', averageViewPercentage: 'retencion' }
export function filaYouTube (d, fila) { return Object.fromEntries(d.columnHeaders.map((c, i) => [mapaYT[c.name] || c.name, fila[i]])) }
export async function obtenerMetricas (red, ventana, publicaciones = []) {
  const t = await tokenConexion(REDES[red].proveedor), v = ventanaMetricas(ventana)
  const hasta = Date.now(), desde = ventana === 'historico' ? Date.UTC(2020, 0, 1) : v.desde
  if (red === 'youtube') {
    const hastaDia = new Date(hasta); hastaDia.setUTCHours(0, 0, 0, 0)
    const dur = ventana === 'historico' ? hastaDia.getTime() - desde : hasta - desde
    const rango = { desde: Math.max(Date.UTC(2020, 0, 1), hastaDia.getTime() - dur), hasta: hastaDia.getTime() - 1 }
    async function reporte (a, b, detalle) {
      const q = { ids: 'channel==MINE', startDate: fecha(a), endDate: fecha(b), metrics: Object.keys(mapaYT).join(',') }
      if (detalle) Object.assign(q, { dimensions: 'video', sort: '-views', maxResults: '25' })
      const d = await jsonRemoto(params('https://youtubeanalytics.googleapis.com/v2/reports', q), auth(t))
      return (d.rows || []).map(f => filaYouTube(d, f))
    }
    const [cuenta, posts, anterior, canal] = await Promise.all([
      reporte(rango.desde, rango.hasta), reporte(rango.desde, rango.hasta, true),
      ventana === 'historico' ? null : reporte(rango.desde - dur, rango.desde - 1),
      jsonRemoto('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', auth(t))
    ])
    const actual = cuenta[0] || {}
    actual.seguidores = canal.items?.[0]?.statistics?.hiddenSubscriberCount ? null : Number(canal.items?.[0]?.statistics?.subscriberCount ?? NaN)
    return { actual, anterior: anterior?.[0] || null, posts, rango, nota: 'YouTube Analytics informa por día cerrado. Los videos muestran las 25 publicaciones con más vistas en esa ventana.' }
  }
  if (red === 'x') {
    if (!t.organization_id) throw errorPublicacion('Configurá la organización de Buffer para leer sus métricas.', 424)
    async function agregado (a, b) {
      const query = `query { aggregatedPostMetrics(input: { organizationId: ${JSON.stringify(t.organization_id)}, channelIds: [${JSON.stringify(t.channel_id)}], startDateTime: ${JSON.stringify(new Date(a).toISOString())}, endDateTime: ${JSON.stringify(new Date(b).toISOString())} }) { metrics { type value unit } metricsUpdatedAt } }`
      const d = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const nombres = { impressions: 'impresiones', reach: 'alcance', likes: 'likes', comments: 'comentarios', shares: 'compartidos', saves: 'guardados', clicks: 'clics', views: 'vistas' }
      return Object.fromEntries((d.data?.aggregatedPostMetrics?.metrics || []).filter(m => nombres[m.type.toLowerCase()]).map(m => [nombres[m.type.toLowerCase()], Number(m.value)]))
    }
    const ids = publicaciones.filter(p => p.plataforma === 'x' && p.remoto_id && p.estado === 'publicado' && p.publicado_el >= desde).slice(0, 10)
    let posts = []
    if (ids.length) {
      const query = 'query {' + ids.map((p, i) => ' p' + i + ': post(input: {id: ' + JSON.stringify(p.remoto_id) + '}) { id externalLink metrics { type value unit } }').join(' ') + ' }'
      const d = await jsonRemoto('https://api.buffer.com', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      const nombres = { impressions: 'impresiones', reach: 'alcance', likes: 'likes', comments: 'comentarios', shares: 'compartidos', saves: 'guardados', clicks: 'clics', views: 'vistas' }
      posts = ids.map((p, i) => ({ id: p.remoto_id, titulo: p.titulo, enlace: d.data?.['p' + i]?.externalLink, ...Object.fromEntries((d.data?.['p' + i]?.metrics || []).filter(m => nombres[m.type.toLowerCase()]).map(m => [nombres[m.type.toLowerCase()], Number(m.value)])) }))
    }
    return { actual: await agregado(desde, hasta), anterior: ventana === 'historico' ? null : await agregado(v.anterior_desde, v.anterior_hasta), posts, rango: { desde, hasta }, nota: 'Buffer sincroniza aproximadamente una vez por día. El detalle incluye hasta 10 publicaciones registradas por esta app; sus contadores son acumulados.' }
  }
  if (red === 'tiktok') {
    const [u, videos] = await Promise.all([
      jsonRemoto('https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count', auth(t)),
      jsonRemoto('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,share_url,view_count,like_count,comment_count,share_count', { method: 'POST', headers: { ...auth(t).headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) })
    ])
    const posts = (videos.data?.videos || []).map(p => ({ id: p.id, titulo: p.title, enlace: p.share_url, creado: p.create_time * 1000, vistas: p.view_count, likes: p.like_count, comentarios: p.comment_count, compartidos: p.share_count }))
    return { actual: { seguidores: u.data?.user?.follower_count ?? null }, anterior: null, posts: posts.filter(p => p.creado >= desde), rango: { desde, hasta }, nota: 'TikTok devuelve contadores acumulados de hasta 20 videos recientes. No equivalen a interacciones ganadas en la ventana. Retención, guardados y follows por post no están disponibles con esta integración.' }
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
        const d = await jsonRemoto(params(GRAPH + '/' + id + '/insights', q), auth(t)), valor = d.data?.[0]
        if (valor?.total_value?.value !== undefined) out[nombre] = valor.total_value.value
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
      const out = { id: p.id, titulo: String(p.caption || p.id).slice(0, 80), enlace: p.permalink, likes: p.like_count, comentarios: p.comments_count }
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
