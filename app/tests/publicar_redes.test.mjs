import test from 'node:test'
import assert from 'node:assert/strict'
import { pasoPublicacion } from '../lib/publicar_redes.js'
import { cifrarConexion } from '../lib/conexiones.js'

Object.assign(process.env, { SUPABASE_URL: 'https://unit.supabase.co', SUPABASE_SERVICE_KEY: 'fixture', PUBLICACION_CIPHER_KEY: Buffer.alloc(32, 3).toString('base64'), BUFFER_API_KEY: 'fixture', BUFFER_CHANNEL_ID: 'canal-x' })
const original = globalThis.fetch, llamadas = []
const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } })
const item = plataforma => ({ plataforma, video_path: 'Eze/clip.mp4', titulo: 'Una caja escondida', descripcion: '¿Qué tiene adentro?', hashtags: ['#GTA6'], aprobado_por: 'Eze' })
let red = '', enviado = false, estadoPost = 'sent', falloBuffer = false
globalThis.fetch = async (url, op = {}) => {
  const u = new URL(url); llamadas.push({ url: u.href, op })
  if (u.hostname === 'unit.supabase.co') {
    if (u.pathname.startsWith('/rest/')) {
      const p = u.searchParams.get('id').slice(3)
      return respuesta([{ id: p, version: 1, datos: { sobre: cifrarConexion(p, { access_token: 'fixture', page_id: 'pagina', ig_id: 'ig', expira_el: Date.now() + 9999999 }) } }])
    }
    if (u.pathname.includes('/sign/')) return respuesta({ signedURL: '/object/sign/clips/Eze/clip.mp4?token=fixture' })
    return new Response('video-fixture', { status: 200, headers: { 'Content-Type': 'video/mp4' } })
  }
  if (red === 'youtube' && u.hostname === 'www.googleapis.com') return respuesta({ id: 'yt-uno' })
  if (red === 'tiktok' && u.pathname.endsWith('/inbox/video/init/')) return respuesta({ data: { publish_id: 'tt-uno', upload_url: 'https://upload.tiktokapis.com/video/uno' }, error: { code: 'ok' } })
  if (red === 'tiktok' && u.hostname === 'upload.tiktokapis.com') return new Response('', { status: 201 })
  if (red === 'tiktok' && u.pathname.endsWith('/status/fetch/')) return respuesta({ data: { status: 'SEND_TO_USER_INBOX' }, error: { code: 'ok' } })
  if (red === 'x' && u.hostname === 'api.buffer.com') {
    const { query } = JSON.parse(op.body)
    if (falloBuffer) return respuesta({ errors: [{ message: 'Cannot query field isDisconnected on type Channel.' }] })
    if (query.includes('channel(')) return respuesta({ data: { channel: { id: 'canal-x', name: '@Gta6univers0', service: 'twitter', isQueuePaused: false } } })
    if (query.includes('post(')) return respuesta({ data: { post: { id: 'buf-uno', status: estadoPost, sentAt: estadoPost === 'sent' ? '2026-11-22T12:00:00Z' : null, externalLink: 'https://x.com/cuenta/status/123' } } })
    return respuesta({ data: { createPost: { post: { id: 'buf-uno', sentAt: '2026-11-22T12:00:00Z', externalLink: 'https://x.com/cuenta/status/123' } } } })
  }
  if (red === 'facebook' && u.pathname.endsWith('/video')) return respuesta({ status: { processing_phase: { status: 'completed' }, publishing_phase: { publish_status: enviado ? 'published' : 'draft' } } })
  if (red === 'facebook' && u.pathname.endsWith('/video_reels')) { enviado = true; return respuesta({ success: true }) }
  throw new Error('Solicitud inesperada: ' + u.href)
}
test('YouTube sube privado aunque el destino sea un Short', async () => {
  red = 'youtube'; llamadas.length = 0
  const pasos = [], d = await pasoPublicacion(item(red), async p => pasos.push(p))
  assert.equal(d.estado, 'borrador')
  const subida = llamadas.find(l => l.url.includes('/upload/youtube/'))
  assert.match(subida.op.body.toString(), /"privacyStatus":"private"/)
  assert.ok(!subida.op.body.toString().includes('"privacyStatus":"public"'))
  assert.equal(pasos[0].etapa, 'subiendo_borrador')
})
test('TikTok transfiere el archivo al Inbox y espera su confirmación', async () => {
  red = 'tiktok'; llamadas.length = 0
  const pasos = [], d = await pasoPublicacion(item(red), async p => pasos.push(p))
  assert.equal(d.remoto_id, 'tt-uno')
  assert.equal(pasos[0].remoto_id, 'tt-uno')
  assert.equal(JSON.parse(llamadas.find(l => l.url.includes('/inbox/')).op.body).source_info.source, 'FILE_UPLOAD')
  assert.ok(llamadas.some(l => l.op.method === 'PUT'))
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'tt-uno' }, async () => {})).estado, 'borrador')
})
test('X verifica el canal y publica por Buffer con el esquema actual', async () => {
  red = 'x'; llamadas.length = 0; falloBuffer = false; estadoPost = 'sent'
  const d = await pasoPublicacion(item(red), async () => {})
  assert.equal(d.estado, 'publicado')
  const consultas = llamadas.filter(l => l.url === 'https://api.buffer.com/').map(l => JSON.parse(l.op.body).query)
  assert.ok(consultas.some(q => /channel\(input:/.test(q)))
  assert.ok(consultas.every(q => !/isDisconnected|isLocked|\bpost\(id:/.test(q)))
  const mutation = consultas.find(q => q.includes('createPost'))
  assert.match(mutation, /mode: shareNow/)
  assert.ok(llamadas.every(l => !new URL(l.url).hostname.endsWith('x.com')))
})
test('un error de GraphQL de Buffer se muestra sin filtrar la clave', async () => {
  red = 'x'; llamadas.length = 0; falloBuffer = true; estadoPost = 'sent'
  await assert.rejects(() => pasoPublicacion(item(red), async () => {}), /Buffer rechazó la consulta: Cannot query field/)
  assert.doesNotMatch(JSON.stringify(llamadas), /buffer-privado/)
  falloBuffer = false
})
test('X consulta el estado del post con el esquema actual y detecta fallos', async () => {
  red = 'x'; llamadas.length = 0; falloBuffer = false; estadoPost = 'error'
  await assert.rejects(() => pasoPublicacion({ ...item(red), remoto_id: 'buf-uno' }, async () => {}), /Buffer no pudo publicar en X/)
  const consulta = llamadas.find(l => l.url === 'https://api.buffer.com/')
  assert.match(JSON.parse(consulta.op.body).query, /post\(input:/)
  assert.doesNotMatch(JSON.parse(consulta.op.body).query, /\bpost\(id:/)
  estadoPost = 'sent'
})
test('Facebook espera confirmación sin repetir finish', async () => {
  red = 'facebook'; llamadas.length = 0; enviado = false
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'video', etapa: 'procesando' }, async () => {})).etapa, 'confirmando')
  assert.equal((await pasoPublicacion({ ...item(red), remoto_id: 'video', etapa: 'confirmando' }, async () => {})).estado, 'publicado')
  assert.equal(llamadas.filter(l => l.url.includes('/video_reels')).length, 1)
})
test.after(() => { globalThis.fetch = original })
