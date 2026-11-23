import { db, BUCKET } from './comun.js'
import { GRAPH, jsonRemoto, tokenConexion } from './conexiones.js'
import { REDES, errorPublicacion } from './publicacion.js'

const bearer = token => ({ Authorization: 'Bearer ' + token })
const json = (body, token) => ({ method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
async function video (item, completo = false) {
  if (!item.video_path) throw errorPublicacion('Prepará y revisá el video antes de enviarlo.', 422)
  if (completo) {
    const { data, error } = await db().storage.from(BUCKET).download(item.video_path)
    if (error || !data || data.size > 14 * 1024 * 1024) throw errorPublicacion('El video no está disponible o supera los 14 MB.', 422)
    return Buffer.from(await data.arrayBuffer())
  }
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(item.video_path, 86400)
  if (error || !data?.signedUrl) throw errorPublicacion('No se pudo preparar el acceso al video.', 422)
  return data.signedUrl
}
async function buffer (query, t) {
  const d = await jsonRemoto('https://api.buffer.com', json({ query }, t.access_token))
  return d.data
}
async function imagenes (item) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrls(item.imagenes, 86400)
  if (error || data?.some(x => !x.signedUrl)) throw errorPublicacion('No se pudieron preparar las imágenes.', 422)
  return data.map(x => x.signedUrl)
}

// Un paso por llamada. Los identificadores remotos se guardan antes de continuar.
export async function pasoPublicacion (item, checkpoint) {
  const t = await tokenConexion(REDES[item.plataforma].proveedor)
  const texto = [item.titulo, item.descripcion, (item.hashtags || []).join(' ')].filter(Boolean).join('\n\n')
  if (item.plataforma === 'instagram') {
    if (!t.ig_id) throw errorPublicacion('La página de Meta no tiene Instagram Business vinculado.', 424)
    if (!item.remoto_id) {
      const limite = await jsonRemoto(GRAPH + '/' + t.ig_id + '/content_publishing_limit?fields=config,quota_usage', { headers: bearer(t.access_token) })
      const l = limite.data?.[0]
      if (l && l.quota_usage >= l.config?.quota_total) throw errorPublicacion('Instagram llegó al límite de publicaciones. Esperá antes de reintentar.', 429)
      let contenido = { media_type: 'REELS', video_url: item.video_path ? await video(item) : '', caption: texto, share_to_feed: 'true' }
      if (item.imagenes?.length) {
        const urls = await imagenes(item)
        if (urls.length === 1) contenido = { image_url: urls[0], caption: texto }
        else {
          const hijos = await Promise.all(urls.map(image_url => jsonRemoto(GRAPH + '/' + t.ig_id + '/media', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ image_url, is_carousel_item: 'true' }) })))
          contenido = { media_type: 'CAROUSEL', children: hijos.map(x => x.id).join(','), caption: texto }
        }
      }
      const d = await jsonRemoto(GRAPH + '/' + t.ig_id + '/media', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams(contenido) })
      return { remoto_id: d.id, etapa: 'procesando' }
    }
    const d = await jsonRemoto(GRAPH + '/' + item.remoto_id + '?fields=status_code', { headers: bearer(t.access_token) })
    if (d.status_code === 'PUBLISHED') return { estado: 'publicado' }
    if (['ERROR', 'EXPIRED'].includes(d.status_code)) throw errorPublicacion('Instagram no pudo procesar el video.', 422)
    if (d.status_code !== 'FINISHED') return { etapa: 'procesando' }
    await checkpoint({ etapa: 'publicando' })
    const publicado = await jsonRemoto(GRAPH + '/' + t.ig_id + '/media_publish', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ creation_id: item.remoto_id }) })
    return { estado: 'publicado', publicacion_remota: publicado.id }
  }
  if (item.plataforma === 'facebook') {
    if (item.imagenes?.length) {
      const urls = await imagenes(item)
      const fotos = item.fotos_ids || (await Promise.all(urls.map(url => jsonRemoto(GRAPH + '/' + t.page_id + '/photos', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ url, published: 'false' }) })))).map(x => x.id)
      await checkpoint({ fotos_ids: fotos, etapa: 'publicando' })
      const d = await jsonRemoto(GRAPH + '/' + t.page_id + '/feed', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ message: texto, attached_media: JSON.stringify(fotos.map(media_fbid => ({ media_fbid }))) }) })
      return { estado: 'publicado', remoto_id: d.id, publicacion_remota: d.id }
    }
    if (!item.remoto_id) {
      const d = await jsonRemoto(GRAPH + '/' + t.page_id + '/video_reels', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ upload_phase: 'start' }) })
      return { remoto_id: d.video_id, etapa: 'subir' }
    }
    if (item.etapa === 'subir') {
      await jsonRemoto('https://rupload.facebook.com/video-upload/' + (process.env.META_GRAPH_VERSION || 'v27.0') + '/' + item.remoto_id, { method: 'POST', headers: { Authorization: 'OAuth ' + t.access_token, file_url: await video(item) } })
      return { etapa: 'procesando' }
    }
    const d = await jsonRemoto(GRAPH + '/' + item.remoto_id + '?fields=status', { headers: bearer(t.access_token) })
    if (d.status?.publishing_phase?.publish_status === 'published') return { estado: 'publicado', publicacion_remota: item.remoto_id }
    if (d.status?.processing_phase?.status === 'error' || d.status?.uploading_phase?.status === 'error') throw errorPublicacion('Facebook no pudo procesar el video.', 422)
    if (item.etapa === 'confirmando') return { etapa: 'confirmando' }
    if (d.status?.processing_phase?.status !== 'completed') return { etapa: 'procesando' }
    await checkpoint({ etapa: 'publicando' })
    await jsonRemoto(GRAPH + '/' + t.page_id + '/video_reels', { method: 'POST', headers: bearer(t.access_token), body: new URLSearchParams({ upload_phase: 'finish', video_id: item.remoto_id, video_state: 'PUBLISHED', description: texto }) })
    return { etapa: 'confirmando' }
  }
  if (item.plataforma === 'x') {
    if (item.remoto_id) {
      const d = await buffer(`query { post(input: {id: ${JSON.stringify(item.remoto_id)}}) { id status externalLink sentAt } }`, t)
      if (d.post?.sentAt) return { estado: 'publicado', enlace: d.post.externalLink, publicacion_remota: item.remoto_id }
      if (String(d.post?.status).toLowerCase().includes('fail')) throw errorPublicacion('Buffer no pudo publicar en X. Revisá la conexión.', 422)
      return { etapa: 'confirmando' }
    }
    const canal = (await buffer(`query { channel(input: {id: ${JSON.stringify(t.channel_id)}}) { service isDisconnected isLocked } }`, t)).channel
    if (!canal || String(canal.service).toLowerCase() !== 'twitter' || canal.isDisconnected || canal.isLocked) throw errorPublicacion('Revisá que el canal de Buffer sea la cuenta de X conectada del equipo.', 424)
    const assets = item.video_path ? `assets: [{video: {url: ${JSON.stringify(await video(item))}}}]` : item.imagenes?.length ? 'assets: [' + (await imagenes(item)).map(u => '{image: {url: ' + JSON.stringify(u) + '}}').join(',') + ']' : 'assets: []'
    await checkpoint({ etapa: 'publicando' })
    const d = await buffer(`mutation { createPost(input: {channelId: ${JSON.stringify(t.channel_id)}, text: ${JSON.stringify(texto)}, schedulingType: automatic, mode: shareNow, needsApproval: false, ${assets}}) { __typename ... on PostActionSuccess { post { id sentAt externalLink } } } }`, t)
    if (!d.createPost?.post?.id) throw errorPublicacion('Buffer rechazó el contenido o la cuenta de X.', 422)
    return { remoto_id: d.createPost.post.id, enlace: d.createPost.post.externalLink || '', estado: d.createPost.post.sentAt ? 'publicado' : 'procesando', etapa: 'confirmando' }
  }
  if (item.plataforma === 'youtube') {
    if (item.remoto_id) return { estado: 'borrador', enlace: 'https://studio.youtube.com/video/' + item.remoto_id + '/edit' }
    const bytes = await video(item, true)
    const metadata = { snippet: { title: item.titulo, description: [item.descripcion, (item.hashtags || []).join(' ')].join('\n\n'), categoryId: '20' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } }
    const boundary = 'gta6_upload_' + Date.now()
    const body = Buffer.concat([Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: video/mp4\r\n\r\n'), bytes, Buffer.from('\r\n--' + boundary + '--\r\n')])
    await checkpoint({ etapa: 'subiendo_borrador' })
    const d = await jsonRemoto('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', { method: 'POST', headers: { ...bearer(t.access_token), 'Content-Type': 'multipart/related; boundary=' + boundary }, body })
    return { remoto_id: d.id, estado: 'borrador', enlace: 'https://studio.youtube.com/video/' + d.id + '/edit' }
  }
  if (item.plataforma === 'tiktok') {
    if (item.remoto_id) {
      const d = await jsonRemoto('https://open.tiktokapis.com/v2/post/publish/status/fetch/', json({ publish_id: item.remoto_id }, t.access_token))
      if (d.data?.status === 'SEND_TO_USER_INBOX') return { estado: 'borrador', enlace: 'https://www.tiktok.com/' }
      if (d.data?.status === 'FAILED') throw errorPublicacion('TikTok no pudo preparar el borrador. Revisá la cuenta y el formato.', 422)
      return { etapa: 'procesando' }
    }
    const bytes = await video(item, true)
    const d = await jsonRemoto('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', json({ source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 } }, t.access_token))
    const u = new URL(d.data?.upload_url || '')
    if (u.protocol !== 'https:' || !/\.(tiktokapis\.com|tiktokcdn\.com)$/.test(u.hostname)) throw errorPublicacion('TikTok devolvió un destino de subida inesperado.', 502)
    await checkpoint({ remoto_id: d.data.publish_id, etapa: 'subiendo_borrador' })
    const r = await fetch(u, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'Content-Range': 'bytes 0-' + (bytes.length - 1) + '/' + bytes.length }, body: bytes })
    if (!r.ok) throw errorPublicacion('TikTok no recibió el video completo. Revisá el estado antes de reintentar.', 502)
    return { remoto_id: d.data.publish_id, etapa: 'procesando' }
  }
  throw errorPublicacion('Red desconocida.')
}
